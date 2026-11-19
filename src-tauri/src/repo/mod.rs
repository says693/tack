use std::path::Path;

use chrono::{Datelike, Duration, Weekday};
use rusqlite::{Connection, OptionalExtension, Row};
use serde_json::Value;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::llm::LlmConfig;
use crate::models::*;

pub mod cards;
pub mod export;
pub mod queue;
pub mod review;
pub mod sessions;
pub mod sources;

pub fn map_source(row: &Row<'_>) -> rusqlite::Result<SourceSummary> {
    Ok(SourceSummary {
        id: row.get("id")?,
        title: row.get("title")?,
        kind: row.get("kind")?,
        origin: row.get("origin")?,
        trust_tier: row.get("trust_tier")?,
        revision_count: row.get("revision_count")?,
        current_revision_no: row.get("current_revision_no")?,
        chunk_count: row.get("chunk_count")?,
        created_at: row.get("created_at")?,
        last_read_at: row.get("last_read_at")?,
        archived: row.get::<_, Option<String>>("archived_at")?.is_some(),
        note: row.get("note")?,
    })
}

pub fn source_select() -> &'static str {
    "SELECT s.id, s.title, s.kind, s.origin, s.trust_tier, s.created_at, s.last_read_at,
            s.archived_at, s.note,
            (SELECT COUNT(*) FROM source_revision r WHERE r.source_id = s.id) AS revision_count,
            COALESCE((SELECT MAX(revision_no) FROM source_revision r WHERE r.source_id = s.id), 0) AS current_revision_no,
            (SELECT COUNT(*) FROM chunk c WHERE c.source_id = s.id) AS chunk_count
     FROM source s"
}

