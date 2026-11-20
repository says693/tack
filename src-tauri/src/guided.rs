use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::scheduler::{self, ScheduleState};
use crate::study_sources::StudySource;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS guided_lesson (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    overview TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guided_source (
    lesson_id TEXT NOT NULL REFERENCES guided_lesson(id),
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL,
    url TEXT NOT NULL,
    license TEXT NOT NULL,
    scope TEXT NOT NULL,
    material TEXT NOT NULL,
    PRIMARY KEY(lesson_id, id)
);
CREATE TABLE IF NOT EXISTS guided_item (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES guided_lesson(id),
    position INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    example TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    correction TEXT NOT NULL,
    source_id TEXT NOT NULL,
    quote TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'new',
    due_on TEXT,
    UNIQUE(lesson_id, position),
    FOREIGN KEY(lesson_id, source_id) REFERENCES guided_source(lesson_id, id)
);
CREATE TABLE IF NOT EXISTS guided_run (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES guided_lesson(id),
    started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guided_attempt (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES guided_run(id),
    item_id TEXT NOT NULL REFERENCES guided_item(id),
    position INTEGER NOT NULL,
    opened_at TEXT,
    draft TEXT NOT NULL DEFAULT '',
    answer TEXT,
    submitted_at TEXT,
    grade INTEGER CHECK(grade IN (0, 2)),
    confirmed_at TEXT,
    UNIQUE(run_id, position),
    UNIQUE(run_id, item_id)
);
"#;

pub fn init(conn: &Connection) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(SCHEMA)?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedLesson {
    title: String,
    overview: String,
    items: Vec<PreparedItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreparedItem {
    explanation: String,
    example: String,
    question: String,
    answer: String,
    correction: String,
    source_id: String,
    quote: String,
}

fn useful_text(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.trim().chars().count())
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\t' | '\r'))
}

fn invalid_lesson() -> AppError {
    AppError::user(
        "invalid_lesson",
        "AI 返回的课程不完整，或证据无法和原资料对上。这次没有写入课程，可以重新生成。",
    )
}

fn normalize_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join("")
}

fn strip_code_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        let after_first = rest.find('\n').map(|idx| &rest[idx + 1..]).unwrap_or(rest);
        after_first.strip_suffix("```").unwrap_or(after_first).trim()
    } else {
        trimmed
    }
}

pub fn validate_topic(raw: &str) -> AppResult<&str> {
    let topic = raw.trim();
    if crate::study_sources::is_custom_material(topic) {
        if !useful_text(topic, 1, 4000) {
            return Err(AppError::user(
                "invalid_topic",
                "自定义学习资料内容需要在 1 到 4000 个字之间。",
            ));
        }
        return Ok(topic);
    }
    if !useful_text(topic, 1, 80) || topic.contains(['\n', '\r', '\t']) {
        return Err(AppError::user(
            "invalid_topic",
            "请用 1 到 80 个字填写一个想学的科目，或粘贴不少于 40 字的学习资料。",
        ));
    }
    Ok(topic)
}

