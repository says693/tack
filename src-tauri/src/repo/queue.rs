use rusqlite::{Connection, OptionalExtension};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::*;

use super::{get_attempt, get_card_summary, queue_stats};

struct Candidate {
    concept_id: String,
    card_id: String,
    revision_id: String,
    kind: String,
    due_on: Option<String>,
}

fn pick_card(conn: &Connection, concept_id: &str) -> AppResult<Option<(String, String)>> {
    conn.query_row(
        "SELECT ca.id, ca.current_revision_id FROM card ca
         WHERE ca.concept_id = ?1 AND ca.status = 'active' AND ca.archived_at IS NULL
           AND ca.current_revision_id IS NOT NULL
         ORDER BY (SELECT COUNT(*) FROM attempt a WHERE a.card_id = ca.id) ASC,
                  ca.updated_at ASC, ca.id ASC
         LIMIT 1",
        [concept_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(AppError::from)
}

fn candidates(conn: &Connection, kind: &str, today: &str, limit: i64) -> AppResult<Vec<Candidate>> {
    let sql = if kind == "review" {
        "SELECT c.id, c.due_on FROM concept c
         WHERE c.archived_at IS NULL
           AND (c.reps > 0 OR c.lapses > 0 OR c.state IN ('review', 'relearning'))
           AND c.due_on IS NOT NULL AND c.due_on <= ?1
           AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM daily_assignment d WHERE d.concept_id = c.id AND d.local_date = ?1)
         ORDER BY (SELECT COUNT(*) FROM attempt a WHERE a.concept_id = c.id AND a.local_date = ?1 AND a.status = 'abandoned') ASC,
                  c.due_on ASC, c.created_at ASC LIMIT ?2"
    } else {
        "SELECT c.id, c.due_on FROM concept c
         WHERE c.archived_at IS NULL
           AND c.reps = 0 AND c.lapses = 0 AND c.state = 'new' AND c.due_on IS NULL
           AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM daily_assignment d WHERE d.concept_id = c.id AND d.local_date = ?1)
         ORDER BY (SELECT COUNT(*) FROM attempt a WHERE a.concept_id = c.id AND a.local_date = ?1 AND a.status = 'abandoned') ASC,
                  c.created_at ASC LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params![today, limit], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (concept_id, due_on) = row?;
        if let Some((card_id, revision_id)) = pick_card(conn, &concept_id)? {
            out.push(Candidate {
                concept_id,
                card_id,
                revision_id,
                kind: kind.to_string(),
                due_on,
            });
        }
    }
    Ok(out)
}

fn existing_open_assignment(conn: &Connection, today: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT d.id FROM daily_assignment d
             LEFT JOIN attempt a ON a.id = d.attempt_id
             WHERE d.local_date = ?1 AND d.completed_at IS NULL
               AND (a.id IS NULL OR a.status NOT IN ('abandoned','confirmed'))
             ORDER BY d.created_at ASC LIMIT 1",
            [today],
            |r| r.get::<_, String>(0),
        )
        .optional()?)
}