pub fn list_sources(conn: &Connection, include_archived: bool) -> AppResult<Vec<SourceSummary>> {
    let sql = format!(
        "{} {} ORDER BY s.created_at DESC",
        source_select(),
        if include_archived { "" } else { "WHERE s.archived_at IS NULL" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_source)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_source(conn: &Connection, source_id: &str) -> AppResult<SourceSummary> {
    let sql = format!("{} WHERE s.id = ?1", source_select());
    conn.query_row(&sql, [source_id], map_source)
        .optional()?
        .ok_or_else(|| AppError::user("source_not_found", "来源不存在或已被删除。"))
}

pub fn map_chunk(row: &Row<'_>) -> rusqlite::Result<ChunkView> {
    Ok(ChunkView {
        id: row.get("id")?,
        source_id: row.get("source_id")?,
        revision_id: row.get("revision_id")?,
        ordinal: row.get("ordinal")?,
        heading: row.get("heading")?,
        locator: row.get("locator")?,
        quote_exact: row.get("quote_exact")?,
        prefix: row.get("prefix")?,
        suffix: row.get("suffix")?,
        start_utf16: row.get("start_utf16")?,
        end_utf16: row.get("end_utf16")?,
        session_count: row.get("session_count")?,
        card_count: row.get("card_count")?,
        created_at: row.get("created_at")?,
    })
}

pub fn chunk_select() -> &'static str {
    "SELECT c.id, c.source_id, c.revision_id, c.ordinal, c.heading, c.locator,
            c.quote_exact, c.prefix, c.suffix, c.start_utf16, c.end_utf16, c.created_at,
            (SELECT COUNT(*) FROM session s WHERE s.fork_chunk_id = c.id AND s.archived_at IS NULL) AS session_count,
            (SELECT COUNT(*) FROM card_revision cr JOIN card ca ON ca.id = cr.card_id
              WHERE cr.evidence_chunk_id = c.id AND ca.archived_at IS NULL) AS card_count
     FROM chunk c"
}

pub fn get_chunk(conn: &Connection, chunk_id: &str) -> AppResult<ChunkView> {
    let sql = format!("{} WHERE c.id = ?1", chunk_select());
    conn.query_row(&sql, [chunk_id], map_chunk)
        .optional()?
        .ok_or_else(|| AppError::user("chunk_not_found", "原文片段不存在。"))
}

pub fn chunks_for_revision(conn: &Connection, revision_id: &str) -> AppResult<Vec<ChunkView>> {
    let sql = format!("{} WHERE c.revision_id = ?1 ORDER BY c.ordinal ASC", chunk_select());
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([revision_id], map_chunk)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn map_session(row: &Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        seed_name: row.get("seed_name")?,
        kind: row.get("kind")?,
        intent: row.get("intent")?,
        depth: row.get("depth")?,
        fork_chunk_id: row.get("fork_chunk_id")?,
        fork_message_id: row.get("fork_message_id")?,
        fork_exact: row.get("fork_exact")?,
        parent_anchor: row.get("parent_anchor")?,
        concept_id: row.get("concept_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived: row.get::<_, Option<String>>("archived_at")?.is_some(),
        message_count: row.get("message_count")?,
        last_message: row.get("last_message")?,
        fork_count: row.get("fork_count")?,
    })
}

pub fn session_select() -> &'static str {
    "SELECT s.id, s.parent_id, s.seed_name, s.kind, s.intent, s.depth, s.fork_chunk_id,
            s.fork_message_id, s.fork_exact, s.parent_anchor, s.concept_id, s.created_at, s.updated_at, s.archived_at,
            (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
            (SELECT content FROM message m WHERE m.session_id = s.id ORDER BY ordinal DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM session f WHERE f.parent_id = s.id) AS fork_count
     FROM session s"
}

pub fn get_session_summary(conn: &Connection, session_id: &str) -> AppResult<SessionSummary> {
    let sql = format!("{} WHERE s.id = ?1", session_select());
    conn.query_row(&sql, [session_id], map_session)
        .optional()?
        .ok_or_else(|| AppError::user("session_not_found", "会话不存在。"))
}

pub fn list_sessions(conn: &Connection, limit: i64) -> AppResult<Vec<SessionSummary>> {
    let sql = format!(
        "{} WHERE s.archived_at IS NULL ORDER BY s.updated_at DESC LIMIT ?1",
        session_select()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit], map_session)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn map_message(row: &Row<'_>) -> rusqlite::Result<MessageView> {
    let cites: String = row.get("cites")?;
    let meta: String = row.get("meta")?;
    Ok(MessageView {
        id: row.get("id")?,
        session_id: row.get("session_id")?,
        ordinal: row.get("ordinal")?,
        role: row.get("role")?,
        content: row.get("content")?,
        status: row.get("status")?,
        error: row.get("error")?,
        cites: serde_json::from_str(&cites).unwrap_or_default(),
        meta: serde_json::from_str(&meta).unwrap_or(Value::Null),
        created_at: row.get("created_at")?,
    })
}

pub fn messages_for_session(conn: &Connection, session_id: &str) -> AppResult<Vec<MessageView>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, ordinal, role, content, status, error, cites, meta, created_at
         FROM message WHERE session_id = ?1 ORDER BY ordinal ASC",
    )?;
    let rows = stmt.query_map([session_id], map_message)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn map_concept(row: &Row<'_>) -> rusqlite::Result<ConceptView> {
    Ok(ConceptView {
        id: row.get("id")?,
        name: row.get("name")?,
        source_id: row.get("source_id")?,
        chunk_id: row.get("chunk_id")?,
        origin: row.get("origin")?,
        state: row.get("state")?,
        ease: row.get("ease")?,
        interval_days: row.get("interval_days")?,
        reps: row.get("reps")?,
        lapses: row.get("lapses")?,
        due_on: row.get("due_on")?,
        last_reviewed_at: row.get("last_reviewed_at")?,
        scheduler: row.get("scheduler")?,
        created_at: row.get("created_at")?,
        archived: row.get::<_, Option<String>>("archived_at")?.is_some(),
    })
}