pub fn parse_lesson(raw: &str, sources: &[StudySource]) -> AppResult<PreparedLesson> {
    let lesson: PreparedLesson =
        serde_json::from_str(strip_code_fence(raw)).map_err(|_| invalid_lesson())?;
    if !useful_text(&lesson.title, 2, 48)
        || !useful_text(&lesson.overview, 6, 220)
        || lesson.items.len() != 3
    {
        return Err(invalid_lesson());
    }
    let mut questions = HashSet::new();
    for item in &lesson.items {
        let question = item
            .question
            .split_whitespace()
            .collect::<String>()
            .to_lowercase();
        let source = sources.iter().find(|source| source.id == item.source_id);
        let norm_quote = normalize_ws(&item.quote);
        if !useful_text(&item.explanation, 8, 350)
            || !useful_text(&item.example, 6, 250)
            || !useful_text(&item.question, 4, 200)
            || !useful_text(&item.answer, 1, 300)
            || !useful_text(&item.correction, 4, 220)
            || !useful_text(&item.quote, 6, 280)
            || norm_quote.is_empty()
            || !questions.insert(question)
            || source.is_none_or(|source| !normalize_ws(&source.text).contains(&norm_quote))
        {
            return Err(invalid_lesson());
        }
    }
    Ok(lesson)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonView {
    id: String,
    topic: String,
    title: String,
    overview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    lesson: LessonView,
    current: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
pub struct Evidence {
    label: String,
    excerpt: String,
    url: String,
    material: String,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "stage",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Run {
    Read {
        #[serde(flatten)]
        progress: Progress,
        card_id: String,
        explanation: String,
        example: String,
        source: Evidence,
    },
    Question {
        #[serde(flatten)]
        progress: Progress,
        attempt_id: String,
        prompt: String,
        draft: String,
    },
    Compare {
        #[serde(flatten)]
        progress: Progress,
        attempt_id: String,
        prompt: String,
        answer: Option<String>,
        reference_answer: String,
        correction: String,
        source: Evidence,
    },
    Done {
        #[serde(flatten)]
        progress: Progress,
        completed: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        next_due_label: Option<String>,
        review_available: bool,
    },
}

struct ActiveRun {
    id: String,
    lesson: LessonView,
}

fn active_run(conn: &Connection) -> AppResult<Option<ActiveRun>> {
    Ok(conn
        .query_row(
            "SELECT r.id, l.id, l.topic, l.title, l.overview
         FROM guided_run r JOIN guided_lesson l ON l.id = r.lesson_id
         ORDER BY r.rowid DESC LIMIT 1",
            [],
            |row| {
                Ok(ActiveRun {
                    id: row.get(0)?,
                    lesson: LessonView {
                        id: row.get(1)?,
                        topic: row.get(2)?,
                        title: row.get(3)?,
                        overview: row.get(4)?,
                    },
                })
            },
        )
        .optional()?)
}

fn stale() -> AppError {
    AppError::user("study_changed", "学习位置已经变化，请重新打开当前页。")
}

fn active_attempt(conn: &Connection) -> AppResult<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT id, item_id FROM guided_attempt
         WHERE run_id = (SELECT id FROM guided_run ORDER BY rowid DESC LIMIT 1)
           AND confirmed_at IS NULL ORDER BY position LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

pub fn get_run(conn: &Connection) -> AppResult<Option<Run>> {
    let Some(ActiveRun { id, lesson }) = active_run(conn)? else {
        return Ok(None);
    };
    let total: usize = conn.query_row(
        "SELECT COUNT(*) FROM guided_attempt WHERE run_id = ?1",
        [&id],
        |row| row.get(0),
    )?;
    let Some((attempt_id, _)) = active_attempt(conn)? else {
        let due: Option<String> = conn.query_row(
            "SELECT MIN(due_on) FROM guided_item WHERE lesson_id = ?1",
            [&lesson.id],
            |row| row.get(0),
        )?;
        let (today, _, date) = db::local_today(conn);
        return Ok(Some(Run::Done {
            progress: Progress {
                lesson,
                current: total,
                total,
            },
            completed: total,
            next_due_label: due
                .as_ref()
                .map(|due| crate::repo::review::next_due_label(due, today)),
            review_available: due.as_ref().is_some_and(|due| due <= &date),
        }));
    };
    let run = conn.query_row(
        "SELECT i.id, a.position, a.opened_at, a.submitted_at, i.explanation, i.example,
            i.question, a.draft, a.answer, i.answer, i.correction, s.title, s.publisher, i.quote,
            s.url, s.material
         FROM guided_attempt a JOIN guided_item i ON i.id = a.item_id
         JOIN guided_source s ON s.lesson_id = i.lesson_id AND s.id = i.source_id
         WHERE a.id = ?1",
        [&attempt_id],
        |row| {
            let progress = Progress { lesson, current: row.get::<_, usize>(1)? + 1, total };
            let evidence = || -> rusqlite::Result<Evidence> {
                Ok(Evidence {
                    label: format!("{} · {}", row.get::<_, String>(12)?, row.get::<_, String>(11)?),
                    excerpt: row.get(13)?,
                    url: row.get(14)?,
                    material: row.get(15)?,
                })
            };
            if row.get::<_, Option<String>>(3)?.is_some() {
                Ok(Run::Compare {
                    progress,
                    attempt_id: attempt_id.clone(),
                    prompt: row.get(6)?,
                    answer: row.get(8)?,
                    reference_answer: row.get(9)?,
                    correction: row.get(10)?,
                    source: evidence()?,
                })
            } else if row.get::<_, Option<String>>(2)?.is_some() {
                Ok(Run::Question { progress, attempt_id: attempt_id.clone(), prompt: row.get(6)?, draft: row.get(7)? })
            } else {
                Ok(Run::Read {
                    progress,
                    card_id: row.get(0)?,
                    explanation: row.get(4)?,
                    example: row.get(5)?,
                    source: evidence()?,
                })
            }
        },
    )?;
    Ok(Some(run))
}

#[cfg(test)]
mod run_tests {
    use super::*;

    #[test]
    fn stored_source_material_is_visible_only_when_reading_or_comparing() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let material = "  First line.\r\n\nExact evidence.\n  Last line.  ";
        let source = StudySource {
            id: "source-1".into(),
            title: "Source".into(),
            publisher: "Publisher".into(),
            url: "https://example.com/source".into(),
            license: "Notes".into(),
            scope: "Test topic".into(),
            text: material.into(),
        };
        let lesson = PreparedLesson {
            title: "Lesson".into(),
            overview: "Overview".into(),
            items: vec![PreparedItem {
                explanation: "Explanation".into(),
                example: "Example".into(),
                question: "Prompt?".into(),
                answer: "Reference answer".into(),
                correction: "Correction".into(),
                source_id: source.id.clone(),
                quote: "Exact evidence.".into(),
            }],
        };
        install(&mut conn, "Test topic", &[source], lesson).unwrap();
        let snapshot = |conn: &Connection| serde_json::to_value(get_run(conn).unwrap().unwrap()).unwrap();

        let read = snapshot(&conn);
        assert_eq!(read["stage"], "read");
        assert_eq!(read["source"]["material"], material);
        assert_eq!(read["source"]["label"], "Publisher · Source");
        assert_eq!(read["source"]["excerpt"], "Exact evidence.");
        assert_eq!(read["source"]["url"], "https://example.com/source");
        start_question(
            &mut conn,
            read["lesson"]["id"].as_str().unwrap(),
            read["cardId"].as_str().unwrap(),
        )
        .unwrap();

        let question = snapshot(&conn);
        assert_eq!(question["stage"], "question");
        for field in ["source", "answer", "referenceAnswer", "correction"] {
            assert!(question.get(field).is_none(), "question leaks {field}");
        }
        submit_answer(&mut conn, question["attemptId"].as_str().unwrap(), None).unwrap();

        let compare = snapshot(&conn);
        assert_eq!(compare["stage"], "compare");
        assert_eq!(compare["source"], read["source"]);
        assert_eq!(compare["referenceAnswer"], "Reference answer");
    }
}

fn new_round(conn: &Connection, lesson_id: &str, items: &[String], review: bool) -> AppResult<()> {
    let id = db::new_id("run");
    let now = db::now_utc();
    conn.execute(
        "INSERT INTO guided_run VALUES (?1, ?2, ?3)",
        params![id, lesson_id, now],
    )?;
    for (position, item) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO guided_attempt(id, run_id, item_id, position, opened_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![db::new_id("gat"), id, item, position, review.then_some(&now)],
        )?;
    }
    Ok(())
}

pub fn clear_all(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM guided_attempt;
         DELETE FROM guided_run;
         DELETE FROM guided_item;
         DELETE FROM guided_source;
         DELETE FROM guided_lesson;",
    )?;
    Ok(())
}

