use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::{db, guided, study_sources::StudySource};

const TOPIC: &str = "Synthetic study topic";
const QUOTES: [&str; 3] = [
    "Source sentence alpha.",
    "Source sentence beta.",
    "Source sentence gamma.",
];

fn source() -> StudySource {
    StudySource {
        id: "synthetic-source".into(),
        title: "Synthetic source title".into(),
        publisher: "Test publisher".into(),
        url: "https://example.invalid/guided-test".into(),
        license: "Test fixture".into(),
        scope: "Synthetic scope".into(),
        text: QUOTES.join("\n"),
    }
}

fn lesson_json(source: &StudySource) -> Value {
    json!({
        "title": "Synthetic lesson",
        "overview": "Three items for persistence tests.",
        "items": QUOTES.iter().enumerate().map(|(index, quote)| json!({
            "explanation": format!("Synthetic explanation {index}."),
            "example": format!("Synthetic example {index}."),
            "question": format!("Synthetic question {index}?"),
            "answer": format!("Reference answer {index}."),
            "correction": format!("Synthetic correction {index}."),
            "sourceId": source.id,
            "quote": quote,
        })).collect::<Vec<_>>(),
    })
}

fn install(conn: &mut Connection, topic: &str) {
    let source = source();
    let sources = std::slice::from_ref(&source);
    let lesson = guided::parse_lesson(&lesson_json(&source).to_string(), sources).unwrap();
    guided::install(conn, topic, sources, lesson).unwrap();
}

fn run(conn: &Connection) -> Value {
    serde_json::to_value(guided::get_run(conn).unwrap().unwrap()).unwrap()
}

fn required_str<'a>(object: &'a Value, field: &str) -> &'a str {
    object[field]
        .as_str()
        .unwrap_or_else(|| panic!("{field} not in {object}"))
}

fn start_question(conn: &mut Connection) -> Value {
    let current = run(conn);
    assert_eq!(current["stage"], "read");
    guided::start_question(
        conn,
        required_str(&current["lesson"], "id"),
        required_str(&current, "cardId"),
    )
    .unwrap();
    let question = run(conn);
    assert_eq!(question["stage"], "question");
    assert!(question.get("answer").is_none());
    assert!(question.get("referenceAnswer").is_none());
    assert!(question.get("source").is_none());
    assert!(!question.to_string().contains("Reference answer"));
    question
}

fn row_counts(conn: &Connection) -> [i64; 5] {
    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM guided_lesson),
                (SELECT COUNT(*) FROM guided_source),
                (SELECT COUNT(*) FROM guided_item),
                (SELECT COUNT(*) FROM guided_run),
                (SELECT COUNT(*) FROM guided_attempt)",
        [],
        |row| {
            Ok([
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ])
        },
    )
    .unwrap()
}