pub fn concept_select() -> &'static str {
    "SELECT id, name, source_id, chunk_id, origin, state, ease, interval_days, reps, lapses,
            due_on, last_reviewed_at, scheduler, created_at, archived_at FROM concept"
}

pub fn get_concept(conn: &Connection, concept_id: &str) -> AppResult<ConceptView> {
    let sql = format!("{} WHERE id = ?1", concept_select());
    conn.query_row(&sql, [concept_id], map_concept)
        .optional()?
        .ok_or_else(|| AppError::user("concept_not_found", "概念不存在。"))
}

pub fn map_card(row: &Row<'_>) -> rusqlite::Result<CardSummary> {
    let answer: String = row.get("answer")?;
    Ok(CardSummary {
        id: row.get("id")?,
        concept_id: row.get("concept_id")?,
        concept_name: row.get("concept_name")?,
        kind: row.get("kind")?,
        status: row.get("status")?,
        mode: row.get("mode")?,
        question: row.get("question")?,
        answer_preview: crate::text::truncate_chars(&answer, 140),
        exercise_origin: row.get("exercise_origin")?,
        evidence_excerpt: row.get("evidence_excerpt")?,
        source_id: row.get("source_id")?,
        source_title: row.get("source_title")?,
        revision_id: row.get("revision_id")?,
        updated_at: row.get("updated_at")?,
        due_on: row.get("due_on")?,
        paused_reason: row.get("paused_reason")?,
        reps: row.get("reps")?,
        lapses: row.get("lapses")?,
    })
}

pub fn card_select() -> &'static str {
    "SELECT ca.id, ca.concept_id, co.name AS concept_name, ca.kind, ca.status, ca.mode,
            COALESCE(cr.question, '') AS question, COALESCE(cr.answer, '') AS answer,
            COALESCE(cr.exercise_origin, 'unspecified') AS exercise_origin,
            COALESCE(cr.evidence_excerpt, '') AS evidence_excerpt,
            COALESCE(ch.source_id, co.source_id) AS source_id,
            src.title AS source_title,
            ca.current_revision_id AS revision_id, ca.updated_at, co.due_on, ca.paused_reason,
            co.reps, co.lapses
     FROM card ca
     JOIN concept co ON co.id = ca.concept_id
     LEFT JOIN card_revision cr ON cr.id = ca.current_revision_id
     LEFT JOIN chunk ch ON ch.id = cr.evidence_chunk_id
     LEFT JOIN source src ON src.id = ch.source_id"
}

pub fn get_card_summary(conn: &Connection, card_id: &str) -> AppResult<CardSummary> {
    let sql = format!("{} WHERE ca.id = ?1", card_select());
    conn.query_row(&sql, [card_id], map_card)
        .optional()?
        .ok_or_else(|| AppError::user("card_not_found", "卡片不存在。"))
}

