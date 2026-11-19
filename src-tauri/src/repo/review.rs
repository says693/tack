use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::llm::AllowedEvidence;
use crate::models::*;
use crate::scheduler::{self, ScheduleState};
use crate::text;

use super::{get_attempt, get_card_summary, get_concept, get_revision, overview};

pub struct GradeContext {
    pub attempt: AttemptView,
    pub evidence: Vec<AllowedEvidence>,
    pub session_intent: String,
}

pub fn prepare_answer(
    conn: &Connection,
    attempt_id: &str,
    answer: &str,
    latency_ms: Option<i64>,
) -> AppResult<AttemptView> {
    let attempt = get_attempt(conn, attempt_id)?;
    if attempt.status == "confirmed" {
        return Err(AppError::user("already_confirmed", "这次复习已经确认，不能改写首次答案。"));
    }
    if !attempt.first_answer.trim().is_empty() {
        return Err(AppError::user(
            "already_answered",
            "首次答案已经保存。提示后的练习会附在这条记录里，不会覆盖首次答案。",
        ));
    }
    if answer.trim().is_empty() {
        return Err(AppError::user("empty_answer", "先写下你的答案，再提交。"));
    }
    if attempt.card.status != "active" {
        return Err(AppError::user(
            "card_not_active",
            "这张卡当前不在启用状态，不能提交新的复习。",
        ));
    }
    let status = if attempt.card.mode == "self" {
        "awaiting_self"
    } else {
        "grading"
    };
    let mode = if attempt.card.mode == "self" { Some("self") } else { None };
    conn.execute(
        "UPDATE attempt SET first_answer = ?1, answered_at = ?2, latency_ms = ?3, status = ?4,
            feedback_mode = ?5, ai_error = NULL WHERE id = ?6",
        rusqlite::params![answer.trim(), db::now_utc(), latency_ms, status, mode, attempt_id],
    )?;
    get_attempt(conn, attempt_id)
}