fn task_for_assignment(conn: &Connection, assignment_id: &str) -> AppResult<Option<Task>> {
    let row = conn
        .query_row(
            "SELECT id, kind, concept_id, attempt_id, due_on FROM (
                SELECT d.id, d.kind, d.concept_id, d.attempt_id, c.due_on
                FROM daily_assignment d JOIN concept c ON c.id = d.concept_id
                WHERE d.id = ?1
             )",
            [assignment_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((id, kind, _concept_id, attempt_id, due_on)) = row else {
        return Ok(None);
    };
    let Some(attempt_id) = attempt_id else {
        return Ok(None);
    };
    let attempt = get_attempt(conn, &attempt_id)?;
    let stats = queue_stats(conn)?;
    Ok(Some(Task {
        assignment_id: id,
        kind,
        due_on,
        attempt,
        stats,
    }))
}

pub fn next_task(conn: &Connection) -> AppResult<TaskOutcome> {
    let (_, _, today) = db::local_today(conn);
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<TaskOutcome> {
        if let Some(assignment_id) = existing_open_assignment(conn, &today)? {
            if let Some(task) = task_for_assignment(conn, &assignment_id)? {
                let blocked = blocked_concepts(conn, &today)?;
                let stats = queue_stats(conn)?;
                return Ok(TaskOutcome {
                    task: Some(task),
                    blocked,
                    stats,
                    message: None,
                });
            }
        }
        let stats = queue_stats(conn)?;
        let due_candidates = candidates(conn, "review", &today, 1)?;
        let new_candidates = candidates(conn, "new", &today, 1)?;
        let kind = if !due_candidates.is_empty() && stats.review_remaining > 0 {
            "review"
        } else if !new_candidates.is_empty() && stats.new_remaining > 0 {
            "new"
        } else {
            ""
        };
        if kind.is_empty() {
            let blocked = blocked_concepts(conn, &today)?;
            let message = if stats.due_count == 0 && stats.new_available == 0 {
                "今天没有到期任务。去读一段新材料，或补充一张卡片。"
            } else if stats.review_remaining == 0 && stats.new_remaining == 0 {
                "今天的预算已用完。积压仍保留真实到期日，明天继续。"
            } else {
                "没有可领取的任务。"
            };
            return Ok(TaskOutcome {
                task: None,
                blocked,
                stats,
                message: Some(message.into()),
            });
        }
        let candidate = if kind == "review" {
            due_candidates.into_iter().next().unwrap()
        } else {
            new_candidates.into_iter().next().unwrap()
        };
        let assignment_id = db::new_id("asg");
        let attempt_id = db::new_id("att");
        let now = db::now_utc();
        let (_, tz, _) = db::local_today(conn);
        let tz_name = tz.name().to_string();
        // attempt.assignment_id is a foreign key, while daily_assignment.attempt_id
        // is a plain reference. Insert the assignment first so immediate FK
        // enforcement does not reject the attempt row.
        conn.execute(
            "INSERT INTO daily_assignment(id, local_date, timezone, concept_id, kind, card_id,
                card_revision_id, attempt_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                assignment_id,
                today,
                tz_name,
                candidate.concept_id,
                kind,
                candidate.card_id,
                candidate.revision_id,
                attempt_id,
                now
            ],
        )?;
        conn.execute(
            "INSERT INTO attempt(id, assignment_id, concept_id, card_id, revision_id, first_answer,
                practice_answers, status, is_demo, local_date, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '', '[]', 'awaiting', 0, ?6, ?7)",
            rusqlite::params![
                attempt_id,
                assignment_id,
                candidate.concept_id,
                candidate.card_id,
                candidate.revision_id,
                today,
                now
            ],
        )?;
        let attempt = get_attempt(conn, &attempt_id)?;
        let stats = queue_stats(conn)?;
        let blocked = blocked_concepts(conn, &today)?;
            Ok(TaskOutcome {
                task: Some(Task {
                    assignment_id,
                    kind: candidate.kind,
                    due_on: candidate.due_on,
                    attempt,
                    stats: stats.clone(),
                }),
                blocked,
                stats,
                message: None,
            })
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(e) => {
            super::rollback(conn);
            Err(e)
        }
    }
}