pub fn map_revision(row: &Row<'_>) -> rusqlite::Result<CardRevision> {
    Ok(CardRevision {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        revision_no: row.get("revision_no")?,
        question: row.get("question")?,
        answer: row.get("answer")?,
        evidence_chunk_id: row.get("evidence_chunk_id")?,
        evidence_excerpt: row.get("evidence_excerpt")?,
        exercise_origin: row.get("exercise_origin")?,
        origin_note: row.get("origin_note")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_revision(conn: &Connection, revision_id: &str) -> AppResult<CardRevision> {
    conn.query_row(
        "SELECT id, card_id, revision_no, question, answer, evidence_chunk_id, evidence_excerpt,
                exercise_origin, origin_note, created_at FROM card_revision WHERE id = ?1",
        [revision_id],
        map_revision,
    )
    .optional()?
    .ok_or_else(|| AppError::user("revision_not_found", "卡片修订不存在。"))
}

pub fn get_card_detail(conn: &Connection, card_id: &str) -> AppResult<CardDetail> {
    let summary = get_card_summary(conn, card_id)?;
    let concept = get_concept(conn, &summary.concept_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, card_id, revision_no, question, answer, evidence_chunk_id, evidence_excerpt,
                exercise_origin, origin_note, created_at
         FROM card_revision WHERE card_id = ?1 ORDER BY revision_no DESC",
    )?;
    let revisions = stmt
        .query_map([card_id], map_revision)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let evidence = revisions
        .first()
        .and_then(|r| r.evidence_chunk_id.as_deref())
        .and_then(|id| get_chunk(conn, id).ok());
    Ok(CardDetail {
        summary,
        concept,
        revisions,
        evidence,
    })
}

pub fn map_attempt(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<AttemptView> {
    let feedback_raw: Option<String> = row.get("feedback")?;
    let feedback: Option<Feedback> = feedback_raw
        .as_deref()
        .and_then(|v| serde_json::from_str(v).ok());
    let practice_raw: String = row.get("practice_answers")?;
    let practice: Vec<PracticeAnswer> = serde_json::from_str(&practice_raw).unwrap_or_default();
    let card_id: String = row.get("card_id")?;
    let revision_id: String = row.get("revision_id")?;
    let concept_id: String = row.get("concept_id")?;
    let hint_used: i64 = row.get("hint_used")?;
    Ok(AttemptView {
        id: row.get("id")?,
        concept_id: concept_id.clone(),
        card_id: card_id.clone(),
        revision_id: revision_id.clone(),
        first_answer: row.get("first_answer")?,
        hint_used: hint_used != 0,
        hint_text: row.get("hint_text")?,
        practice_answers: practice,
        feedback,
        verdict: row.get("verdict")?,
        suggested_grade: row.get("suggested_grade")?,
        feedback_mode: row.get("feedback_mode")?,
        ai_error: row.get("ai_error")?,
        status: row.get("status")?,
        is_demo: row.get::<_, i64>("is_demo")? != 0,
        started_at: row.get("started_at")?,
        answered_at: row.get("answered_at")?,
        latency_ms: row.get("latency_ms")?,
        card: get_card_summary(conn, &card_id).unwrap_or_else(|_| placeholder_card(&card_id)),
        revision: get_revision(conn, &revision_id).unwrap_or_else(|_| placeholder_revision(&revision_id, &card_id)),
        concept: get_concept(conn, &concept_id).unwrap_or_else(|_| placeholder_concept(&concept_id)),
    })
}

fn placeholder_card(id: &str) -> CardSummary {
    CardSummary {
        id: id.into(),
        concept_id: String::new(),
        concept_name: "已删除的概念".into(),
        kind: "recall".into(),
        status: "archived".into(),
        mode: "ai".into(),
        question: "（内容不可用）".into(),
        answer_preview: String::new(),
        exercise_origin: "unspecified".into(),
        evidence_excerpt: String::new(),
        source_id: None,
        source_title: None,
        revision_id: None,
        updated_at: String::new(),
        due_on: None,
        paused_reason: Some("内容不可用".into()),
        reps: 0,
        lapses: 0,
    }
}

fn placeholder_revision(id: &str, card_id: &str) -> CardRevision {
    CardRevision {
        id: id.into(),
        card_id: card_id.into(),
        revision_no: 0,
        question: "（内容不可用）".into(),
        answer: String::new(),
        evidence_chunk_id: None,
        evidence_excerpt: String::new(),
        exercise_origin: "unspecified".into(),
        origin_note: None,
        created_at: String::new(),
    }
}

fn placeholder_concept(id: &str) -> ConceptView {
    ConceptView {
        id: id.into(),
        name: "已删除的概念".into(),
        source_id: None,
        chunk_id: None,
        origin: "user_selected".into(),
        state: "new".into(),
        ease: 2.5,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_on: None,
        last_reviewed_at: None,
        scheduler: crate::scheduler::SCHEDULER_ID.into(),
        created_at: String::new(),
        archived: true,
    }
}

pub fn get_attempt(conn: &Connection, attempt_id: &str) -> AppResult<AttemptView> {
    conn.query_row(
        "SELECT id, assignment_id, concept_id, card_id, revision_id, first_answer, hint_used,
                hint_text, practice_answers, feedback, verdict, suggested_grade, feedback_mode,
                ai_error, status, is_demo, started_at, answered_at, latency_ms
         FROM attempt WHERE id = ?1",
        [attempt_id],
        |row| map_attempt(conn, row),
    )
    .optional()?
    .ok_or_else(|| AppError::user("attempt_not_found", "作答记录不存在。"))
}

pub fn queue_stats(conn: &Connection) -> AppResult<QueueStats> {
    let (today, _, today_str) = db::local_today(conn);
    let review_limit = db::get_setting_i64(conn, "study.daily_review", 50).clamp(1, 500);
    let new_limit = db::get_setting_i64(conn, "study.daily_new", 10).clamp(1, 200);
    let due_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept c
         WHERE c.archived_at IS NULL AND c.reps > 0 AND c.due_on IS NOT NULL AND c.due_on <= ?1
           AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)",
        [&today_str],
        |r| r.get(0),
    )?;
    let new_available: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept c
         WHERE c.archived_at IS NULL AND c.reps = 0
           AND EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM daily_assignment d WHERE d.concept_id = c.id AND d.local_date = ?1)",
        [&today_str],
        |r| r.get(0),
    )?;
    let review_served_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM daily_assignment WHERE local_date = ?1 AND kind = 'review'",
        [&today_str],
        |r| r.get(0),
    )?;
    let new_served_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM daily_assignment WHERE local_date = ?1 AND kind = 'new'",
        [&today_str],
        |r| r.get(0),
    )?;
    let completed_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM review WHERE local_date = ?1",
        [&today_str],
        |r| r.get(0),
    )?;
    let blocked_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept c
         WHERE c.archived_at IS NULL
           AND ((c.reps = 0) OR (c.reps > 0 AND c.due_on IS NOT NULL AND c.due_on <= ?1))
           AND NOT EXISTS (SELECT 1 FROM card ca WHERE ca.concept_id = c.id AND ca.status = 'active' AND ca.archived_at IS NULL)",
        [&today_str],
        |r| r.get(0),
    )?;
    let review_remaining = (review_limit - review_served_today).max(0);
    let new_remaining = (new_limit - new_served_today).max(0);
    let backlog = (due_count - review_served_today - review_remaining).max(0);
    let _ = today;
    Ok(QueueStats {
        due_count,
        new_available,
        review_served_today,
        new_served_today,
        review_limit,
        new_limit,
        review_remaining,
        new_remaining,
        completed_today,
        backlog,
        blocked_count,
    })
}

