//! Opt-in integration check against a real OpenAI-compatible endpoint.
//!
//! Run with:
//!   FOLD_REAL_BASE_URL=... FOLD_REAL_MODEL=... FOLD_REAL_API_KEY=... \
//!     cargo test real_model_end_to_end -- --ignored --nocapture
//!
//! The test is ignored by default and never stores the key. It exercises the
//! same prompt builders, strict parsers, draft acceptance, grading and
//! idempotent review confirmation that the desktop commands use.

use std::time::Duration;

use chrono::Utc;

use crate::db;
use crate::llm::{self, AllowedEvidence, LlmConfig};
use crate::models::{
    CardDraftInput, ConfirmReviewInput, SessionCreateInput,
};
use crate::repo::{self, cards, queue, review, sessions, sources};

fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tokio::test]
#[ignore = "requires FOLD_REAL_BASE_URL / FOLD_REAL_MODEL / FOLD_REAL_API_KEY"]
async fn real_model_end_to_end() {
    let Some(base_url) = env("FOLD_REAL_BASE_URL") else {
        panic!("missing FOLD_REAL_BASE_URL");
    };
    let Some(model) = env("FOLD_REAL_MODEL") else {
        panic!("missing FOLD_REAL_MODEL");
    };
    let Some(api_key) = env("FOLD_REAL_API_KEY") else {
        panic!("missing FOLD_REAL_API_KEY");
    };

    let data_dir = std::env::temp_dir().join(format!(
        "fold-real-{}-{}",
        std::process::id(),
        Utc::now().format("%Y%m%d%H%M%S")
    ));
    std::fs::create_dir_all(&data_dir).expect("create temp data dir");
    let db_path = data_dir.join("fold.db");
    let conn = db::open_db(&db_path).expect("open temporary database");

    db::set_setting(&conn, "model.provider", "custom").expect("set provider");
    db::set_setting(&conn, "model.base_url", &base_url).expect("set base url");
    db::set_setting(&conn, "model.model", &model).expect("set model");
    db::set_setting(&conn, "model.api_key", &api_key).expect("set key");
    db::set_setting(&conn, "study.timezone", "Asia/Shanghai").expect("set timezone");

    let config = LlmConfig::load(&conn).expect("model config loads");

    let started = std::time::Instant::now();
    let (_, probe) = llm::test_connection(&config)
        .await
        .expect("real model connection test");
    println!(
        "[connect] {} ms · {} · {:?}",
        started.elapsed().as_millis(),
        model,
        probe
    );

    sources::seed_demo(&conn).expect("seed demo sources");
    let (chunk_id, quote): (String, String) = conn
        .query_row(
            "SELECT ch.id, ch.quote_exact
             FROM chunk ch JOIN source_revision sr ON sr.id = ch.revision_id
             WHERE sr.revision_no = 1 AND ch.quote_exact LIKE '%蓝色盒存放待登记条目%'
             ORDER BY ch.ordinal ASC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("revision-1 demo chunk");
    println!("[chunk] {chunk_id} · {}", crate::text::truncate_chars(&quote, 60));

    let session = sessions::create_session(
        &conn,
        SessionCreateInput {
            chunk_id: Some(chunk_id.clone()),
            parent_id: None,
            fork_message_id: None,
            name: Some("真实模型验收 · 条目移动规则".into()),
            intent: Some("review".into()),
            kind: Some("root".into()),
        },
    )
    .expect("create session");

    let context = sessions::build_chat_context(&conn, &session.session).expect("chat context");
    let messages = llm::build_chat_messages(
        &context.system,
        &context.messages,
        "请只用一句话提醒我：一个条目要从蓝色盒移到绿色盒，前提是什么？不要展开。",
    );
    let mut streamed = String::new();
    let mut delta_count = 0usize;
    let reply = llm::stream(&config, &messages, 400, |delta| {
        delta_count += 1;
        streamed.push_str(delta);
    })
    .await
    .expect("real streaming reply");
    assert_eq!(reply, streamed, "streamed deltas must reconstruct the reply");
    assert!(!reply.trim().is_empty());
    println!("[chat] {} deltas · {:?}", delta_count, reply);

    sessions::insert_message(&conn, &session.session.id, "user", "请只用一句话提醒我：一个条目要从蓝色盒移到绿色盒，前提是什么？不要展开。", "complete", None, &[]).expect("insert user message");
    sessions::insert_message(&conn, &session.session.id, "assistant", &reply, "complete", None, &[]).expect("insert assistant message");

    let allowed = AllowedEvidence {
        chunk_id: chunk_id.clone(),
        text: quote.clone(),
        source_title: Some("青石镇档案室".into()),
        label: Some("版本 1".into()),
    };
    let card_messages = llm::build_card_messages(
        &allowed,
        &reply,
        "review",
        Some("条目何时从蓝色盒移到绿色盒"),
    );
    let card_raw = llm::complete(&config, &card_messages, true, 900)
        .await
        .expect("real card generation");
    println!("[card-raw] {}", crate::text::truncate_chars(&card_raw, 800));
    let generated = llm::parse_generated_card(&card_raw, &allowed).expect("strict card parser");
    println!(
        "[card] Q {:?}\n       A {:?}\n       E {:?}",
        generated.question, generated.answer, generated.evidence_quote
    );

    let draft = cards::create_draft(
        &conn,
        CardDraftInput {
            concept_name: "条目从蓝色盒移入绿色盒的时机".into(),
            question: generated.question.clone(),
            answer: generated.answer.clone(),
            evidence_chunk_id: Some(chunk_id.clone()),
            evidence_excerpt: generated.evidence_quote.clone(),
            exercise_origin: "generated".into(),
            origin_note: Some(format!("real-model acceptance · {model}")),
            mode: "ai".into(),
            session_id: Some(session.session.id.clone()),
        },
    )
    .expect("create draft");
    assert_eq!(draft.summary.status, "draft");
    let accepted = cards::accept_card(&conn, &draft.summary.id).expect("accept card");
    assert_eq!(accepted.summary.status, "active");

    let outcome = queue::next_task(&conn).expect("next task");
    let task = outcome.task.expect("one new-card task");
    println!(
        "[queue] kind={} due={:?} budget={} new / {} review",
        task.kind, task.due_on, task.stats.new_remaining, task.stats.review_remaining
    );

    let answer = "管理员先核对编号并完成登记，登记完成后条目才从蓝色盒移入绿色盒。";
    let prepared = review::prepare_answer(&conn, &task.attempt.id, answer, Some(21_000))
        .expect("prepare answer");
    assert_eq!(prepared.first_answer, answer);

    let grade_context = review::grade_context(&conn, &task.attempt.id).expect("grade context");
    assert_eq!(grade_context.evidence.len(), 1);
    let grade_messages = llm::build_grade_messages(
        &prepared.revision.question,
        &prepared.revision.answer,
        answer,
        &grade_context.evidence,
        &grade_context.session_intent,
    );
    let grade_raw = llm::complete(&config, &grade_messages, true, 1200)
        .await
        .expect("real grading");
    println!("[grade-raw] {}", crate::text::truncate_chars(&grade_raw, 900));
    let feedback = llm::parse_grade(&grade_raw, &grade_context.evidence, &model)
        .expect("strict grade parser");
    println!(
        "[grade] verdict={} suggested={:?} evidence={}",
        feedback.verdict,
        llm::suggested_grade(&feedback.verdict),
        serde_json::to_string(&feedback.evidence).unwrap_or_default()
    );
    let graded = review::save_ai_feedback(&conn, &task.attempt.id, &feedback).expect("save feedback");
    assert!(graded.feedback.is_some());

    let key = format!("real-e2e-{}", Utc::now().timestamp_millis());
    let first = review::confirm_review(
        &conn,
        ConfirmReviewInput {
            attempt_id: task.attempt.id.clone(),
            grade: llm::suggested_grade(&feedback.verdict).unwrap_or(0),
            idempotency_key: key.clone(),
        },
    )
    .expect("confirm review");
    assert!(!first.already_existed);
    println!(
        "[review] grade={} interval={}d due={} label={:?}",
        first.grade, first.interval_days, first.due_on, first.next_due_label
    );

    let second = review::confirm_review(
        &conn,
        ConfirmReviewInput {
            attempt_id: task.attempt.id.clone(),
            grade: llm::suggested_grade(&feedback.verdict).unwrap_or(0),
            idempotency_key: key,
        },
    )
    .expect("duplicate confirm");
    assert!(second.already_existed);
    assert_eq!(first.review_id, second.review_id);
    assert_eq!(first.due_on, second.due_on);
    println!("[idempotent] same review={} due={}", second.review_id, second.due_on);

    let history = review::review_history(&conn, 7).expect("history");
    assert_eq!(history.iter().map(|day| day.reviews).sum::<i64>(), 1);
    let exported = repo::export::export_tsv(&conn, &data_dir.join("cards.tsv")).expect("export tsv");
    assert!(exported.rows >= 1);
    println!("[export] {} rows · {} bytes", exported.rows, exported.bytes);

    let _ = tokio::time::sleep(Duration::from_millis(10)).await;
    println!("[done] temporary database: {}", db_path.display());
}