#[test]
fn absent_course_stays_empty_until_verified_course_commits_atomically() {
    let mut conn = db::test_conn();
    guided::init(&conn).unwrap();
    conn.execute(
        "INSERT INTO source(id, title, kind, created_at) VALUES ('old', 'Old note', 'text', ?1)",
        [db::now_utc()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO source_revision(id, source_id, revision_no, content, content_hash, created_at)
         VALUES ('old-revision', 'old', 1, 'Unrelated original material.', 'test-hash', ?1)",
        [db::now_utc()],
    )
    .unwrap();
    assert!(!guided::has_lesson(&conn).unwrap());
    assert!(guided::existing_topic(&conn).unwrap().is_none());
    assert!(guided::get_run(&conn).unwrap().is_none());
    assert_eq!(row_counts(&conn), [0; 5]);

    let source = source();
    let sources = std::slice::from_ref(&source);
    for (field, forged) in [
        ("quote", "This sentence did not appear in the source."),
        ("sourceId", "valid-anchor-but-unknown-source"),
    ] {
        let mut value = lesson_json(&source);
        value["items"][2][field] = json!(forged);
        let error = guided::parse_lesson(&value.to_string(), sources).unwrap_err();
        assert_eq!(error.code(), "invalid_lesson", "{field}");
    }

    let pending = guided::parse_lesson(&lesson_json(&source).to_string(), sources).unwrap();
    assert!(guided::get_run(&conn).unwrap().is_none());
    conn.execute_batch(
        "CREATE TEMP TRIGGER fail_last_item BEFORE INSERT ON guided_item
         WHEN NEW.position = 2
         BEGIN SELECT RAISE(ABORT, 'synthetic final item failure'); END;",
    )
    .unwrap();
    let error = guided::install(&mut conn, TOPIC, sources, pending).unwrap_err();
    assert_eq!(error.code(), "database_error");
    assert!(error.message().contains("synthetic final item failure"));
    assert_eq!(row_counts(&conn), [0; 5]);
    assert!(guided::get_run(&conn).unwrap().is_none());
    assert!(!guided::has_lesson(&conn).unwrap());

    conn.execute_batch("DROP TRIGGER fail_last_item;").unwrap();
    install(&mut conn, TOPIC);
    assert!(guided::has_lesson(&conn).unwrap());
    assert_eq!(row_counts(&conn), [1, 1, 3, 1, 3]);
    assert_eq!(
        guided::existing_topic(&conn).unwrap().as_deref(),
        Some(TOPIC)
    );
    let current = run(&conn);
    assert_eq!(current["stage"], "read");
    assert_eq!(current["lesson"]["topic"], TOPIC);
    assert_eq!(current["current"], 1);
    assert_eq!(current["total"], 3);
    let legacy: (String, String) = conn
        .query_row(
            "SELECT s.title, r.content FROM source s JOIN source_revision r ON r.source_id = s.id
             WHERE s.id = 'old' AND r.id = 'old-revision'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        legacy,
        ("Old note".into(), "Unrelated original material.".into())
    );
}

#[test]
fn duplicate_install_never_replaces_course_or_resets_progress() {
    let mut conn = db::test_conn();
    guided::init(&conn).unwrap();
    install(&mut conn, TOPIC);
    let question = start_question(&mut conn);
    guided::save_draft(
        &conn,
        required_str(&question, "attemptId"),
        "Keep this draft.",
    )
    .unwrap();
    let snapshot = run(&conn);
    let source = source();
    let sources = std::slice::from_ref(&source);
    let mut replacement = lesson_json(&source);
    replacement["title"] = json!("Replacement title");
    let parse_replacement = || guided::parse_lesson(&replacement.to_string(), sources).unwrap();
    guided::install(&mut conn, TOPIC, sources, parse_replacement()).unwrap();
    let error =
        guided::install(&mut conn, "Another topic", sources, parse_replacement()).unwrap_err();
    assert_eq!(error.code(), "lesson_exists");
    assert_eq!(run(&conn), snapshot);
    assert_eq!(row_counts(&conn), [1, 1, 3, 1, 3]);
}

struct TempDb(PathBuf);

impl TempDb {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("{}.db", db::new_id("fold-guided-test"))))
    }

    fn open(&self) -> Connection {
        let conn = db::open_db(&self.0).unwrap();
        guided::init(&conn).unwrap();
        conn
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        for extension in ["db", "db-wal", "db-shm"] {
            let _ = std::fs::remove_file(self.0.with_extension(extension));
        }
    }
}