pub fn overview(conn: &Connection) -> AppResult<Overview> {
    let (today, _, today_str) = db::local_today(conn);
    let stats = queue_stats(conn)?;
    let drafts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM card WHERE status = 'draft' AND archived_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    let active_cards: i64 = conn.query_row(
        "SELECT COUNT(*) FROM card WHERE status = 'active' AND archived_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    let total_concepts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept WHERE archived_at IS NULL",
        [],
        |r| r.get(0),
    )?;

    let mut stmt = conn.prepare("SELECT DISTINCT local_date FROM review ORDER BY local_date DESC")?;
    let dates = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let date_set: std::collections::HashSet<String> = dates.into_iter().collect();
    let mut cursor = if date_set.contains(&today_str) {
        today
    } else {
        today - Duration::days(1)
    };
    let mut streak = 0i64;
    while date_set.contains(&cursor.format("%Y-%m-%d").to_string()) {
        streak += 1;
        cursor -= Duration::days(1);
    }

    let mut last7 = Vec::new();
    for offset in (0..7).rev() {
        let date = today - Duration::days(offset);
        let key = date.format("%Y-%m-%d").to_string();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM review WHERE local_date = ?1",
            [&key],
            |r| r.get(0),
        )?;
        last7.push(DayCount {
            date: key,
            label: weekday_label(date.weekday()),
            reviews: count,
        });
    }

    Ok(Overview {
        local_date: today_str,
        timezone: db::timezone(conn).name().to_string(),
        due_count: stats.due_count,
        new_available: stats.new_available,
        completed_today: stats.completed_today,
        review_served_today: stats.review_served_today,
        new_served_today: stats.new_served_today,
        review_limit: stats.review_limit,
        new_limit: stats.new_limit,
        backlog: stats.backlog,
        blocked_count: stats.blocked_count,
        drafts,
        active_cards,
        total_concepts,
        streak_days: streak,
        last7,
    })
}

