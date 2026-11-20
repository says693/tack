use rusqlite::{Connection, OptionalExtension};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::text;

use super::{card_select, get_card_detail, get_card_summary, get_chunk, map_card};

const ORIGINS: [&str; 4] = ["source_exact", "adapted", "generated", "unspecified"];

fn validate_origin(origin: &str, mode: &str, question: &str, chunk: Option<&ChunkView>) -> AppResult<()> {
    if !ORIGINS.contains(&origin) {
        return Err(AppError::user(
            "bad_exercise_origin",
            "题源类别只能是 source_exact / adapted / generated / unspecified。",
        ));
    }
    if mode == "ai" && chunk.is_none() {
        return Err(AppError::user(
            "evidence_required",
            "来源约束的 AI 考核必须绑定原文证据。纯模型补充不能直接进入 AI 考核。",
        ));
    }
    if origin == "source_exact" {
        let ch = chunk.ok_or_else(|| AppError::user("evidence_required", "原题必须绑定原文位置。"))?;
        let normalized_q = question.split_whitespace().collect::<String>();
        let normalized_text = ch.quote_exact.split_whitespace().collect::<String>();
        if !normalized_text.contains(&normalized_q) {
            return Err(AppError::user(
                "origin_not_exact",
                "题干并不在所选原文中，不能标为「原题」。可改为「改编」或「新编」。",
            ));
        }
    }
    if origin == "adapted" && chunk.is_none() {
        return Err(AppError::user(
            "evidence_required",
            "改编题也必须保留原题所在片段。",
        ));
    }
    Ok(())
}

fn find_or_create_concept(
    conn: &Connection,
    name: &str,
    source_id: Option<&str>,
    chunk_id: Option<&str>,
) -> AppResult<String> {
    let existing: Option<String> = if let Some(source_id) = source_id {
        conn.query_row(
            "SELECT id FROM concept WHERE name = ?1 AND source_id = ?2 AND archived_at IS NULL LIMIT 1",
            rusqlite::params![name, source_id],
            |r| r.get(0),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT id FROM concept WHERE name = ?1 AND source_id IS NULL AND archived_at IS NULL LIMIT 1",
            [name],
            |r| r.get(0),
        )
        .optional()?
    };
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = db::new_id("con");
    conn.execute(
        "INSERT INTO concept(id, source_id, chunk_id, name, origin, state, created_at)
         VALUES (?1, ?2, ?3, ?4, 'user_selected', 'new', ?5)",
        rusqlite::params![id, source_id, chunk_id, name, db::now_utc()],
    )?;
    Ok(id)
}

fn resolve_evidence(chunk: Option<&ChunkView>, raw_excerpt: &str) -> AppResult<(Option<String>, String)> {
    let Some(ch) = chunk else {
        return Ok((None, String::new()));
    };
    let excerpt = if raw_excerpt.trim().is_empty() {
        text::truncate_chars(&ch.quote_exact, 220)
    } else {
        let excerpt = raw_excerpt.trim();
        let normalized_excerpt = excerpt.split_whitespace().collect::<String>();
        let normalized_text = ch.quote_exact.split_whitespace().collect::<String>();
        if !normalized_text.contains(&normalized_excerpt) {
            return Err(AppError::user(
                "evidence_unmatched",
                "证据摘录不在所选原文片段中，已拒绝保存。",
            ));
        }
        excerpt.to_string()
    };
    Ok((Some(ch.id.clone()), excerpt))
}