#[test]
fn restart_restores_latest_draft_and_null_first_answer_without_double_rating() {
    let file = TempDb::new();
    let mut conn = file.open();
    install(&mut conn, TOPIC);
    let question = start_question(&mut conn);
    let attempt_id = required_str(&question, "attemptId");
    guided::save_draft(&conn, attempt_id, "Old draft.").unwrap();
    guided::save_draft(&conn, attempt_id, "Latest draft.").unwrap();
    drop(conn);

    let mut conn = file.open();
    let restored = run(&conn);
    assert_eq!(restored["stage"], "question");
    assert_eq!(restored["attemptId"], attempt_id);
    assert_eq!(restored["draft"], "Latest draft.");
    assert!(!restored.to_string().contains("Reference answer"));
    guided::submit_answer(&mut conn, attempt_id, None).unwrap();
    drop(conn);

    let mut conn = file.open();
    let comparison = run(&conn);
    assert_eq!(comparison["stage"], "compare");
    assert_eq!(comparison["attemptId"], attempt_id);
    assert_eq!(comparison.get("answer"), Some(&Value::Null));
    assert_eq!(comparison["referenceAnswer"], "Reference answer 0.");
    assert_eq!(comparison["source"]["excerpt"], QUOTES[0]);
    assert_eq!(comparison["source"]["url"], source().url);
    assert_eq!(
        comparison["source"]["label"],
        "Test publisher · Synthetic source title"
    );
    guided::save_draft(&conn, attempt_id, "Stale queued draft.").unwrap();
    guided::submit_answer(&mut conn, attempt_id, None).unwrap();
    let overwrite = guided::submit_answer(&mut conn, attempt_id, Some("Overwrite.")).unwrap_err();
    assert_eq!(overwrite.code(), "answer_locked");
    assert_eq!(run(&conn), comparison);

    assert!(guided::confirm_answer(&mut conn, attempt_id, 2).is_err());
    guided::confirm_answer(&mut conn, attempt_id, 0).unwrap();
    let advanced = run(&conn);
    assert_eq!(advanced["stage"], "read");
    assert_eq!(advanced["current"], 2);
    guided::confirm_answer(&mut conn, attempt_id, 0).unwrap();
    assert!(guided::confirm_answer(&mut conn, attempt_id, 2).is_err());
    assert_eq!(run(&conn), advanced);
    let counts: (i64, i64, i64, String) = conn
        .query_row(
            "SELECT i.lapses, i.interval_days, a.grade, a.draft FROM guided_item i
             JOIN guided_attempt a ON a.item_id = i.id WHERE a.id = ?1",
            [attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(counts, (1, 1, 0, String::new()));
}

#[test]
fn review_waits_for_due_date_and_only_uses_items_from_the_active_subject() {
    let mut conn = db::test_conn();
    guided::init(&conn).unwrap();
    install(&mut conn, TOPIC);
    let mut initial_attempts = Vec::new();
    let before = db::local_today(&conn).0;
    for index in 0..3 {
        let question = start_question(&mut conn);
        assert_eq!(question["current"], index + 1);
        let attempt_id = required_str(&question, "attemptId");
        guided::submit_answer(&mut conn, attempt_id, Some("Original response.")).unwrap();
        guided::confirm_answer(&mut conn, attempt_id, 2).unwrap();
        initial_attempts.push(attempt_id.to_string());
    }
    let (today, _, today_iso) = db::local_today(&conn);
    let earliest: String = conn
        .query_row("SELECT MIN(due_on) FROM guided_item", [], |row| row.get(0))
        .unwrap();
    let scheduled = chrono::NaiveDate::parse_from_str(&earliest, "%Y-%m-%d").unwrap();
    assert!(scheduled >= before.succ_opt().unwrap());
    assert!(scheduled <= today.succ_opt().unwrap());
    let tomorrow = today.succ_opt().unwrap().to_string();
    conn.execute("UPDATE guided_item SET due_on = ?1", [&tomorrow])
        .unwrap();

    let done = run(&conn);
    let lesson_id = required_str(&done["lesson"], "id");
    conn.execute_batch(
        "INSERT INTO guided_lesson VALUES ('other-lesson', 'Other subject', 'Other', 'Other overview');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO guided_source SELECT 'other-lesson', id, title, publisher, url, license, scope, material
         FROM guided_source WHERE lesson_id = ?1",
        [lesson_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO guided_item(id, lesson_id, position, explanation, example, question, answer, correction,
                                  source_id, quote, due_on)
         SELECT 'other-item', 'other-lesson', 0, explanation, example, 'Unrelated question?', answer, correction,
                source_id, quote, ?2
         FROM guided_item WHERE lesson_id = ?1 AND position = 0",
        params![lesson_id, today_iso],
    )
    .unwrap();

    let done = run(&conn);
    assert_eq!(done["stage"], "done");
    assert_eq!(done["completed"], 3);
    assert_eq!(done["reviewAvailable"], false);
    assert!(guided::begin_review(&mut conn, "other-lesson").is_err());
    guided::begin_review(&mut conn, lesson_id).unwrap();
    assert_eq!(run(&conn), done);
    assert_eq!(row_counts(&conn), [2, 2, 4, 1, 3]);

    conn.execute(
        "UPDATE guided_item SET due_on = ?1 WHERE lesson_id = ?2 AND position = 1",
        params![today_iso, lesson_id],
    )
    .unwrap();
    assert_eq!(run(&conn)["reviewAvailable"], true);
    guided::begin_review(&mut conn, lesson_id).unwrap();
    let review = run(&conn);
    assert_eq!(review["stage"], "question");
    assert_eq!(review["lesson"]["topic"], TOPIC);
    assert_eq!(review["prompt"], "Synthetic question 1?");
    assert_eq!(review["total"], 1);
    assert_eq!(review["draft"], "");
    assert!(review.get("referenceAnswer").is_none());
    assert!(!initial_attempts
        .iter()
        .any(|id| id == required_str(&review, "attemptId")));
    guided::begin_review(&mut conn, lesson_id).unwrap();
    assert_eq!(run(&conn), review);
    assert_eq!(row_counts(&conn), [2, 2, 4, 2, 4]);
}
