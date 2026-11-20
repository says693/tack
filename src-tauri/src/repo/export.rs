use std::path::Path;

use rusqlite::{Connection, OptionalExtension, types::ValueRef};
use serde_json::{json, Map, Value};

use crate::db;
use crate::error::AppResult;
use crate::models::ExportResult;
use crate::scheduler;
use crate::text;

pub fn cards_tsv(conn: &Connection) -> AppResult<(String, i64)> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(cr.question, ''), COALESCE(cr.answer, ''), COALESCE(cr.evidence_excerpt, ''),
                COALESCE(cr.exercise_origin, 'unspecified'),
                ca.status, co.name, COALESCE(src.title, ''), COALESCE(ch.locator, ''),
                COALESCE(sr.label, '')
         FROM card ca
         JOIN concept co ON co.id = ca.concept_id
         LEFT JOIN card_revision cr ON cr.id = ca.current_revision_id
         LEFT JOIN chunk ch ON ch.id = cr.evidence_chunk_id
         LEFT JOIN source src ON src.id = ch.source_id
         LEFT JOIN source_revision sr ON sr.id = ch.revision_id
         WHERE ca.archived_at IS NULL
         ORDER BY co.name ASC, ca.updated_at DESC",
    )?;
    let mut out = String::from("#separator:tab\n#html:true\n");
    let mut rows = 0i64;
    let iter = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })?;
    for row in iter {
        let (question, answer, excerpt, origin, status, concept, source, locator, label) = row?;
        let origin_label = match origin.as_str() {
            "source_exact" => "原题",
            "adapted" => "改编",
            "generated" => "新编",
            _ => "待核",
        };
        let source_field = if source.is_empty() {
            "外部片段 / 来源未提供".to_string()
        } else {
            let mut parts = vec![format!("《{source}》")];
            if !label.is_empty() {
                parts.push(label);
            }
            if !locator.is_empty() {
                parts.push(locator);
            }
            if !excerpt.is_empty() {
                parts.push(excerpt.clone());
            }
            parts.join(" · ")
        };
        let fields = [
            text::anki_field(&question),
            text::anki_field(&answer),
            text::anki_field(&source_field),
            origin_label.to_string(),
            status_label(&status).to_string(),
            text::anki_field(&concept),
        ];
        out.push_str(&fields.join("\t"));
        out.push('\n');
        rows += 1;
    }
    Ok((out, rows))
}

fn status_label(status: &str) -> &'static str {
    match status {
        "active" => "启用",
        "draft" => "草稿",
        "paused" => "暂停",
        "archived" => "归档",
        _ => "未知",
    }
}

pub fn export_tsv(conn: &Connection, path: &Path) -> AppResult<ExportResult> {
    let (content, rows) = cards_tsv(conn)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content.as_bytes())?;
    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        rows,
        bytes: content.len() as i64,
    })
}

fn value_from_ref(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(v) => json!(v),
        ValueRef::Real(v) => json!(v),
        ValueRef::Text(v) => Value::String(String::from_utf8_lossy(v).to_string()),
        ValueRef::Blob(_) => Value::String("[blob omitted]".into()),
    }
}

fn query_json(conn: &Connection, sql: &str) -> AppResult<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut map = Map::new();
        for (i, name) in columns.iter().enumerate() {
            map.insert(name.clone(), value_from_ref(row.get_ref(i)?));
        }
        out.push(Value::Object(map));
    }
    Ok(out)
}

pub fn snapshot_json(conn: &Connection) -> AppResult<Value> {
    conn.execute_batch("BEGIN")?;
    let result = (|| -> AppResult<Value> {
        let sources = query_json(conn, "SELECT * FROM source ORDER BY created_at")?;
        let revisions = query_json(conn, "SELECT * FROM source_revision ORDER BY source_id, revision_no")?;
        let chunks = query_json(conn, "SELECT * FROM chunk ORDER BY source_id, revision_id, ordinal")?;
        let concepts = query_json(conn, "SELECT * FROM concept ORDER BY created_at")?;
        let cards = query_json(conn, "SELECT * FROM card ORDER BY created_at")?;
        let card_revisions = query_json(conn, "SELECT * FROM card_revision ORDER BY card_id, revision_no")?;
        let sessions = query_json(conn, "SELECT * FROM session ORDER BY created_at")?;
        let messages = query_json(conn, "SELECT * FROM message ORDER BY session_id, ordinal")?;
        let attempts = query_json(conn, "SELECT * FROM attempt ORDER BY started_at")?;
        let reviews = query_json(conn, "SELECT * FROM review ORDER BY reviewed_at")?;
        let assignments = query_json(conn, "SELECT * FROM daily_assignment ORDER BY local_date, created_at")?;
        let objections = query_json(conn, "SELECT * FROM objection ORDER BY created_at")?;
        let settings = query_json(
            conn,
            "SELECT key, value, updated_at FROM settings
             WHERE key NOT LIKE '%api_key%' AND key NOT LIKE '%token%' AND key NOT LIKE '%secret%'
             ORDER BY key",
        )?;
        let counts = json!({
            "sources": sources.len(),
            "sourceRevisions": revisions.len(),
            "chunks": chunks.len(),
            "concepts": concepts.len(),
            "cards": cards.len(),
            "cardRevisions": card_revisions.len(),
            "sessions": sessions.len(),
            "messages": messages.len(),
            "attempts": attempts.len(),
            "reviews": reviews.len(),
            "dailyAssignments": assignments.len()
        });
        Ok(json!({
            "format": "fold-export/1",
            "exportedAt": db::now_utc(),
            "appVersion": env!("CARGO_PKG_VERSION"),
            "scheduler": scheduler::SCHEDULER_ID,
            "note": "这是学习数据的结构与历史快照，不包含原始 PDF/图片附件，也不是完整材料备份。API 密钥不会导出。",
            "counts": counts,
            "data": {
                "sources": sources,
                "sourceRevisions": revisions,
                "chunks": chunks,
                "concepts": concepts,
                "cards": cards,
                "cardRevisions": card_revisions,
                "sessions": sessions,
                "messages": messages,
                "attempts": attempts,
                "reviews": reviews,
                "dailyAssignments": assignments,
                "objections": objections,
                "settings": settings
            }
        }))
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(e) => {
            crate::repo::rollback(conn);
            Err(e)
        }
    }
}

pub fn export_json(conn: &Connection, path: &Path) -> AppResult<ExportResult> {
    let value = snapshot_json(conn)?;
    let content = serde_json::to_string_pretty(&value)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content.as_bytes())?;
    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        rows: value
            .pointer("/counts/cards")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        bytes: content.len() as i64,
    })
}