pub fn create_draft(conn: &Connection, input: CardDraftInput) -> AppResult<CardDetail> {
    let concept_name = input.concept_name.trim();
    let question = input.question.trim();
    let answer = input.answer.trim();
    if concept_name.is_empty() {
        return Err(AppError::user("concept_required", "请给这张卡一个概念名。"));
    }
    if question.is_empty() || answer.is_empty() {
        return Err(AppError::user("card_incomplete", "问题与答案都不能为空。"));
    }
    if question.chars().count() > 500 || answer.chars().count() > 4000 {
        return Err(AppError::user("card_too_long", "题目或答案过长。"));
    }
    let mode = if input.mode == "self" { "self" } else { "ai" };
    let chunk = input
        .evidence_chunk_id
        .as_deref()
        .map(|id| get_chunk(conn, id))
        .transpose()?;
    validate_origin(&input.exercise_origin, mode, question, chunk.as_ref())?;
    let (evidence_id, evidence_excerpt) = resolve_evidence(chunk.as_ref(), &input.evidence_excerpt)?;
    let source_id = chunk.as_ref().map(|c| c.source_id.clone());
    let chunk_id = chunk.as_ref().map(|c| c.id.clone());
    let concept_id = find_or_create_concept(conn, concept_name, source_id.as_deref(), chunk_id.as_deref())?;
    let now = db::now_utc();
    let card_id = db::new_id("crd");
    let revision_id = db::new_id("crv");
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<()> {
        conn.execute(
            "INSERT INTO card(id, concept_id, session_id, kind, status, mode, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'recall', 'draft', ?4, ?5, ?5)",
            rusqlite::params![card_id, concept_id, input.session_id, mode, now],
        )?;
        conn.execute(
            "INSERT INTO card_revision(id, card_id, revision_no, question, answer, evidence_chunk_id,
                evidence_excerpt, exercise_origin, origin_note, created_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                revision_id,
                card_id,
                question,
                answer,
                evidence_id,
                evidence_excerpt,
                input.exercise_origin,
                input.origin_note,
                now
            ],
        )?;
        conn.execute(
            "UPDATE card SET current_revision_id = ?1 WHERE id = ?2",
            rusqlite::params![revision_id, card_id],
        )?;
        if let Some(session_id) = input.session_id.as_deref() {
            conn.execute(
                "UPDATE session SET concept_id = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![concept_id, now, session_id],
            )?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            db::log_event(
                conn,
                "card_drafted",
                &serde_json::json!({"cardId": card_id, "origin": input.exercise_origin, "mode": mode}).to_string(),
            )?;
            get_card_detail(conn, &card_id)
        }
        Err(e) => {
            super::rollback(conn);
            Err(e)
        }
    }
}

pub fn update_card(conn: &Connection, card_id: &str, input: CardRevisionInput) -> AppResult<CardUpdateResult> {
    let card = get_card_summary(conn, card_id)?;
    if card.status == "archived" {
        return Err(AppError::user("card_archived", "已归档的卡片不能编辑。"));
    }
    let question = input.question.trim();
    let answer = input.answer.trim();
    if question.is_empty() || answer.is_empty() {
        return Err(AppError::user("card_incomplete", "问题与答案都不能为空。"));
    }
    if question.chars().count() > 500 || answer.chars().count() > 4000 {
        return Err(AppError::user("card_too_long", "题目或答案过长。"));
    }
    let chunk = input
        .evidence_chunk_id
        .as_deref()
        .map(|id| get_chunk(conn, id))
        .transpose()?;
    validate_origin(&input.exercise_origin, &card.mode, question, chunk.as_ref())?;
    let (evidence_id, evidence_excerpt) = resolve_evidence(chunk.as_ref(), &input.evidence_excerpt)?;
    let current = card
        .revision_id
        .as_deref()
        .ok_or_else(|| AppError::user("revision_not_found", "卡片没有可编辑的修订。"))?;
    let old = super::get_revision(conn, current)?;
    let semantic_change = old.question.trim() != question || old.answer.trim() != answer;
    let now = db::now_utc();
    let mut needs_decision = false;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<()> {
        if card.status == "draft" {
            conn.execute(
                "UPDATE card_revision SET question = ?1, answer = ?2, evidence_chunk_id = ?3,
                    evidence_excerpt = ?4, exercise_origin = ?5, origin_note = ?6
                 WHERE id = ?7",
                rusqlite::params![
                    question,
                    answer,
                    evidence_id,
                    evidence_excerpt,
                    input.exercise_origin,
                    input.origin_note,
                    current
                ],
            )?;
        } else {
            let next_rev: i64 = conn.query_row(
                "SELECT COALESCE(MAX(revision_no), 0) + 1 FROM card_revision WHERE card_id = ?1",
                [card_id],
                |r| r.get(0),
            )?;
            let revision_id = db::new_id("crv");
            conn.execute(
                "INSERT INTO card_revision(id, card_id, revision_no, question, answer, evidence_chunk_id,
                    evidence_excerpt, exercise_origin, origin_note, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    revision_id,
                    card_id,
                    next_rev,
                    question,
                    answer,
                    evidence_id,
                    evidence_excerpt,
                    input.exercise_origin,
                    input.origin_note,
                    now
                ],
            )?;
            conn.execute(
                "UPDATE card SET current_revision_id = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![revision_id, now, card_id],
            )?;
            if semantic_change && card.status == "active" {
                conn.execute(
                    "UPDATE card SET status = 'paused', paused_reason = '修订待确认：保留原排期，或重置该概念排期', updated_at = ?1 WHERE id = ?2",
                    rusqlite::params![now, card_id],
                )?;
                needs_decision = true;
            }
        }
        conn.execute("UPDATE card SET updated_at = ?1 WHERE id = ?2", rusqlite::params![now, card_id])?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            db::log_event(
                conn,
                "card_edited",
                &serde_json::json!({"cardId": card_id, "semanticChange": semantic_change, "needsDecision": needs_decision}).to_string(),
            )?;
            Ok(CardUpdateResult {
                card: get_card_detail(conn, card_id)?,
                semantic_change,
                needs_schedule_decision: needs_decision,
            })
        }
        Err(e) => {
            super::rollback(conn);
            Err(e)
        }
    }
}