fn weekday_label(day: Weekday) -> String {
    match day {
        Weekday::Mon => "一".into(),
        Weekday::Tue => "二".into(),
        Weekday::Wed => "三".into(),
        Weekday::Thu => "四".into(),
        Weekday::Fri => "五".into(),
        Weekday::Sat => "六".into(),
        Weekday::Sun => "日".into(),
    }
}

pub fn model_status(conn: &Connection) -> ModelStatus {
    let configured = LlmConfig::load(conn).is_some();
    let provider = db::get_setting(conn, "model.provider").unwrap_or_else(|| "deepseek".into());
    let model = db::get_setting(conn, "model.model").unwrap_or_default();
    let base_url = db::get_setting(conn, "model.base_url").unwrap_or_default();
    let has_api_key = !db::get_setting(conn, "model.api_key").unwrap_or_default().trim().is_empty();
    let last_test_ok = db::get_setting(conn, "model.last_test_ok").map(|v| v == "1");
    ModelStatus {
        configured,
        provider,
        model,
        base_url,
        has_api_key,
        last_test_at: db::get_setting(conn, "model.last_test_at"),
        last_test_ok,
        last_test_message: db::get_setting(conn, "model.last_test_message"),
    }
}

pub fn study_settings(conn: &Connection) -> StudySettings {
    StudySettings {
        daily_new: db::get_setting_i64(conn, "study.daily_new", 10),
        daily_review: db::get_setting_i64(conn, "study.daily_review", 50),
        timezone: db::get_setting(conn, "study.timezone")
            .unwrap_or_else(|| "Asia/Shanghai".into()),
        theme: db::get_setting(conn, "ui.theme").unwrap_or_else(|| "ink".into()),
        capsule_metric: db::get_setting(conn, "ui.capsule_metric").unwrap_or_else(|| "due".into()),
        cloud_notice_seen: db::get_setting(conn, "privacy.cloud_notice_seen").as_deref() == Some("1"),
    }
}

pub fn bootstrap(conn: &Connection, data_dir: &Path) -> AppResult<Bootstrap> {
    let sources = list_sources(conn, false)?;
    let sessions = list_sessions(conn, 30)?;
    let sample_loaded = sources.iter().any(|s| s.origin == "sample");
    let onboarded = db::get_setting(conn, "app.onboarded").as_deref() == Some("1");
    Ok(Bootstrap {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
        is_first_run: !onboarded,
        guided_ready: false,
        model: model_status(conn),
        settings: study_settings(conn),
        overview: overview(conn)?,
        sources,
        sessions,
        sample_loaded,
    })
}

pub fn touch_source(conn: &Connection, source_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE source SET last_read_at = ?1 WHERE id = ?2",
        rusqlite::params![db::now_utc(), source_id],
    )?;
    Ok(())
}

pub fn rollback(conn: &Connection) {
    let _ = conn.execute_batch("ROLLBACK");
}