pub fn grade_context(conn: &Connection, attempt_id: &str) -> AppResult<GradeContext> {
    let attempt = get_attempt(conn, attempt_id)?;
    let mut evidence = Vec::new();
    if let Some(chunk_id) = attempt.revision.evidence_chunk_id.as_deref() {
        if let Ok(chunk) = super::get_chunk(conn, chunk_id) {
            let source_title = super::get_source(conn, &chunk.source_id)
                .ok()
                .map(|s| s.title);
            let label = conn
                .query_row(
                    "SELECT label FROM source_revision WHERE id = ?1",
                    [&chunk.revision_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            evidence.push(AllowedEvidence {
                chunk_id: chunk.id,
                text: chunk.quote_exact,
                source_title,
                label,
            });
        }
    }
    let session_intent = conn
        .query_row(
            "SELECT s.intent FROM card ca LEFT JOIN session s ON s.id = ca.session_id WHERE ca.id = ?1",
            [&attempt.card_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten()
        .unwrap_or_else(|| "review".into());
    Ok(GradeContext {
        attempt,
        evidence,
        session_intent,
    })
}

pub fn save_ai_feedback(conn: &Connection, attempt_id: &str, feedback: &Feedback) -> AppResult<AttemptView> {
    let suggested = crate::llm::suggested_grade(&feedback.verdict);
    let status = if feedback.verdict == "insufficient_evidence" {
        "insufficient"
    } else {
        "feedback"
    };
    conn.execute(
        "UPDATE attempt SET feedback = ?1, verdict = ?2, suggested_grade = ?3, feedback_mode = 'ai',
            status = ?4, feedback_at = ?5, ai_error = NULL WHERE id = ?6",
        rusqlite::params![
            serde_json::to_string(feedback)?,
            feedback.verdict,
            suggested,
            status,
            db::now_utc(),
            attempt_id
        ],
    )?;
    get_attempt(conn, attempt_id)
}

pub fn save_ai_failure(conn: &Connection, attempt_id: &str, error: &str) -> AppResult<AttemptView> {
    conn.execute(
        "UPDATE attempt SET status = 'ai_failed', ai_error = ?1, feedback_mode = NULL WHERE id = ?2",
        rusqlite::params![error, attempt_id],
    )?;
    get_attempt(conn, attempt_id)
}

pub fn switch_to_self(conn: &Connection, attempt_id: &str) -> AppResult<AttemptView> {
    let attempt = get_attempt(conn, attempt_id)?;
    if attempt.status != "ai_failed" && attempt.status != "awaiting_self" {
        return Err(AppError::user(
            "not_switchable",
            "只有在 AI 失败或本来就是自评模式时，才能改用自评。",
        ));
    }
    conn.execute(
        "UPDATE attempt SET feedback_mode = 'self', status = 'awaiting_self' WHERE id = ?1",
        [attempt_id],
    )?;
    db::log_event(
        conn,
        "switched_to_self",
        &json!({"attemptId": attempt_id, "aiError": attempt.ai_error}).to_string(),
    )?;
    get_attempt(conn, attempt_id)
}

pub fn request_hint(conn: &Connection, attempt_id: &str) -> AppResult<Option<String>> {
    let attempt = get_attempt(conn, attempt_id)?;
    if attempt.first_answer.trim().is_empty() {
        return Err(AppError::user(
            "answer_first",
            "先写下首次独立回答，再看提示。",
        ));
    }
    let hint = attempt
        .feedback
        .as_ref()
        .and_then(|f| f.hint.clone())
        .filter(|h| !h.trim().is_empty());
    if hint.is_some() {
        conn.execute(
            "UPDATE attempt SET hint_used = 1, hint_text = ?1 WHERE id = ?2",
            rusqlite::params![hint, attempt_id],
        )?;
    }
    Ok(hint)
}

pub fn practice_answer(conn: &Connection, attempt_id: &str, answer: &str) -> AppResult<AttemptView> {
    let attempt = get_attempt(conn, attempt_id)?;
    if attempt.status == "confirmed" {
        return Err(AppError::user("already_confirmed", "这次复习已经确认。"));
    }
    if attempt.first_answer.trim().is_empty() {
        return Err(AppError::user("answer_first", "先提交首次独立回答。"));
    }
    if answer.trim().is_empty() {
        return Err(AppError::user("empty_answer", "练习答案不能为空。"));
    }
    let mut practice = attempt.practice_answers.clone();
    practice.push(PracticeAnswer {
        answer: answer.trim().to_string(),
        hint_used: attempt.hint_used,
        at: db::now_utc(),
    });
    conn.execute(
        "UPDATE attempt SET practice_answers = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(&practice)?, attempt_id],
    )?;
    get_attempt(conn, attempt_id)
}

pub fn raise_objection(conn: &Connection, attempt_id: &str, reason: &str) -> AppResult<BooleanResult> {
    if reason.trim().is_empty() {
        return Err(AppError::user("reason_required", "请写下异议理由。"));
    }
    let already: Option<String> = conn
        .query_row(
            "SELECT id FROM review WHERE attempt_id = ?1",
            [attempt_id],
            |r| r.get(0),
        )
        .optional()?;
    let id = db::new_id("obj");
    conn.execute(
        "INSERT INTO objection(id, attempt_id, reason, status, created_at) VALUES (?1, ?2, ?3, 'open', ?4)",
        rusqlite::params![id, attempt_id, reason.trim(), db::now_utc()],
    )?;
    if already.is_none() {
        conn.execute(
            "UPDATE attempt SET status = 'objected' WHERE id = ?1",
            [attempt_id],
        )?;
    }
    db::log_event(
        conn,
        "objection_raised",
        &json!({"attemptId": attempt_id, "afterReview": already.is_some()}).to_string(),
    )?;
    Ok(BooleanResult {
        ok: true,
        changed: already.is_none(),
    })
}

pub fn confirm_review(conn: &Connection, input: ConfirmReviewInput) -> AppResult<ReviewResult> {
    if !(0..=3).contains(&input.grade) {
        return Err(AppError::user("bad_grade", "评级必须是 0–3。"));
    }
    if input.idempotency_key.trim().is_empty() {
        return Err(AppError::user("idempotency_required", "缺少提交幂等键。"));
    }
    let payload_hash = text::sha256_hex(&format!("{}:{}", input.attempt_id, input.grade));
    if let Some(existing) = conn
        .query_row(
            "SELECT payload_hash, response FROM idempotency WHERE key = ?1 AND command = 'confirm_review'",
            [&input.idempotency_key],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?
    {
        if existing.0 != payload_hash {
            return Err(AppError::user(
                "idempotency_conflict",
                "同一个提交键对应了不同的答案或评级，已拒绝复用旧结果。",
            ));
        }
        let mut value: ReviewResult = serde_json::from_str(&existing.1)?;
        value.already_existed = true;
        return Ok(value);
    }
    if let Some(existing) = conn
        .query_row(
            "SELECT id FROM review WHERE attempt_id = ?1",
            [&input.attempt_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        let result = review_result_from_existing(conn, &existing)?;
        return Ok(result);
    }

    let attempt = get_attempt(conn, &input.attempt_id)?;
    if attempt.first_answer.trim().is_empty() {
        return Err(AppError::user("answer_required", "还没有首次答案，不能提交复习。"));
    }
    if attempt.status == "abandoned" {
        return Err(AppError::user("attempt_abandoned", "这次尝试已放弃。"));
    }
    if attempt.status == "insufficient" {
        return Err(AppError::user(
            "insufficient_evidence",
            "这次反馈证据不足，不能提交调度。可以补充证据或使用自评。",
        ));
    }
    if attempt.status == "ai_failed" && attempt.feedback_mode.as_deref() != Some("self") {
        return Err(AppError::user(
            "ai_failed",
            "AI 反馈失败，尚未产生有效评分。请重试，或明确改用自评。",
        ));
    }
    let mode = attempt.feedback_mode.clone().unwrap_or_else(|| {
        if attempt.card.mode == "self" { "self".into() } else { "ai".into() }
    });
    if mode == "ai" && attempt.feedback.is_none() {
        return Err(AppError::user(
            "feedback_required",
            "还没有可核对的反馈，不能提交复习。",
        ));
    }
    let (today, _, today_str) = db::local_today(conn);
    let concept = get_concept(conn, &attempt.concept_id)?;
    if concept.archived {
        return Err(AppError::user("concept_archived", "这个概念已归档。"));
    }
    let before = ScheduleState {
        ease: concept.ease,
        interval_days: concept.interval_days,
        reps: concept.reps,
        lapses: concept.lapses,
        state: concept.state.clone(),
        due_on: concept.due_on.clone(),
    };
    let outcome = scheduler::apply_grade(&before, input.grade, today)
        .map_err(|m| AppError::user("bad_grade", m))?;

    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> AppResult<ReviewResult> {
        // Re-check inside the write transaction. Two concurrent confirmations
        // for the same attempt could both pass the read above; the loser must
        // return the existing review instead of hitting review.attempt_id UNIQUE.
        if let Some(existing) = conn
            .query_row(
                "SELECT id FROM review WHERE attempt_id = ?1",
                [&input.attempt_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            return review_result_from_existing(conn, &existing);
        }
        let other_review: Option<String> = conn
            .query_row(
                "SELECT id FROM review WHERE concept_id = ?1 AND local_date = ?2 AND attempt_id <> ?3 LIMIT 1",
                rusqlite::params![attempt.concept_id, today_str, input.attempt_id],
                |r| r.get(0),
            )
            .optional()?;
        if other_review.is_some() {
            return Err(AppError::user(
                "concept_already_reviewed_today",
                "这个概念今天已经完成过一次复习。本次尝试保留为历史，不再重复排期。",
            ));
        }
        let review_id = db::new_id("rev2");
        let now = db::now_utc();
        conn.execute(
            "UPDATE concept SET state = ?1, ease = ?2, interval_days = ?3, reps = ?4, lapses = ?5,
                due_on = ?6, last_reviewed_at = ?7, scheduler = ?8 WHERE id = ?9",
            rusqlite::params![
                outcome.state,
                outcome.ease,
                outcome.interval_days,
                outcome.reps,
                outcome.lapses,
                outcome.due_on,
                now,
                scheduler::SCHEDULER_ID,
                attempt.concept_id
            ],
        )?;
        conn.execute(
            "INSERT INTO review(id, attempt_id, concept_id, grade, mode, scheduler, state_before,
                state_after, interval_days, due_on, latency_ms, idempotency_key, local_date, reviewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                review_id,
                input.attempt_id,
                attempt.concept_id,
                input.grade,
                mode,
                scheduler::SCHEDULER_ID,
                serde_json::to_string(&before)?,
                serde_json::to_string(&outcome)?,
                outcome.interval_days,
                outcome.due_on,
                attempt.latency_ms,
                input.idempotency_key,
                today_str,
                now
            ],
        )?;
        conn.execute(
            "UPDATE attempt SET status = 'confirmed', confirmed_at = ?1 WHERE id = ?2",
            rusqlite::params![now, input.attempt_id],
        )?;
        conn.execute(
            "UPDATE daily_assignment SET completed_at = ?1 WHERE attempt_id = ?2",
            rusqlite::params![now, input.attempt_id],
        )?;
        conn.execute(
            "UPDATE objection SET status = 'resolved', resolved_at = ?1 WHERE attempt_id = ?2 AND status = 'open'",
            rusqlite::params![now, input.attempt_id],
        )?;
        let overview_value = overview(conn)?;
        let result = ReviewResult {
            review_id,
            attempt_id: input.attempt_id.clone(),
            concept_id: attempt.concept_id.clone(),
            grade: input.grade,
            mode: mode.clone(),
            interval_days: outcome.interval_days,
            due_on: outcome.due_on.clone(),
            state: outcome.state.clone(),
            next_due_label: next_due_label(&outcome.due_on, today),
            already_existed: false,
            overview: overview_value,
        };
        let serialized = serde_json::to_string(&result)?;
        conn.execute(
            "INSERT INTO idempotency(key, command, payload_hash, response, created_at)
             VALUES (?1, 'confirm_review', ?2, ?3, ?4)",
            rusqlite::params![input.idempotency_key, payload_hash, serialized, now],
        )?;
        db::log_event(
            conn,
            "review_confirmed",
            &json!({"reviewId": &result.review_id, "attemptId": input.attempt_id, "grade": input.grade}).to_string(),
        )?;
        Ok(result)
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

fn review_result_from_existing(conn: &Connection, review_id: &str) -> AppResult<ReviewResult> {
    let row = conn.query_row(
        "SELECT attempt_id, concept_id, grade, mode, interval_days, due_on, state_after
         FROM review WHERE id = ?1",
        [review_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    )?;
    let state_after: serde_json::Value = serde_json::from_str(&row.6)?;
    let state = state_after
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("review")
        .to_string();
    let (today, _, _) = db::local_today(conn);
    Ok(ReviewResult {
        review_id: review_id.into(),
        attempt_id: row.0,
        concept_id: row.1,
        grade: row.2,
        mode: row.3,
        interval_days: row.4,
        due_on: row.5.clone(),
        state,
        next_due_label: next_due_label(&row.5, today),
        already_existed: true,
        overview: overview(conn)?,
    })
}

pub fn next_due_label(due_on: &str, today: NaiveDate) -> String {
    let Ok(due) = NaiveDate::parse_from_str(due_on, "%Y-%m-%d") else {
        return due_on.to_string();
    };
    let days = (due - today).num_days();
    match days {
        0 => "今天".into(),
        1 => "明天".into(),
        2 => "后天".into(),
        n if n > 0 => format!("{n} 天后（{}）", due.format("%m-%d")),
        _ => due.format("%Y-%m-%d").to_string(),
    }
}

pub fn review_history(conn: &Connection, days: i64) -> AppResult<Vec<DayCount>> {
    let (today, _, _) = db::local_today(conn);
    let mut out = Vec::new();
    for offset in (0..days.max(1)).rev() {
        let date = today - chrono::Duration::days(offset);
        let key = date.format("%Y-%m-%d").to_string();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM review WHERE local_date = ?1",
            [&key],
            |r| r.get(0),
        )?;
        out.push(DayCount {
            date: key,
            label: date.format("%m-%d").to_string(),
            reviews: count,
        });
    }
    Ok(out)
}

pub fn concept_schedule(conn: &Connection, concept_id: &str) -> AppResult<ConceptView> {
    get_concept(conn, concept_id)
}

pub fn attempt_card(conn: &Connection, attempt_id: &str) -> AppResult<(CardSummary, CardRevision)> {
    let attempt = get_attempt(conn, attempt_id)?;
    let card = get_card_summary(conn, &attempt.card_id)?;
    let revision = get_revision(conn, &attempt.revision_id)?;
    Ok((card, revision))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CardDraftInput, SessionCreateInput};
    use crate::repo::{cards, get_attempt, queue, sessions, sources};

    fn test_db() -> Connection {
        let path = std::env::temp_dir().join(format!(
            "fold-review-{}-{}.db",
            std::process::id(),
            db::new_id("t")
        ));
        let conn = db::open_db(&path).expect("open test database");
        db::set_setting(&conn, "study.timezone", "Asia/Shanghai").expect("timezone");
        conn
    }

    fn accepted_card(conn: &Connection, mode: &str) -> String {
        sources::seed_demo(conn).expect("seed demo");
        let (chunk_id, quote): (String, String) = conn
            .query_row(
                "SELECT ch.id, ch.quote_exact
                 FROM chunk ch JOIN source_revision sr ON sr.id = ch.revision_id
                 WHERE sr.revision_no = 1 AND ch.quote_exact LIKE '%蓝色盒存放待登记条目%'
                 ORDER BY ch.ordinal ASC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("demo chunk");
        let session = sessions::create_session(
            conn,
            SessionCreateInput {
                chunk_id: Some(chunk_id.clone()),
                parent_id: None,
                fork_message_id: None,
                name: Some("复习状态测试".into()),
                intent: Some("review".into()),
                kind: Some("root".into()),
            },
        )
        .expect("session");
        let draft = cards::create_draft(
            conn,
            CardDraftInput {
                concept_name: format!("复习状态测试 · {mode}"),
                question: "在材料 A 的版本 1 中，条目何时从蓝色盒移到绿色盒？".into(),
                answer: "登记完成后。".into(),
                evidence_chunk_id: Some(chunk_id),
                evidence_excerpt: quote,
                exercise_origin: "generated".into(),
                origin_note: None,
                mode: mode.into(),
                session_id: Some(session.session.id),
            },
        )
        .expect("draft");
        cards::accept_card(conn, &draft.summary.id).expect("accept").summary.id
    }

    fn open_attempt(conn: &Connection) -> AttemptView {
        queue::next_task(conn)
            .expect("task")
            .task
            .expect("new task")
            .attempt
    }

    #[test]
    fn ai_failure_keeps_the_answer_and_requires_explicit_self_switch() {
        let conn = test_db();
        accepted_card(&conn, "ai");
        let attempt = open_attempt(&conn);
        let answered = prepare_answer(&conn, &attempt.id, "登记完成后。", Some(9_000)).expect("answer");
        assert_eq!(answered.status, "grading");

        let failed = save_ai_failure(&conn, &attempt.id, "模型调用失败（测试）").expect("failure");
        assert_eq!(failed.status, "ai_failed");
        assert_eq!(failed.first_answer, "登记完成后。");
        assert!(!failed.ai_error.unwrap_or_default().is_empty());

        let err = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id.clone(),
                grade: 2,
                idempotency_key: "failure-key".into(),
            },
        )
        .expect_err("failure cannot be scheduled");
        assert_eq!(err.code(), "ai_failed");

        let switched = switch_to_self(&conn, &attempt.id).expect("explicit self mode");
        assert_eq!(switched.status, "awaiting_self");
        assert_eq!(switched.feedback_mode.as_deref(), Some("self"));
        assert_eq!(switched.first_answer, "登记完成后。");

        let result = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id.clone(),
                grade: 2,
                idempotency_key: "failure-key".into(),
            },
        )
        .expect("confirm self review");
        assert_eq!(result.mode, "self");
        assert!(!result.already_existed);
    }

    #[test]
    fn insufficient_evidence_does_not_move_due_or_create_review() {
        let conn = test_db();
        accepted_card(&conn, "ai");
        let attempt = open_attempt(&conn);
        prepare_answer(&conn, &attempt.id, "处理之后。", None).expect("answer");
        save_ai_feedback(
            &conn,
            &attempt.id,
            &Feedback {
                verdict: "insufficient_evidence".into(),
                hits: vec![],
                observed_errors: vec![],
                missing_points: vec![],
                hint: None,
                evidence: vec![],
                note: Some("当前证据不足以判断。".into()),
                model: Some("test-model".into()),
            },
        )
        .expect("feedback");
        let err = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id.clone(),
                grade: 2,
                idempotency_key: "insufficient-key".into(),
            },
        )
        .expect_err("insufficient evidence cannot schedule");
        assert_eq!(err.code(), "insufficient_evidence");
        let (due, reps): (Option<String>, i64) = conn
            .query_row(
                "SELECT due_on, reps FROM concept WHERE id = ?1",
                [&attempt.concept_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("concept");
        assert!(due.is_none());
        assert_eq!(reps, 0);
        let reviews: i64 = conn
            .query_row("SELECT COUNT(*) FROM review", [], |row| row.get(0))
            .expect("review count");
        assert_eq!(reviews, 0);
    }

    #[test]
    fn second_attempt_for_the_same_concept_does_not_double_schedule() {
        let conn = test_db();
        accepted_card(&conn, "self");
        let first = open_attempt(&conn);
        prepare_answer(&conn, &first.id, "登记完成后。", None).expect("first answer");
        let (card_id, revision_id): (String, String) = conn
            .query_row(
                "SELECT card_id, revision_id FROM attempt WHERE id = ?1",
                [&first.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("attempt card");
        let (_, _, today) = db::local_today(&conn);
        let second_id = db::new_id("att");
        conn.execute(
            "INSERT INTO attempt(id, concept_id, card_id, revision_id, first_answer, status, local_date, started_at)
             VALUES (?1, ?2, ?3, ?4, '登记完成后。', 'awaiting_self', ?5, ?6)",
            rusqlite::params![
                second_id,
                first.concept_id,
                card_id,
                revision_id,
                today,
                db::now_utc()
            ],
        )
        .expect("second attempt");

        let first_review = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: first.id.clone(),
                grade: 2,
                idempotency_key: "same-concept-first".into(),
            },
        )
        .expect("first review");
        assert!(!first_review.already_existed);

        let second = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: second_id,
                grade: 2,
                idempotency_key: "same-concept-second".into(),
            },
        )
        .expect_err("second attempt for today must not schedule again");
        assert_eq!(second.code(), "concept_already_reviewed_today");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM review", [], |row| row.get(0))
            .expect("review count");
        assert_eq!(count, 1);
    }

    #[test]
    fn concurrent_confirmations_for_one_attempt_return_one_review() {
        use std::sync::{Arc, Barrier};

        let path = std::env::temp_dir().join(format!(
            "fold-review-race-{}-{}.db",
            std::process::id(),
            db::new_id("t")
        ));
        let conn = db::open_db(&path).expect("open test database");
        db::set_setting(&conn, "study.timezone", "Asia/Shanghai").expect("timezone");
        accepted_card(&conn, "self");
        let attempt = open_attempt(&conn);
        prepare_answer(&conn, &attempt.id, "登记完成后。", None).expect("answer");

        let conn2 = db::open_db(&path).expect("second connection");
        let barrier = Arc::new(Barrier::new(2));
        let barrier2 = barrier.clone();
        let attempt2 = attempt.id.clone();
        let handle = std::thread::spawn(move || {
            barrier2.wait();
            confirm_review(
                &conn2,
                ConfirmReviewInput {
                    attempt_id: attempt2,
                    grade: 2,
                    idempotency_key: "race-a".into(),
                },
            )
        });
        barrier.wait();
        let first = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id,
                grade: 2,
                idempotency_key: "race-b".into(),
            },
        )
        .expect("main confirmation");
        let second = handle
            .join()
            .expect("thread join")
            .expect("racing confirmation");
        assert_eq!(first.review_id, second.review_id);
        assert_eq!(first.due_on, second.due_on);
        assert_ne!(first.already_existed, second.already_existed);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM review", [], |row| row.get(0))
            .expect("review count");
        assert_eq!(count, 1);
        let due: String = conn
            .query_row("SELECT due_on FROM concept WHERE id = ?1", [&attempt.concept_id], |row| {
                row.get(0)
            })
            .expect("concept due");
        assert_eq!(due, first.due_on);
    }

    #[test]
    fn self_answer_confirms_without_inventing_ai_feedback() {
        let conn = test_db();
        accepted_card(&conn, "self");
        let attempt = open_attempt(&conn);
        let answered = prepare_answer(&conn, &attempt.id, "登记完成后。", None).expect("answer");
        assert_eq!(answered.status, "awaiting_self");
        assert!(answered.feedback.is_none());
        assert_eq!(answered.feedback_mode.as_deref(), Some("self"));

        let first = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id.clone(),
                grade: 2,
                idempotency_key: "self-key".into(),
            },
        )
        .expect("confirm");
        assert!(!first.already_existed);
        assert_eq!(first.mode, "self");
        assert!(first.interval_days >= 1);

        let duplicate = confirm_review(
            &conn,
            ConfirmReviewInput {
                attempt_id: attempt.id,
                grade: 2,
                idempotency_key: "self-key".into(),
            },
        )
        .expect("idempotent duplicate");
        assert!(duplicate.already_existed);
        assert_eq!(duplicate.review_id, first.review_id);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM review", [], |row| row.get(0))
            .expect("review count");
        assert_eq!(count, 1);
        let still = get_attempt(&conn, &first.attempt_id).expect("attempt");
        assert_eq!(still.status, "confirmed");
    }
}