pub fn accept_card(conn: &Connection, card_id: &str) -> AppResult<CardDetail> {
    let card = get_card_summary(conn, card_id)?;
    if card.status != "draft" {
        return Err(AppError::user("card_not_draft", "只有草稿可以「收下」。"));
    }
    let Some(rev_id) = card.revision_id.as_deref() else {
        return Err(AppError::user("card_incomplete", "卡片没有内容。"));
    };
    let source_archived: bool = conn
        .query_row(
            "SELECT COALESCE((SELECT s.archived_at IS NOT NULL
                              FROM card_revision cr
                              JOIN chunk ch ON ch.id = cr.evidence_chunk_id
                              JOIN source s ON s.id = ch.source_id
                              WHERE cr.id = ?1), 0)",
            [rev_id],
            |r| r.get(0),
        )?;
    if source_archived {
        return Err(AppError::user(
            "source_archived",
            "这张卡片关联的来源已被删除，请先重新绑定有效原文后再收下。",
        ));
    }
    conn.execute(
        "UPDATE card SET status = 'active', paused_reason = NULL, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![db::now_utc(), card_id],
    )?;
    db::log_event(
        conn,
        "card_accepted",
        &serde_json::json!({"cardId": card_id, "conceptId": card.concept_id}).to_string(),
    )?;
    get_card_detail(conn, card_id)
}

pub fn resolve_revision(conn: &Connection, card_id: &str, decision: &str) -> AppResult<CardDetail> {
    let card = get_card_summary(conn, card_id)?;
    if card.status != "paused" {
        return Err(AppError::user("card_not_paused", "这张卡当前不需要排期决定。"));
    }
    match decision {
        "keep" => {
            conn.execute(
                "UPDATE card SET status = 'active', paused_reason = NULL, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![db::now_utc(), card_id],
            )?;
        }
        "reset" => {
            conn.execute(
                "UPDATE concept SET state = 'new', ease = 2.5, interval_days = 0, reps = 0,
                    lapses = 0, due_on = NULL, last_reviewed_at = NULL WHERE id = ?1",
                [&card.concept_id],
            )?;
            conn.execute(
                "UPDATE card SET status = 'active', paused_reason = NULL, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![db::now_utc(), card_id],
            )?;
        }
        _ => return Err(AppError::user("bad_decision", "决定只能是 keep 或 reset。")),
    }
    db::log_event(
        conn,
        "card_revision_resolved",
        &serde_json::json!({"cardId": card_id, "decision": decision}).to_string(),
    )?;
    get_card_detail(conn, card_id)
}

pub fn pause_card(conn: &Connection, card_id: &str, reason: Option<&str>) -> AppResult<CardDetail> {
    let card = get_card_summary(conn, card_id)?;
    if card.status != "active" {
        return Err(AppError::user("card_not_active", "只有启用中的卡片可以暂停。"));
    }
    conn.execute(
        "UPDATE card SET status = 'paused', paused_reason = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![reason.unwrap_or("已暂停"), db::now_utc(), card_id],
    )?;
    get_card_detail(conn, card_id)
}

pub fn archive_card(conn: &Connection, card_id: &str) -> AppResult<CardDetail> {
    get_card_summary(conn, card_id)?;
    conn.execute(
        "UPDATE card SET status = 'archived', archived_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![db::now_utc(), card_id],
    )?;
    db::log_event(conn, "card_archived", &serde_json::json!({"cardId": card_id}).to_string())?;
    get_card_detail(conn, card_id)
}

pub fn list_cards(conn: &Connection, status: Option<&str>) -> AppResult<Vec<CardSummary>> {
    let sql = if status.is_some() {
        format!(
            "{} WHERE ca.archived_at IS NULL AND ca.status = ?1 ORDER BY ca.updated_at DESC",
            card_select()
        )
    } else {
        format!("{} WHERE ca.archived_at IS NULL ORDER BY ca.updated_at DESC", card_select())
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(status) = status {
        stmt.query_map([status], map_card)?
    } else {
        stmt.query_map([], map_card)?
    };
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

