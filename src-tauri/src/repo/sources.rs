use rusqlite::{Connection, OptionalExtension};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::text;

use super::{chunk_select, get_chunk, get_source, map_chunk, map_revision, map_source, source_select};

pub fn source_detail(conn: &Connection, source_id: &str, revision_id: Option<&str>) -> AppResult<SourceDetail> {
    let source = get_source(conn, source_id)?;
    let revision: SourceRevision = if let Some(rev_id) = revision_id {
        conn.query_row(
            "SELECT id, source_id, revision_no, content, content_hash, label, created_at
             FROM source_revision WHERE id = ?1 AND source_id = ?2",
            rusqlite::params![rev_id, source_id],
            |row| {
                Ok(SourceRevision {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    revision_no: row.get(2)?,
                    content: row.get(3)?,
                    content_hash: row.get(4)?,
                    label: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::user("revision_not_found", "该来源版本不存在。"))?
    } else {
        conn.query_row(
            "SELECT id, source_id, revision_no, content, content_hash, label, created_at
             FROM source_revision WHERE source_id = ?1 ORDER BY revision_no DESC LIMIT 1",
            [source_id],
            |row| {
                Ok(SourceRevision {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    revision_no: row.get(2)?,
                    content: row.get(3)?,
                    content_hash: row.get(4)?,
                    label: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::user("revision_not_found", "该来源还没有内容版本。"))?
    };
    let mut stmt = conn.prepare(
        "SELECT id, revision_no, label, created_at, content_hash, LENGTH(content) as chars
         FROM source_revision WHERE source_id = ?1 ORDER BY revision_no DESC",
    )?;
    let revisions = stmt
        .query_map([source_id], |row| {
            Ok(RevisionSummary {
                id: row.get(0)?,
                revision_no: row.get(1)?,
                label: row.get(2)?,
                created_at: row.get(3)?,
                content_hash: row.get(4)?,
                char_count: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let chunks = super::chunks_for_revision(conn, &revision.id)?;
    db::log_event(
        conn,
        "source_opened",
        &serde_json::json!({"sourceId": source_id, "revisionId": revision.id}).to_string(),
    )?;
    super::touch_source(conn, source_id)?;
    Ok(SourceDetail {
        source,
        revision,
        revisions,
        chunks,
    })
}

pub fn import_source(conn: &Connection, input: ImportSourceInput) -> AppResult<SourceDetail> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::user("title_required", "请给材料一个标题。"));
    }
    if input.text.trim().is_empty() {
        return Err(AppError::user("text_required", "材料内容不能为空。"));
    }
    if input.text.chars().count() > 2_000_000 {
        return Err(AppError::user("text_too_large", "单个文本材料上限为 200 万字符。"));
    }
    let kind = match input.kind.as_str() {
        "md" | "txt" | "external" => input.kind.as_str(),
        _ => "txt",
    };
    let origin = input.origin.as_deref().unwrap_or("import");
    let hash = text::sha256_hex(&input.text);
    let now = db::now_utc();

    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<String> {
        let source_id = if let Some(existing) = input.replace_source_id.as_deref() {
            get_source(conn, existing)?;
            let latest: Option<(i64, String)> = conn
                .query_row(
                    "SELECT revision_no, content_hash FROM source_revision
                     WHERE source_id = ?1 ORDER BY revision_no DESC LIMIT 1",
                    [existing],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((_, latest_hash)) = latest {
                if latest_hash == hash {
                    return Ok(existing.to_string());
                }
            }
            existing.to_string()
        } else {
            let id = db::new_id("src");
            conn.execute(
                "INSERT INTO source(id, title, kind, origin, trust_tier, note, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    id,
                    title,
                    kind,
                    origin,
                    if origin == "sample" || origin == "external" { 0 } else { 1 },
                    input.note,
                    now
                ],
            )?;
            id
        };
        if input.replace_source_id.is_some() {
            conn.execute(
                "UPDATE source SET title = ?1, note = COALESCE(?2, note) WHERE id = ?3",
                rusqlite::params![title, input.note, source_id],
            )?;
        }
        let revision_no: i64 = conn.query_row(
            "SELECT COALESCE(MAX(revision_no), 0) + 1 FROM source_revision WHERE source_id = ?1",
            [&source_id],
            |r| r.get(0),
        )?;
        let revision_id = db::new_id("rev");
        let label = input
            .label
            .clone()
            .unwrap_or_else(|| format!("版本 {revision_no}"));
        conn.execute(
            "INSERT INTO source_revision(id, source_id, revision_no, content, content_hash, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![revision_id, source_id, revision_no, input.text, hash, label, now],
        )?;
        insert_paragraph_chunks(conn, &source_id, &revision_id, &input.text)?;
        Ok(source_id)
    })();
    match result {
        Ok(source_id) => {
            conn.execute_batch("COMMIT")?;
            db::log_event(conn, "source_imported", &serde_json::json!({"sourceId": source_id}).to_string())?;
            source_detail(conn, &source_id, None)
        }
        Err(err) => {
            super::rollback(conn);
            Err(err)
        }
    }
}

fn insert_paragraph_chunks(conn: &Connection, source_id: &str, revision_id: &str, content: &str) -> AppResult<()> {
    let paragraphs = text::split_paragraphs(content);
    let now = db::now_utc();
    for (index, paragraph) in paragraphs.iter().enumerate() {
        let start = text::char_index_to_utf16(content, paragraph.start_char);
        let end = text::char_index_to_utf16(content, paragraph.end_char);
        let (prefix, suffix) = text::context_around(content, start, end, 48);
        let id = db::new_id("chk");
        let locator = paragraph
            .heading
            .as_ref()
            .map(|h| format!("§{h} · 第 {} 段", index + 1))
            .unwrap_or_else(|| format!("第 {} 段", index + 1));
        conn.execute(
            "INSERT INTO chunk(id, source_id, revision_id, ordinal, heading, locator, quote_exact,
                prefix, suffix, start_utf16, end_utf16, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                id,
                source_id,
                revision_id,
                index as i64,
                paragraph.heading,
                locator,
                paragraph.text,
                prefix,
                suffix,
                start as i64,
                end as i64,
                now
            ],
        )?;
    }
    Ok(())
}

pub fn create_chunk(conn: &Connection, input: ChunkInput) -> AppResult<ChunkView> {
    let revision: SourceRevision = conn
        .query_row(
            "SELECT id, source_id, revision_no, content, content_hash, label, created_at
             FROM source_revision WHERE id = ?1 AND source_id = ?2",
            rusqlite::params![input.revision_id, input.source_id],
            |row| {
                Ok(SourceRevision {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    revision_no: row.get(2)?,
                    content: row.get(3)?,
                    content_hash: row.get(4)?,
                    label: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::user("revision_not_found", "来源版本不存在。"))?;
    if input.quote_exact.trim().is_empty() {
        return Err(AppError::user("empty_selection", "选区为空。"));
    }
    let resolved = text::resolve_quote(
        &revision.content,
        &input.quote_exact,
        &input.prefix,
        &input.suffix,
        input.start_utf16,
    )
    .ok_or_else(|| {
        AppError::user(
            "quote_not_found",
            "这段原文在当前版本中无法定位。请重新选择，或切换到保存时的来源版本。",
        )
    })?;
    let (prefix, suffix) = if input.prefix.is_empty() && input.suffix.is_empty() {
        text::context_around(&revision.content, resolved.0, resolved.1, 48)
    } else {
        (input.prefix.clone(), input.suffix.clone())
    };
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM chunk WHERE revision_id = ?1 AND start_utf16 = ?2 AND end_utf16 = ?3
             AND quote_exact = ?4 LIMIT 1",
            rusqlite::params![
                input.revision_id,
                resolved.0 as i64,
                resolved.1 as i64,
                input.quote_exact
            ],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return get_chunk(conn, &id);
    }
    let ordinal: i64 = conn.query_row(
        "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM chunk WHERE revision_id = ?1",
        [&input.revision_id],
        |r| r.get(0),
    )?;
    let id = db::new_id("chk");
    let locator = input
        .locator
        .clone()
        .unwrap_or_else(|| format!("自定义选区 · 第 {ordinal} 段"));
    conn.execute(
        "INSERT INTO chunk(id, source_id, revision_id, ordinal, heading, locator, quote_exact,
            prefix, suffix, start_utf16, end_utf16, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            id,
            input.source_id,
            input.revision_id,
            ordinal,
            input.heading,
            locator,
            input.quote_exact,
            prefix,
            suffix,
            resolved.0 as i64,
            resolved.1 as i64,
            db::now_utc()
        ],
    )?;
    get_chunk(conn, &id)
}

pub fn list_annotations(conn: &Connection, source_id: &str, revision_id: &str) -> AppResult<Vec<SourceAnnotation>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.quote_exact, c.heading, c.locator, c.start_utf16, c.end_utf16,
                s.id AS session_id, s.seed_name AS session_name,
                ca.id AS card_id, cr.question AS card_question
         FROM chunk c
         LEFT JOIN session s ON s.fork_chunk_id = c.id AND s.archived_at IS NULL
         LEFT JOIN card_revision cr ON cr.evidence_chunk_id = c.id
         LEFT JOIN card ca ON ca.id = cr.card_id AND ca.archived_at IS NULL
         WHERE c.source_id = ?1 AND c.revision_id = ?2
           AND (s.id IS NOT NULL OR ca.id IS NOT NULL)
         ORDER BY c.start_utf16 ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![source_id, revision_id], |row| {
        let session_id: Option<String> = row.get("session_id")?;
        let card_id: Option<String> = row.get("card_id")?;
        let kind = match (session_id.is_some(), card_id.is_some()) {
            (true, true) => "both",
            (true, false) => "session",
            (false, true) => "card",
            _ => "none",
        };
        Ok(SourceAnnotation {
            chunk_id: row.get("id")?,
            quote_exact: row.get("quote_exact")?,
            heading: row.get("heading")?,
            locator: row.get("locator")?,
            start_utf16: row.get("start_utf16")?,
            end_utf16: row.get("end_utf16")?,
            session_id,
            session_name: row.get("session_name")?,
            card_id,
            card_question: row.get("card_question")?,
            kind: kind.into(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_source(conn: &Connection, source_id: &str) -> AppResult<i64> {
    get_source(conn, source_id)?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<i64> {
        let paused = conn.execute(
            "UPDATE card SET status = 'paused', paused_reason = '来源已删除，等待重新定位', updated_at = ?1
             WHERE status = 'active' AND concept_id IN (
               SELECT co.id FROM concept co JOIN chunk ch ON ch.id = co.chunk_id WHERE ch.source_id = ?2
               UNION
               SELECT co.id FROM concept co JOIN card_revision cr ON cr.evidence_chunk_id IS NOT NULL
                 JOIN chunk ch ON ch.id = cr.evidence_chunk_id
                 JOIN card ca ON ca.id = cr.card_id
                 WHERE ca.concept_id = co.id AND ch.source_id = ?2
             )",
            rusqlite::params![db::now_utc(), source_id],
        )? as i64;
        conn.execute(
            "UPDATE source SET archived_at = ?1 WHERE id = ?2",
            rusqlite::params![db::now_utc(), source_id],
        )?;
        db::log_event(
            conn,
            "source_deleted",
            &serde_json::json!({"sourceId": source_id, "pausedCards": paused}).to_string(),
        )?;
        Ok(paused)
    })();
    match result {
        Ok(paused) => {
            conn.execute_batch("COMMIT")?;
            Ok(paused)
        }
        Err(e) => {
            super::rollback(conn);
            Err(e)
        }
    }
}

#[cfg(test)]
pub fn seed_demo(conn: &Connection) -> AppResult<Vec<SourceSummary>> {
    const DEMO_A_V1: &str = "青石镇档案室规定：蓝色盒存放待登记条目，绿色盒存放已登记条目。管理员先核对编号，再将条目登记，登记完成后从蓝色盒移入绿色盒。每日最多处理十个新条目。引用一段记录不等于核实了整份记录。";
    const DEMO_B_V1: &str = "白塔镇档案室规定：绿色盒存放待登记条目，蓝色盒存放已登记条目。管理员先核对编号，再将条目登记。引用一段记录不等于核实了整份记录。";
    const DEMO_A_V2: &str = "青石镇档案室规定：蓝色盒存放待登记条目，绿色盒存放已登记条目。管理员先登记，再由第二位管理员核对编号。每日最多处理八个新条目。";

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM source WHERE origin = 'sample' AND title = '青石镇档案室' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        import_source(
            conn,
            ImportSourceInput {
                title: "青石镇档案室".into(),
                kind: "md".into(),
                text: format!("# 材料 A · 青石镇档案室\n\n{DEMO_A_V1}\n\n## 登记流程\n\n管理员先核对编号，再将条目登记，登记完成后从蓝色盒移入绿色盒。\n\n## 每日上限\n\n每日最多处理十个新条目。"),
                label: Some("版本 1".into()),
                origin: Some("sample".into()),
                note: Some("虚构示例材料，用于体验与验收，不是事实来源。".into()),
                replace_source_id: None,
            },
        )?;
        import_source(
            conn,
            ImportSourceInput {
                title: "白塔镇档案室".into(),
                kind: "md".into(),
                text: format!("# 材料 B · 白塔镇档案室\n\n{DEMO_B_V1}"),
                label: Some("版本 1".into()),
                origin: Some("sample".into()),
                note: Some("虚构示例材料，用于区分同名条目与不同来源。".into()),
                replace_source_id: None,
            },
        )?;
        let a_id: String = conn.query_row(
            "SELECT id FROM source WHERE origin = 'sample' AND title = '青石镇档案室' LIMIT 1",
            [],
            |r| r.get(0),
        )?;
        import_source(
            conn,
            ImportSourceInput {
                title: "青石镇档案室".into(),
                kind: "md".into(),
                text: format!("# 材料 A · 青石镇档案室（修订）\n\n{DEMO_A_V2}\n\n## 每日上限\n\n每日最多处理八个新条目。"),
                label: Some("版本 2 · 规则变更".into()),
                origin: Some("sample".into()),
                note: Some("同一来源的后续版本。旧卡片仍引用版本 1。".into()),
                replace_source_id: Some(a_id),
            },
        )?;
    }
    db::set_setting(conn, "app.onboarded", "1")?;
    super::list_sources(conn, false)
}

pub fn external_fragment(conn: &Connection, content: &str, note: Option<String>) -> AppResult<SourceDetail> {
    let stamp = chrono::Local::now().format("%m-%d %H:%M");
    import_source(
        conn,
        ImportSourceInput {
            title: format!("外部片段 · {stamp}"),
            kind: "external".into(),
            text: content.to_string(),
            label: Some("粘贴内容".into()),
            origin: Some("external".into()),
            note: Some(note.unwrap_or_else(|| "外部片段 / 来源未提供。".into())),
            replace_source_id: None,
        },
    )
}

#[allow(dead_code)]
fn _unused(conn: &Connection) -> AppResult<()> {
    let _ = conn.prepare(source_select())?;
    let _ = conn.prepare(chunk_select())?;
    let _ = map_revision;
    let _ = map_source;
    let _ = map_chunk;
    Ok(())
}