pub fn blocked_concepts(conn: &Connection, today: &str) -> AppResult<Vec<BlockedConcept>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.due_on, c.reps, c.lapses, c.state FROM concept c
         WHERE c.archived_at IS NULL
           AND (
             (c.reps = 0 AND c.lapses = 0 AND c.state = 'new' AND c.due_on IS NULL)
             OR ((c.reps > 0 OR c.lapses > 0 OR c.state IN ('review', 'relearning')) AND c.due_on IS NOT NULL AND c.due_on <= ?1)
           )
           AND NOT EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
         ORDER BY CASE WHEN c.due_on IS NULL THEN 1 ELSE 0 END, c.due_on ASC, c.created_at ASC
         LIMIT 12",
    )?;
    let rows = stmt.query_map([today], |r| {
        let reps: i64 = r.get(3)?;
        let lapses: i64 = r.get(4)?;
        let state: String = r.get(5)?;
        Ok(BlockedConcept {
            concept_id: r.get(0)?,
            name: r.get(1)?,
            due_on: r.get(2)?,
            reason: if reps == 0 && lapses == 0 && state == "new" {
                "待补充卡片".into()
            } else {
                "卡片已暂停或来源缺失".into()
            },
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn abandon_attempt(conn: &Connection, attempt_id: &str) -> AppResult<BooleanResult> {
    let attempt = get_attempt(conn, attempt_id)?;
    if attempt.status == "confirmed" {
        return Err(AppError::user("already_confirmed", "这次复习已经确认，不能放弃。"));
    }
    let assignment_id: Option<String> = conn
        .query_row(
            "SELECT assignment_id FROM attempt WHERE id = ?1",
            [attempt_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<()> {
        if attempt.first_answer.trim().is_empty() {
            conn.execute(
                "UPDATE attempt SET status = 'abandoned', assignment_id = NULL WHERE id = ?1",
                [attempt_id],
            )?;
            if let Some(id) = assignment_id.as_deref() {
                conn.execute("DELETE FROM daily_assignment WHERE id = ?1", [id])?;
            }
        } else {
            conn.execute(
                "UPDATE attempt SET status = 'abandoned' WHERE id = ?1",
                [attempt_id],
            )?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(BooleanResult { ok: true, changed: true })
        }
        Err(e) => {
            super::rollback(conn);
            Err(e)
        }
    }
}

pub fn get_task_for_attempt(conn: &Connection, attempt_id: &str) -> AppResult<Option<Task>> {
    let assignment_id: Option<String> = conn
        .query_row(
            "SELECT assignment_id FROM attempt WHERE id = ?1",
            [attempt_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    if let Some(id) = assignment_id {
        if let Some(task) = task_for_assignment(conn, &id)? {
            return Ok(Some(task));
        }
    }
    let attempt = get_attempt(conn, attempt_id)?;
    let stats = queue_stats(conn)?;
    let is_new = attempt.concept.reps == 0
        && attempt.concept.lapses == 0
        && attempt.concept.state == "new";
    Ok(Some(Task {
        assignment_id: String::new(),
        kind: if is_new { "new".into() } else { "review".into() },
        due_on: attempt.concept.due_on.clone(),
        attempt,
        stats,
    }))
}

pub fn queue_preview(conn: &Connection) -> AppResult<QueuePreview> {
    let (_, _, today) = db::local_today(conn);
    let stats = queue_stats(conn)?;
    let blocked = blocked_concepts(conn, &today)?;
    let mut due = Vec::new();
    let mut new = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT c.id FROM concept c
             WHERE c.archived_at IS NULL
               AND (c.reps > 0 OR c.lapses > 0 OR c.state IN ('review', 'relearning'))
               AND c.due_on IS NOT NULL AND c.due_on <= ?1
               AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM daily_assignment d WHERE d.concept_id = c.id AND d.local_date = ?1)
             ORDER BY c.due_on ASC LIMIT 8",
        )?;
        let ids = stmt
            .query_map([&today], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in ids {
            if let Some((card_id, _)) = pick_card(conn, &id)? {
                if let Ok(card) = get_card_summary(conn, &card_id) {
                    due.push(card);
                }
            }
        }
    }
    {
        let mut stmt = conn.prepare(
            "SELECT c.id FROM concept c
             WHERE c.archived_at IS NULL
               AND c.reps = 0 AND c.lapses = 0 AND c.state = 'new' AND c.due_on IS NULL
               AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM daily_assignment d WHERE d.concept_id = c.id AND d.local_date = ?1)
             ORDER BY c.created_at ASC LIMIT 8",
        )?;
        let ids = stmt
            .query_map([&today], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in ids {
            if let Some((card_id, _)) = pick_card(conn, &id)? {
                if let Ok(card) = get_card_summary(conn, &card_id) {
                    new.push(card);
                }
            }
        }
    }
    Ok(QueuePreview {
        stats,
        due,
        new,
        blocked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CardDraftInput, CardRevisionInput, ConfirmReviewInput};
    use crate::repo::cards;

    fn test_db() -> Connection {
        let path = std::env::temp_dir().join(format!(
            "fold-queue-{}-{}.db",
            std::process::id(),
            db::new_id("t")
        ));
        let conn = db::open_db(&path).expect("open test database");
        db::set_setting(&conn, "study.timezone", "Asia/Shanghai").expect("timezone");
        conn
    }

    fn active_card(conn: &Connection) -> String {
        let draft = cards::create_draft(
            conn,
            CardDraftInput {
                concept_name: "队列回归测试".into(),
                question: "队列里的第一张卡会怎样被领取？".into(),
                answer: "返回同一个开放尝试，不重复创建。".into(),
                evidence_chunk_id: None,
                evidence_excerpt: String::new(),
                exercise_origin: "unspecified".into(),
                origin_note: None,
                mode: "self".into(),
                session_id: None,
            },
        )
        .expect("create draft");
        let accepted = cards::accept_card(conn, &draft.summary.id).expect("accept");
        accepted.summary.id
    }

    #[test]
    fn next_task_inserts_assignment_before_attempt() {
        let conn = test_db();
        active_card(&conn);
        let outcome = next_task(&conn).expect("queue must satisfy foreign keys");
        let task = outcome.task.expect("one new task");
        assert_eq!(task.kind, "new");
        assert!(task.attempt.id.starts_with("att_"));
        let linked: String = conn
            .query_row(
                "SELECT assignment_id FROM attempt WHERE id = ?1",
                [&task.attempt.id],
                |row| row.get(0),
            )
            .expect("attempt link");
        assert_eq!(linked, task.assignment_id);
    }

    #[test]
    fn next_task_reuses_the_open_attempt() {
        let conn = test_db();
        active_card(&conn);
        let first = next_task(&conn).expect("first task").task.expect("task");
        let second = next_task(&conn).expect("second task").task.expect("task");
        assert_eq!(first.attempt.id, second.attempt.id);
        assert_eq!(first.assignment_id, second.assignment_id);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM attempt", [], |row| row.get(0))
            .expect("attempt count");
        assert_eq!(count, 1);
    }

    #[test]
    fn abandoned_blank_attempt_frees_the_queue_slot() {
        let conn = test_db();
        active_card(&conn);
        let first = next_task(&conn).expect("first task").task.expect("task");
        abandon_attempt(&conn, &first.attempt.id).expect("abandon blank attempt");
        let after = next_task(&conn).expect("next after abandon").task.expect("task");
        assert_ne!(first.attempt.id, after.attempt.id);
        assert_ne!(first.assignment_id, after.assignment_id);
    }

    #[test]
    fn concurrent_next_task_returns_one_open_assignment() {
        use std::sync::{Arc, Barrier};

        let path = std::env::temp_dir().join(format!(
            "fold-queue-race-{}-{}.db",
            std::process::id(),
            db::new_id("t")
        ));
        let conn = db::open_db(&path).expect("open test database");
        db::set_setting(&conn, "study.timezone", "Asia/Shanghai").expect("timezone");
        active_card(&conn);
        let conn2 = db::open_db(&path).expect("second connection");

        let barrier = Arc::new(Barrier::new(2));
        let barrier2 = barrier.clone();
        let handle = std::thread::spawn(move || {
            barrier2.wait();
            next_task(&conn2)
        });
        barrier.wait();
        let first = next_task(&conn).expect("main task");
        let second = handle.join().expect("thread join").expect("racing task");
        let first_task = first.task.expect("first task");
        let second_task = second.task.expect("second task");
        assert_eq!(first_task.attempt.id, second_task.attempt.id);
        assert_eq!(first_task.assignment_id, second_task.assignment_id);
        let attempts: i64 = conn
            .query_row("SELECT COUNT(*) FROM attempt", [], |row| row.get(0))
            .expect("attempt count");
        let assignments: i64 = conn
            .query_row("SELECT COUNT(*) FROM daily_assignment", [], |row| row.get(0))
            .expect("assignment count");
        assert_eq!(attempts, 1);
        assert_eq!(assignments, 1);
    }

    #[test]
    fn default_budget_serves_fifty_reviews_then_ten_new_cards() {
        let conn = test_db();
        let (today, _, _) = db::local_today(&conn);
        let yesterday = (today - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        for index in 0..67 {
            let name = format!("预算测试 {index:02}");
            let draft = cards::create_draft(
                &conn,
                CardDraftInput {
                    concept_name: name.clone(),
                    question: format!("预算测试问题 {index}"),
                    answer: format!("预算测试答案 {index}"),
                    evidence_chunk_id: None,
                    evidence_excerpt: String::new(),
                    exercise_origin: "unspecified".into(),
                    origin_note: None,
                    mode: "self".into(),
                    session_id: None,
                },
            )
            .expect("budget draft");
            cards::accept_card(&conn, &draft.summary.id).expect("budget accept");
            if index < 55 {
                conn.execute(
                    "UPDATE concept SET state = 'review', reps = 1, interval_days = 1,
                        due_on = ?1, last_reviewed_at = ?2 WHERE name = ?3",
                    rusqlite::params![yesterday, yesterday, name],
                )
                .expect("make due");
            }
        }

        let mut kinds = Vec::new();
        for index in 0..60 {
            let task = next_task(&conn)
                .expect("budget task")
                .task
                .unwrap_or_else(|| panic!("task {index} missing"));
            kinds.push(task.kind.clone());
            let answered = crate::repo::review::prepare_answer(
                &conn,
                &task.attempt.id,
                "预算测试答案",
                None,
            )
            .expect("budget answer");
            crate::repo::review::confirm_review(
                &conn,
                ConfirmReviewInput {
                    attempt_id: answered.id,
                    grade: 2,
                    idempotency_key: format!("budget-{index}"),
                },
            )
            .expect("budget confirm");
        }
        assert_eq!(kinds.iter().filter(|kind| *kind == "review").count(), 50);
        assert_eq!(kinds.iter().filter(|kind| *kind == "new").count(), 10);
        assert_eq!(&kinds[..50], &vec!["review".to_string(); 50][..]);
        assert_eq!(&kinds[50..], &vec!["new".to_string(); 10][..]);

        let exhausted = next_task(&conn).expect("exhausted queue");
        assert!(exhausted.task.is_none());
        assert_eq!(exhausted.stats.due_count, 5);
        assert_eq!(exhausted.stats.new_available, 2);
        assert!(exhausted.message.unwrap_or_default().contains("预算"));
    }

    #[test]
    fn semantic_edit_of_active_card_requires_schedule_decision() {
        let conn = test_db();
        let card_id = active_card(&conn);
        let detail = crate::repo::get_card_detail(&conn, &card_id).expect("card");
        let revision = detail.summary.revision_id.expect("revision");
        let result = cards::update_card(
            &conn,
            &card_id,
            CardRevisionInput {
                question: "改过的问题：语义变化后应如何处理排期？".into(),
                answer: "卡片暂停，等待保留原排期或重置。".into(),
                evidence_chunk_id: None,
                evidence_excerpt: String::new(),
                exercise_origin: "unspecified".into(),
                origin_note: None,
            },
        )
        .expect("semantic edit");
        assert!(result.semantic_change);
        assert!(result.needs_schedule_decision);
        assert_eq!(result.card.summary.status, "paused");
        assert_ne!(result.card.summary.revision_id.as_deref(), Some(revision.as_str()));

        let kept = cards::resolve_revision(&conn, &card_id, "keep").expect("keep schedule");
        assert_eq!(kept.summary.status, "active");
    }

    #[test]
    fn lapsed_concept_with_zero_reps_is_scheduled_as_review_not_new() {
        let conn = test_db();
        let card_id = active_card(&conn);
        let detail = crate::repo::get_card_detail(&conn, &card_id).expect("card");
        let (today, _, _) = db::local_today(&conn);
        let tomorrow = (today + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();

        conn.execute(
            "UPDATE concept SET state = 'relearning', reps = 0, lapses = 1, interval_days = 1, due_on = ?1 WHERE id = ?2",
            rusqlite::params![tomorrow, detail.concept.id],
        )
        .unwrap();

        let outcome = next_task(&conn).expect("future lapsed card must wait until due_on");
        assert!(outcome.task.is_none());
        assert_eq!(outcome.stats.new_available, 0);
        assert_eq!(outcome.stats.due_count, 0);

        let today_str = today.format("%Y-%m-%d").to_string();
        conn.execute(
            "UPDATE concept SET due_on = ?1 WHERE id = ?2",
            rusqlite::params![today_str, detail.concept.id],
        )
        .unwrap();

        let due_outcome = next_task(&conn).expect("due lapsed card serves as review");
        let task = due_outcome.task.expect("task");
        assert_eq!(task.kind, "review");
        assert_eq!(task.stats.due_count, 1);
        assert_eq!(task.stats.new_available, 0);
    }

    #[test]
    fn abandoning_blank_attempt_rotates_to_next_candidate_without_loop() {
        let conn = test_db();
        for name in ["概念甲", "概念乙"] {
            let draft = cards::create_draft(
                &conn,
                CardDraftInput {
                    concept_name: name.into(),
                    question: format!("{name}的问题？"),
                    answer: format!("{name}的答案。"),
                    evidence_chunk_id: None,
                    evidence_excerpt: String::new(),
                    exercise_origin: "unspecified".into(),
                    origin_note: None,
                    mode: "self".into(),
                    session_id: None,
                },
            )
            .unwrap();
            cards::accept_card(&conn, &draft.summary.id).unwrap();
        }

        let first = next_task(&conn).unwrap().task.unwrap();
        abandon_attempt(&conn, &first.attempt.id).unwrap();
        let second = next_task(&conn).unwrap().task.unwrap();
        assert_ne!(first.attempt.concept_id, second.attempt.concept_id);
        assert_eq!(second.stats.new_served_today, 1);
    }
}