pub fn backup_db(conn: &Connection, path: &Path) -> AppResult<ExportResult> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    conn.backup(rusqlite::MAIN_DB, path, None)?;
    db::sanitize_backup_db(path)?;
    let bytes = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        rows: 0,
        bytes,
    })
}

#[allow(dead_code)]
fn _unused(conn: &Connection) -> AppResult<()> {
    let _: Option<String> = conn
        .query_row("SELECT key FROM settings LIMIT 1", [], |r| r.get(0))
        .optional()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO source(id,title,kind,origin,trust_tier,created_at) VALUES ('s1','测试来源','txt','import',1,'2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO source_revision(id,source_id,revision_no,content,content_hash,label,created_at) VALUES ('r1','s1',1,'原文','h','版本 1','2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chunk(id,source_id,revision_id,ordinal,quote_exact,prefix,suffix,start_utf16,end_utf16,created_at) VALUES ('c1','s1','r1',0,'原文','','',0,2,'2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept(id,name,source_id,chunk_id,state,created_at) VALUES ('co1','概念','s1','c1','new','2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO card(id,concept_id,status,mode,current_revision_id,created_at,updated_at) VALUES ('ca1','co1','active','ai','cr1','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO card_revision(id,card_id,revision_no,question,answer,evidence_chunk_id,evidence_excerpt,exercise_origin,created_at) VALUES ('cr1','ca1',1,'问题<一\t和二','答案\n第三行','c1','原文','generated','2026-11-15T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn tsv_keeps_tabs_and_newlines_out_of_columns() {
        let conn = test_conn();
        seed(&conn);
        let (tsv, rows) = cards_tsv(&conn).unwrap();
        assert_eq!(rows, 1);
        let line = tsv.lines().last().unwrap();
        assert_eq!(line.split('\t').count(), 6);
        assert!(!line.contains('\n'));
        assert!(line.contains("&lt;"));
    }

    #[test]
    fn json_snapshot_excludes_api_key() {
        let conn = test_conn();
        seed(&conn);
        crate::db::set_setting(&conn, "model.api_key", "sk-secret-value").unwrap();
        let value = snapshot_json(&conn).unwrap();
        let text = serde_json::to_string(&value).unwrap();
        assert!(!text.contains("sk-secret-value"));
        assert_eq!(value.pointer("/counts/cards").unwrap().as_i64(), Some(1));
        assert_eq!(value.pointer("/counts/sources").unwrap().as_i64(), Some(1));
    }

    #[test]
    fn backup_db_strips_sensitive_settings() {
        let conn = test_conn();
        seed(&conn);
        crate::db::set_setting(&conn, "model.api_key", "sk-never-in-backup").unwrap();
        crate::db::set_setting(&conn, "auth.token", "tok-never-in-backup").unwrap();
        crate::db::set_setting(&conn, "custom.secret", "sec-never-in-backup").unwrap();
        let target = std::env::temp_dir().join(format!("{}.db", crate::db::new_id("backup-test")));

        let result = backup_db(&conn, &target).unwrap();
        assert!(result.bytes > 0);
        let backup_conn = Connection::open(&target).unwrap();
        for key in ["model.api_key", "auth.token", "custom.secret"] {
            assert_eq!(crate::db::get_setting(&backup_conn, key).as_deref(), Some(""));
        }
        assert_eq!(
            crate::db::get_setting(&conn, "model.api_key").as_deref(),
            Some("sk-never-in-backup")
        );
        drop(backup_conn);
        for ext in ["db", "db-wal", "db-shm"] {
            let _ = std::fs::remove_file(target.with_extension(ext));
        }
    }
}