pub fn reset(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    clear_all(&tx)?;
    tx.commit()?;
    Ok(())
}

pub fn install(
    conn: &mut Connection,
    topic: &str,
    sources: &[StudySource],
    lesson: PreparedLesson,
) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(existing) = active_run(&tx)? {
        if existing.lesson.topic == topic {
            let same_material = sources.iter().all(|source| {
                tx.query_row(
                    "SELECT material FROM guided_source WHERE lesson_id = ?1 AND id = ?2",
                    params![existing.lesson.id, source.id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
                .is_some_and(|material| material == source.text)
            });
            if same_material {
                return Ok(());
            }
        }
        clear_all(&tx)?;
    }
    let id = db::new_id("lesson");
    tx.execute(
        "INSERT INTO guided_lesson(id, topic, title, overview) VALUES (?1, ?2, ?3, ?4)",
        params![id, topic, lesson.title, lesson.overview],
    )?;
    for source in sources {
        tx.execute(
            "INSERT INTO guided_source(lesson_id, id, title, publisher, url, license, scope, material)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, source.id, source.title, source.publisher, source.url, source.license, source.scope, source.text],
        )?;
    }
    let mut items = Vec::new();
    for (position, item) in lesson.items.into_iter().enumerate() {
        let item_id = db::new_id("item");
        tx.execute(
            "INSERT INTO guided_item(id, lesson_id, position, explanation, example, question, answer, correction, source_id, quote)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![item_id, id, position, item.explanation, item.example, item.question, item.answer, item.correction, item.source_id, item.quote],
        )?;
        items.push(item_id);
    }
    new_round(&tx, &id, &items, false)?;
    tx.commit()?;
    Ok(())
}

pub fn has_lesson(conn: &Connection) -> AppResult<bool> {
    Ok(
        conn.query_row("SELECT EXISTS(SELECT 1 FROM guided_lesson)", [], |row| {
            row.get(0)
        })?,
    )
}

pub fn existing_topic(conn: &Connection) -> AppResult<Option<String>> {
    Ok(active_run(conn)?.map(|run| run.lesson.topic))
}

pub fn start_question(conn: &mut Connection, lesson_id: &str, card_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if active_run(&tx)?.is_none_or(|run| run.lesson.id != lesson_id) {
        return Err(stale());
    }
    let (attempt_id, _) = active_attempt(&tx)?
        .filter(|(_, item)| item == card_id)
        .ok_or_else(stale)?;
    tx.execute(
        "UPDATE guided_attempt SET opened_at = ?1 WHERE id = ?2 AND opened_at IS NULL",
        params![db::now_utc(), attempt_id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn save_draft(conn: &Connection, attempt_id: &str, draft: &str) -> AppResult<()> {
    if draft.chars().count() > 2500 {
        return Err(AppError::user(
            "answer_too_long",
            "答案不能超过 2500 个字。",
        ));
    }
    conn.execute(
        "UPDATE guided_attempt SET draft = ?1 WHERE id = ?2 AND opened_at IS NOT NULL AND submitted_at IS NULL
         AND id = (SELECT id FROM guided_attempt
                   WHERE run_id = (SELECT id FROM guided_run ORDER BY rowid DESC LIMIT 1)
                     AND confirmed_at IS NULL ORDER BY position LIMIT 1)",
        params![draft, attempt_id],
    )?;
    Ok(())
}

pub fn submit_answer(
    conn: &mut Connection,
    attempt_id: &str,
    answer: Option<&str>,
) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (active, _) = active_attempt(&tx)?
        .filter(|(active, _)| active == attempt_id)
        .ok_or_else(stale)?;
    let answer = answer.map(str::trim);
    if answer.is_some_and(|answer| !useful_text(answer, 1, 2500)) {
        return Err(AppError::user(
            "bad_answer",
            "请写下答案，或选择「想不起来」。",
        ));
    }
    if tx.execute(
        "UPDATE guided_attempt SET answer = ?1, submitted_at = ?2, draft = ''
         WHERE id = ?3 AND opened_at IS NOT NULL AND submitted_at IS NULL",
        params![answer, db::now_utc(), active],
    )? == 0
    {
        let already: Option<Option<String>> = tx
            .query_row(
                "SELECT answer FROM guided_attempt WHERE id = ?1 AND submitted_at IS NOT NULL",
                [&active],
                |row| row.get(0),
            )
            .optional()?;
        if already.as_ref().map(|a| a.as_deref()) != Some(answer) {
            return Err(AppError::user(
                "answer_locked",
                "首次作答已保存或题目尚未打开，不能改写。",
            ));
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn confirm_answer(conn: &mut Connection, attempt_id: &str, grade: i64) -> AppResult<()> {
    if !matches!(grade, 0 | 2) {
        return Err(AppError::user("invalid_rating", "请选择是否需要再练。"));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (item, submitted, answered, old_grade): (String, bool, bool, Option<i64>) = tx.query_row(
        "SELECT item_id, submitted_at IS NOT NULL, answer IS NOT NULL, grade FROM guided_attempt WHERE id = ?1",
        [attempt_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional()?.ok_or_else(stale)?;
    if let Some(old_grade) = old_grade {
        return if old_grade == grade {
            Ok(())
        } else {
            Err(stale())
        };
    }
    if !submitted
        || (!answered && grade != 0)
        || active_attempt(&tx)?.is_none_or(|(active, _)| active != attempt_id)
    {
        return Err(stale());
    }
    let before = tx.query_row(
        "SELECT ease, interval_days, reps, lapses, state, due_on FROM guided_item WHERE id = ?1",
        [&item],
        |row| {
            Ok(ScheduleState {
                ease: row.get(0)?,
                interval_days: row.get(1)?,
                reps: row.get(2)?,
                lapses: row.get(3)?,
                state: row.get(4)?,
                due_on: row.get(5)?,
            })
        },
    )?;
    let (today, _, _) = db::local_today(&tx);
    let after = scheduler::apply_grade(&before, grade, today)
        .map_err(|message| AppError::user("invalid_rating", message))?;
    tx.execute(
        "UPDATE guided_item SET ease = ?1, interval_days = ?2, reps = ?3, lapses = ?4, state = ?5, due_on = ?6 WHERE id = ?7",
        params![after.ease, after.interval_days, after.reps, after.lapses, after.state, after.due_on, item],
    )?;
    tx.execute(
        "UPDATE guided_attempt SET grade = ?1, confirmed_at = ?2 WHERE id = ?3",
        params![grade, db::now_utc(), attempt_id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn begin_review(conn: &mut Connection, lesson_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if active_run(&tx)?.is_none_or(|run| run.lesson.id != lesson_id) {
        return Err(stale());
    }
    if active_attempt(&tx)?.is_some() {
        return Ok(());
    }
    let (_, _, date) = db::local_today(&tx);
    let due: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM guided_item WHERE lesson_id = ?1 AND due_on <= ?2 ORDER BY due_on, position LIMIT 3",
        )?;
        let rows = stmt.query_map(params![lesson_id, date], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if !due.is_empty() {
        new_round(&tx, lesson_id, &due, true)?;
    }
    tx.commit()?;
    Ok(())
}
