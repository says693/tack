use std::path::Path;
use std::time::Duration;

use chrono::{NaiveDate, Utc};
use chrono_tz::Tz;
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub const CURRENT_SCHEMA: i64 = 1;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'import',
  trust_tier INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL,
  last_read_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS source_revision (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  revision_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_revision_source ON source_revision(source_id, revision_no DESC);

CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  revision_id TEXT NOT NULL REFERENCES source_revision(id),
  ordinal INTEGER NOT NULL,
  heading TEXT,
  locator TEXT,
  quote_exact TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  start_utf16 INTEGER NOT NULL DEFAULT 0,
  end_utf16 INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_revision ON chunk(revision_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_chunk_source ON chunk(source_id);

CREATE TABLE IF NOT EXISTS concept (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES source(id),
  chunk_id TEXT REFERENCES chunk(id),
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'user_selected',
  state TEXT NOT NULL DEFAULT 'new',
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_on TEXT,
  last_reviewed_at TEXT,
  scheduler TEXT NOT NULL DEFAULT 'fold-sm2e-1',
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_concept_due ON concept(due_on);
CREATE INDEX IF NOT EXISTS idx_concept_source ON concept(source_id);

CREATE TABLE IF NOT EXISTS card (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL REFERENCES concept(id),
  session_id TEXT REFERENCES session(id),
  kind TEXT NOT NULL DEFAULT 'recall',
  status TEXT NOT NULL DEFAULT 'draft',
  mode TEXT NOT NULL DEFAULT 'ai',
  current_revision_id TEXT,
  paused_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_card_concept ON card(concept_id, status);
CREATE INDEX IF NOT EXISTS idx_card_status ON card(status, updated_at);

CREATE TABLE IF NOT EXISTS card_revision (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES card(id),
  revision_no INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  evidence_chunk_id TEXT REFERENCES chunk(id),
  evidence_excerpt TEXT NOT NULL DEFAULT '',
  exercise_origin TEXT NOT NULL DEFAULT 'generated',
  origin_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(card_id, revision_no)
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES session(id),
  fork_message_id TEXT,
  fork_chunk_id TEXT REFERENCES chunk(id),
  fork_exact TEXT,
  seed_name TEXT NOT NULL,
  concept_id TEXT REFERENCES concept(id),
  kind TEXT NOT NULL DEFAULT 'root',
  intent TEXT NOT NULL DEFAULT 'unspecified',
  summary TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  parent_anchor TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_parent ON session(parent_id);
CREATE INDEX IF NOT EXISTS idx_session_updated ON session(updated_at DESC);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  error TEXT,
  cites TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id, ordinal);

CREATE TABLE IF NOT EXISTS daily_assignment (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concept(id),
  kind TEXT NOT NULL,
  card_id TEXT REFERENCES card(id),
  card_revision_id TEXT REFERENCES card_revision(id),
  attempt_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(local_date, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_date ON daily_assignment(local_date, kind);

CREATE TABLE IF NOT EXISTS attempt (
  id TEXT PRIMARY KEY,
  assignment_id TEXT REFERENCES daily_assignment(id),
  concept_id TEXT NOT NULL REFERENCES concept(id),
  card_id TEXT NOT NULL REFERENCES card(id),
  revision_id TEXT NOT NULL REFERENCES card_revision(id),
  first_answer TEXT NOT NULL DEFAULT '',
  hint_used INTEGER NOT NULL DEFAULT 0,
  hint_text TEXT,
  practice_answers TEXT NOT NULL DEFAULT '[]',
  feedback TEXT,
  verdict TEXT,
  suggested_grade INTEGER,
  feedback_mode TEXT,
  ai_error TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting',
  is_demo INTEGER NOT NULL DEFAULT 0,
  local_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  answered_at TEXT,
  feedback_at TEXT,
  confirmed_at TEXT,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attempt_concept ON attempt(concept_id, local_date);
CREATE INDEX IF NOT EXISTS idx_attempt_status ON attempt(status);

CREATE TABLE IF NOT EXISTS review (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempt(id),
  concept_id TEXT NOT NULL REFERENCES concept(id),
  grade INTEGER NOT NULL,
  mode TEXT NOT NULL,
  scheduler TEXT NOT NULL,
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  due_on TEXT NOT NULL,
  latency_ms INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  local_date TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_concept_date ON review(concept_id, local_date);
CREATE INDEX IF NOT EXISTS idx_review_date ON review(local_date);

CREATE TABLE IF NOT EXISTS objection (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempt(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"#;

pub fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

pub fn open_db(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;",
    )?;
    migrate(&conn, path)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection, path: &Path) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > CURRENT_SCHEMA {
        return Err(AppError::user(
            "database_too_new",
            "数据库由更新版本的折页创建，请升级应用后再打开。",
        ));
    }
    if version == 0 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA)?;
        return Ok(());
    }
    if version < CURRENT_SCHEMA {
        backup_before_migration(conn, path, version)?;
        // Future incremental migrations belong here. Schema v1 is the baseline.
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA)?;
    }
    Ok(())
}

pub fn backup_db(conn: &Connection, path: &Path) -> AppResult<()> {
    if let Some(source) = conn.path() {
        if let (Ok(source), Ok(destination)) = (Path::new(source).canonicalize(), path.canonicalize()) {
            if source == destination {
                return Err(AppError::user(
                    "backup_is_source",
                    "备份不能覆盖正在使用的数据库，请选择其他文件。",
                ));
            }
        }
    }

    // Keep the unsanitized snapshot and SQLite temporary storage off disk.
    let mut snapshot = Connection::open_in_memory()?;
    snapshot.execute_batch("PRAGMA temp_store = MEMORY;")?;
    {
        let backup = rusqlite::backup::Backup::new(conn, &mut snapshot)?;
        backup.run_to_completion(100, Duration::from_millis(10), None)?;
    }
    snapshot.execute(
        "UPDATE settings SET value = ''
         WHERE key LIKE '%api_key%' OR key LIKE '%secret%' OR key LIKE '%token%'",
        [],
    )?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_file_name(format!(".{}.tmp", new_id("backup")));
    let temporary_name = temporary
        .to_str()
        .ok_or_else(|| rusqlite::Error::InvalidPath(temporary.clone()))?;
    let reserved = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    drop(reserved);
    let result = (|| -> AppResult<()> {
        // Rebuild only live data, omitting old values in free space and overflow pages.
        snapshot.execute("VACUUM INTO ?1", [temporary_name])?;
        let check = Connection::open_with_flags(&temporary, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        verify_backup(&check)?;
        drop(check);
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        // A cleanup failure can leave only an already sanitized temporary snapshot.
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn verify_backup(conn: &Connection) -> AppResult<()> {
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(AppError::user(
            "backup_integrity_failed",
            format!("备份校验失败：{integrity}"),
        ));
    }
    Ok(())
}

fn backup_before_migration(conn: &Connection, path: &Path, version: i64) -> AppResult<()> {
    let backup_dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let target = backup_dir.join(format!("pre-migrate-v{version}-{stamp}.db"));
    backup_db(conn, &target)
}

fn seed_defaults(conn: &Connection) -> AppResult<()> {
    let now = now_utc();
    let detected = iana_time_zone::get_timezone().unwrap_or_else(|_| "Asia/Shanghai".to_string());
    let tz = if detected.parse::<Tz>().is_ok() {
        detected
    } else {
        "Asia/Shanghai".to_string()
    };
    let defaults = [
        ("model.provider", "deepseek".to_string()),
        ("model.base_url", "https://api.deepseek.com".to_string()),
        ("model.model", "deepseek-flash".to_string()),
        ("model.temperature", "0.2".to_string()),
        ("model.api_key", String::new()),
        ("study.daily_new", "10".to_string()),
        ("study.daily_review", "50".to_string()),
        ("study.timezone", tz),
        ("ui.theme", "ink".to_string()),
        ("ui.capsule_metric", "due".to_string()),
        ("privacy.cloud_notice_seen", "0".to_string()),
        ("app.onboarded", "0".to_string()),
    ];
    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, now],
        )?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO app_meta(key, value) VALUES ('created_at', ?1)",
        rusqlite::params![now],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value, now_utc()],
    )?;
    Ok(())
}

pub fn get_setting_i64(conn: &Connection, key: &str, fallback: i64) -> i64 {
    get_setting(conn, key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(fallback)
}

pub fn get_setting_f64(conn: &Connection, key: &str, fallback: f64) -> f64 {
    get_setting(conn, key)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(fallback)
}

pub fn timezone(conn: &Connection) -> Tz {
    get_setting(conn, "study.timezone")
        .and_then(|v| v.parse::<Tz>().ok())
        .unwrap_or(chrono_tz::Asia::Shanghai)
}

pub fn local_today(conn: &Connection) -> (NaiveDate, Tz, String) {
    let tz = timezone(conn);
    let now = Utc::now().with_timezone(&tz);
    let date = now.date_naive();
    (date, tz, date.format("%Y-%m-%d").to_string())
}

pub fn log_event(conn: &Connection, kind: &str, payload: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO event_log(id, kind, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![new_id("evt"), kind, payload, now_utc()],
    )?;
    Ok(())
}

#[cfg(test)]
pub fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(SCHEMA_V1).unwrap();
    conn.pragma_update(None, "user_version", CURRENT_SCHEMA).unwrap();
    seed_defaults(&conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_opens_and_seeds_defaults() {
        let conn = test_conn();
        assert_eq!(get_setting_i64(&conn, "study.daily_new", -1), 10);
        assert_eq!(get_setting_i64(&conn, "study.daily_review", -1), 50);
        assert!(get_setting(&conn, "study.timezone").is_some());
    }

    #[test]
    fn settings_upsert() {
        let conn = test_conn();
        set_setting(&conn, "study.daily_new", "7").unwrap();
        set_setting(&conn, "study.daily_new", "8").unwrap();
        assert_eq!(get_setting_i64(&conn, "study.daily_new", 0), 8);
    }

    #[test]
    fn backup_failure_does_not_publish_or_replace_destination() {
        // Missing settings deliberately forces sanitization to fail.
        let conn = Connection::open_in_memory().unwrap();
        let directory = std::env::temp_dir().join(new_id("backup-failure-test"));
        std::fs::create_dir(&directory).unwrap();
        let target = directory.join("backup.db");
        assert!(backup_db(&conn, &target).is_err());
        assert!(!target.exists());
        let previous = b"previous backup must survive";
        std::fs::write(&target, previous).unwrap();
        assert!(backup_db(&conn, &target).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), previous);
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn backup_publish_failure_cleans_sanitized_temporary_file() {
        let conn = test_conn();
        let directory = std::env::temp_dir().join(new_id("backup-publish-test"));
        let target = directory.join("destination");
        std::fs::create_dir_all(&target).unwrap();
        assert!(backup_db(&conn, &target).is_err());
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn backup_cannot_replace_active_database() {
        let directory = std::env::temp_dir().join(new_id("backup-source-test"));
        let source = directory.join("source.db");
        let conn = open_db(&source).unwrap();
        set_setting(&conn, "study.daily_new", "7").unwrap();
        let result = backup_db(&conn, &source);
        assert!(matches!(result, Err(AppError::User { ref code, .. }) if code == "backup_is_source"));
        assert_eq!(get_setting_i64(&conn, "study.daily_new", 0), 7);
        drop(conn);
        let conn = open_db(&source).unwrap();
        assert_eq!(get_setting_i64(&conn, "study.daily_new", 0), 7);
        drop(conn);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
