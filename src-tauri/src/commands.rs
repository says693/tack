use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::llm::{self, AllowedEvidence, LlmConfig};
use crate::models::*;
use crate::repo::{self, cards, export, queue, review, sessions, sources};
use crate::state::AppState;

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>) -> AppResult<Bootstrap> {
    let conn = state.db()?;
    let mut bootstrap = repo::bootstrap(&conn, &state.data_dir)?;
    bootstrap.guided_ready = crate::guided::has_lesson(&conn)?;
    Ok(bootstrap)
}

#[tauri::command]
pub fn complete_onboarding(state: State<'_, AppState>) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    db::set_setting(&conn, "app.onboarded", "1")?;
    Ok(BooleanResult { ok: true, changed: true })
}

#[tauri::command]
pub fn get_overview(state: State<'_, AppState>) -> AppResult<Overview> {
    let conn = state.db()?;
    repo::overview(&conn)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<SettingsView> {
    let conn = state.db()?;
    Ok(SettingsView {
        model: repo::model_status(&conn),
        study: repo::study_settings(&conn),
    })
}

#[tauri::command]
pub fn save_model_config(state: State<'_, AppState>, input: ModelConfigInput) -> AppResult<ModelStatus> {
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err(AppError::user("base_url_required", "请填写 Base URL。"));
    }
    let parsed = reqwest::Url::parse(&base_url)
        .map_err(|_| AppError::user("bad_base_url", "Base URL 不是有效网址。"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::user("bad_base_url", "Base URL 只允许 http 或 https。"));
    }
    if input.model.trim().is_empty() {
        return Err(AppError::user("model_required", "请填写模型名。"));
    }
    let provider = match input.provider.as_str() {
        "deepseek" | "openai" | "ollama" | "custom" => input.provider.as_str(),
        _ => "custom",
    };
    let conn = state.db()?;
    let new_key = input.api_key.as_deref().map(str::trim).filter(|key| !key.is_empty());
    let old_url = db::get_setting(&conn, "model.base_url").unwrap_or_default();
    let same_endpoint = old_url.trim_end_matches('/') == base_url
        || (matches!(old_url.trim_end_matches('/'), "https://api.deepseek.com" | "https://api.deepseek.com/v1")
            && matches!(base_url.as_str(), "https://api.deepseek.com" | "https://api.deepseek.com/v1"));
    if !same_endpoint && new_key.is_none()
        && db::get_setting(&conn, "model.api_key").is_some_and(|key| !key.trim().is_empty())
    {
        return Err(AppError::user("endpoint_key_required", "切换服务地址需要填写对应的新密钥，或先清除旧密钥。"));
    }
    db::set_setting(&conn, "model.provider", provider)?;
    db::set_setting(&conn, "model.base_url", &base_url)?;
    db::set_setting(&conn, "model.model", input.model.trim())?;
    if let Some(key) = new_key {
        db::set_setting(&conn, "model.api_key", key)?;
    }
    if let Some(temp) = input.temperature {
        let temp = temp.clamp(0.0, 1.5);
        db::set_setting(&conn, "model.temperature", &format!("{temp:.2}"))?;
    }
    db::set_setting(&conn, "model.last_test_at", "")?;
    db::set_setting(&conn, "model.last_test_ok", "")?;
    db::set_setting(&conn, "model.last_test_message", "")?;
    db::log_event(
        &conn,
        "model_configured",
        &json!({"provider": provider, "model": input.model, "baseUrl": base_url}).to_string(),
    )?;
    Ok(repo::model_status(&conn))
}

#[tauri::command]
pub fn clear_api_key(state: State<'_, AppState>) -> AppResult<ModelStatus> {
    let conn = state.db()?;
    db::set_setting(&conn, "model.api_key", "")?;
    db::set_setting(&conn, "model.last_test_ok", "")?;
    db::set_setting(&conn, "model.last_test_message", "已清除密钥")?;
    Ok(repo::model_status(&conn))
}

#[tauri::command]
pub async fn test_model_connection(state: State<'_, AppState>) -> AppResult<TestModelResult> {
    let config = {
        let conn = state.db()?;
        LlmConfig::load(&conn).ok_or_else(|| {
            AppError::user(
                "model_not_configured",
                "还没有可用的模型配置。请先填写 Base URL、模型名和密钥。",
            )
        })?
    };
    let started = Instant::now();
    let result = llm::test_connection(&config).await;
    let latency = started.elapsed().as_millis() as i64;
    let conn = state.db()?;
    let now = db::now_utc();
    db::set_setting(&conn, "model.last_test_at", &now)?;
    match result {
        Ok((_, content)) => {
            db::set_setting(&conn, "model.last_test_ok", "1")?;
            db::set_setting(&conn, "model.last_test_message", "连接成功")?;
            Ok(TestModelResult {
                ok: true,
                latency_ms: latency,
                message: format!("连接成功，模型回复：{}", crate::text::truncate_chars(&content, 40)),
                model: config.model,
            })
        }
        Err(e) => {
            let message = e.message();
            db::set_setting(&conn, "model.last_test_ok", "0")?;
            db::set_setting(&conn, "model.last_test_message", &message)?;
            Ok(TestModelResult {
                ok: false,
                latency_ms: latency,
                message,
                model: config.model,
            })
        }
    }
}

#[tauri::command]
pub fn save_study_settings(state: State<'_, AppState>, input: StudySettingsInput) -> AppResult<StudySettings> {
    let mut conn = state.db()?;
    persist_study_settings(&mut conn, input)
}

fn persist_study_settings(conn: &mut rusqlite::Connection, input: StudySettingsInput) -> AppResult<StudySettings> {
    let tz = input
        .timezone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| AppError::user("bad_timezone", "时区标识无效。请填写例如 Asia/Shanghai。"))?;
    let metric = if input.capsule_metric == "new" { "new" } else { "due" };
    let tx = conn.transaction()?;
    db::set_setting(&tx, "study.daily_new", &input.daily_new.clamp(1, 200).to_string())?;
    db::set_setting(&tx, "study.daily_review", &input.daily_review.clamp(1, 500).to_string())?;
    db::set_setting(&tx, "study.timezone", tz.name())?;
    db::set_setting(&tx, "ui.capsule_metric", metric)?;
    tx.commit()?;
    Ok(repo::study_settings(conn))
}

#[tauri::command]
pub fn save_ui_prefs(state: State<'_, AppState>, theme: String) -> AppResult<()> {
    let conn = state.db()?;
    let theme = if theme == "paper" { "paper" } else { "ink" };
    db::set_setting(&conn, "ui.theme", theme)
}

#[cfg(test)]
mod preference_tests {
    use super::*;

    fn study_input() -> StudySettingsInput {
        StudySettingsInput {
            daily_new: 22,
            daily_review: 700,
            timezone: "Asia/Tokyo".into(),
            capsule_metric: "new".into(),
        }
    }

    #[test]
    fn study_write_preserves_theme_and_returns_normalized_preferences() {
        let mut conn = db::test_conn();
        db::set_setting(&conn, "ui.theme", "paper").unwrap();
        let saved = persist_study_settings(&mut conn, study_input()).unwrap();
        assert_eq!(saved.theme, "paper");
        assert_eq!(saved.daily_new, 22);
        assert_eq!(saved.daily_review, 500);
        assert_eq!(saved.timezone, "Asia/Tokyo");
        assert_eq!(saved.capsule_metric, "new");
    }

    #[test]
    fn study_write_rolls_back_if_last_setting_fails() {
        let mut conn = db::test_conn();
        let before = repo::study_settings(&conn);
        conn.execute_batch(
            "CREATE TEMP TRIGGER fail_metric BEFORE UPDATE ON settings
             WHEN NEW.key = 'ui.capsule_metric'
             BEGIN SELECT RAISE(ABORT, 'simulated setting write failure'); END;",
        )
        .unwrap();

        assert!(persist_study_settings(&mut conn, study_input()).is_err());
        let after = repo::study_settings(&conn);
        assert_eq!(after.daily_new, before.daily_new);
        assert_eq!(after.daily_review, before.daily_review);
        assert_eq!(after.timezone, before.timezone);
        assert_eq!(after.capsule_metric, before.capsule_metric);
    }
}

#[tauri::command]
pub fn mark_cloud_notice_seen(state: State<'_, AppState>) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    db::set_setting(&conn, "privacy.cloud_notice_seen", "1")?;
    Ok(BooleanResult { ok: true, changed: true })
}

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> AppResult<Vec<SourceSummary>> {
    let conn = state.db()?;
    repo::list_sources(&conn, false)
}

#[tauri::command]
pub fn get_source_detail(state: State<'_, AppState>, source_id: String, revision_id: Option<String>) -> AppResult<SourceDetail> {
    let conn = state.db()?;
    sources::source_detail(&conn, &source_id, revision_id.as_deref())
}

#[tauri::command]
pub fn import_source(state: State<'_, AppState>, input: ImportSourceInput) -> AppResult<SourceDetail> {
    let conn = state.db()?;
    sources::import_source(&conn, input)
}

#[tauri::command]
pub fn create_chunk(state: State<'_, AppState>, input: ChunkInput) -> AppResult<ChunkView> {
    let conn = state.db()?;
    sources::create_chunk(&conn, input)
}

#[tauri::command]
pub fn list_annotations(state: State<'_, AppState>, source_id: String, revision_id: String) -> AppResult<Vec<SourceAnnotation>> {
    let conn = state.db()?;
    sources::list_annotations(&conn, &source_id, &revision_id)
}

#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, source_id: String) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    let paused = sources::delete_source(&conn, &source_id)?;
    Ok(BooleanResult { ok: true, changed: paused > 0 })
}

#[tauri::command]
pub fn create_external_fragment(state: State<'_, AppState>, content: String, note: Option<String>) -> AppResult<SourceDetail> {
    let conn = state.db()?;
    sources::external_fragment(&conn, &content, note)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> AppResult<Vec<SessionSummary>> {
    let conn = state.db()?;
    repo::list_sessions(&conn, 40)
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>, session_id: String) -> AppResult<SessionDetail> {
    let conn = state.db()?;
    sessions::get_session(&conn, &session_id)
}

#[tauri::command]
pub fn create_session(state: State<'_, AppState>, input: SessionCreateInput) -> AppResult<SessionDetail> {
    let conn = state.db()?;
    sessions::create_session(&conn, input)
}

#[tauri::command]
pub fn set_session_intent(state: State<'_, AppState>, session_id: String, intent: String) -> AppResult<SessionSummary> {
    let conn = state.db()?;
    sessions::set_intent(&conn, &session_id, &intent)
}

#[tauri::command]
pub fn archive_session(state: State<'_, AppState>, session_id: String) -> AppResult<SessionSummary> {
    let conn = state.db()?;
    sessions::archive_session(&conn, &session_id)
}

#[tauri::command]
pub fn save_parent_anchor(state: State<'_, AppState>, session_id: String, anchor: Option<String>) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    sessions::save_parent_anchor(&conn, &session_id, anchor.as_deref())?;
    Ok(BooleanResult { ok: true, changed: true })
}

#[tauri::command]
pub fn list_cards(state: State<'_, AppState>, status: Option<String>) -> AppResult<Vec<CardSummary>> {
    let conn = state.db()?;
    cards::list_cards(&conn, status.as_deref())
}

#[tauri::command]
pub fn get_card(state: State<'_, AppState>, card_id: String) -> AppResult<CardDetail> {
    let conn = state.db()?;
    repo::get_card_detail(&conn, &card_id)
}

#[tauri::command]
pub fn create_card_draft(state: State<'_, AppState>, input: CardDraftInput) -> AppResult<CardDetail> {
    let conn = state.db()?;
    cards::create_draft(&conn, input)
}

#[tauri::command]
pub fn update_card(state: State<'_, AppState>, card_id: String, input: CardRevisionInput) -> AppResult<CardUpdateResult> {
    let conn = state.db()?;
    cards::update_card(&conn, &card_id, input)
}

#[tauri::command]
pub fn accept_card(state: State<'_, AppState>, card_id: String) -> AppResult<CardDetail> {
    let conn = state.db()?;
    cards::accept_card(&conn, &card_id)
}

#[tauri::command]
pub fn resolve_card_revision(state: State<'_, AppState>, card_id: String, decision: String) -> AppResult<CardDetail> {
    let conn = state.db()?;
    cards::resolve_revision(&conn, &card_id, &decision)
}

#[tauri::command]
pub fn pause_card(state: State<'_, AppState>, card_id: String, reason: Option<String>) -> AppResult<CardDetail> {
    let conn = state.db()?;
    cards::pause_card(&conn, &card_id, reason.as_deref())
}

#[tauri::command]
pub fn archive_card(state: State<'_, AppState>, card_id: String) -> AppResult<CardDetail> {
    let conn = state.db()?;
    cards::archive_card(&conn, &card_id)
}

#[tauri::command]
pub fn next_task(state: State<'_, AppState>) -> AppResult<TaskOutcome> {
    let conn = state.db()?;
    queue::next_task(&conn)
}

#[tauri::command]
pub fn queue_preview(state: State<'_, AppState>) -> AppResult<QueuePreview> {
    let conn = state.db()?;
    queue::queue_preview(&conn)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, attempt_id: String) -> AppResult<Option<Task>> {
    let conn = state.db()?;
    queue::get_task_for_attempt(&conn, &attempt_id)
}

#[tauri::command]
pub fn abandon_attempt(state: State<'_, AppState>, attempt_id: String) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    queue::abandon_attempt(&conn, &attempt_id)
}

#[tauri::command]
pub fn confirm_review(state: State<'_, AppState>, input: ConfirmReviewInput) -> AppResult<ReviewResult> {
    let conn = state.db()?;
    review::confirm_review(&conn, input)
}

#[tauri::command]
pub fn request_hint(state: State<'_, AppState>, attempt_id: String) -> AppResult<Option<String>> {
    let conn = state.db()?;
    review::request_hint(&conn, &attempt_id)
}

#[tauri::command]
pub fn practice_answer(state: State<'_, AppState>, attempt_id: String, answer: String) -> AppResult<AttemptView> {
    let conn = state.db()?;
    review::practice_answer(&conn, &attempt_id, &answer)
}

#[tauri::command]
pub fn raise_objection(state: State<'_, AppState>, attempt_id: String, reason: String) -> AppResult<BooleanResult> {
    let conn = state.db()?;
    review::raise_objection(&conn, &attempt_id, &reason)
}

#[tauri::command]
pub fn switch_to_self(state: State<'_, AppState>, attempt_id: String) -> AppResult<AttemptView> {
    let conn = state.db()?;
    review::switch_to_self(&conn, &attempt_id)
}

#[tauri::command]
pub fn review_history(state: State<'_, AppState>, days: Option<i64>) -> AppResult<Vec<DayCount>> {
    let conn = state.db()?;
    review::review_history(&conn, days.unwrap_or(30))
}

#[tauri::command]
pub fn export_tsv(state: State<'_, AppState>, path: String) -> AppResult<ExportResult> {
    let conn = state.db()?;
    let result = export::export_tsv(&conn, Path::new(&path))?;
    db::log_event(&conn, "export_tsv", &json!({"rows": result.rows, "path": result.path}).to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn export_json(state: State<'_, AppState>, path: String) -> AppResult<ExportResult> {
    let conn = state.db()?;
    let result = export::export_json(&conn, Path::new(&path))?;
    db::log_event(&conn, "export_json", &json!({"cards": result.rows, "path": result.path}).to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn backup_database(state: State<'_, AppState>, path: String) -> AppResult<ExportResult> {
    let conn = state.db()?;
    let result = export::backup_db(&conn, Path::new(&path))?;
    db::log_event(&conn, "backup_database", &json!({"path": result.path, "bytes": result.bytes}).to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn reveal_data_dir(state: State<'_, AppState>) -> AppResult<BooleanResult> {
    let path = state.data_dir.clone();
    open_path(&path)?;
    Ok(BooleanResult { ok: true, changed: true })
}

#[tauri::command]
pub fn open_deepseek_page(page: String) -> AppResult<()> {
    let url = match page.as_str() {
        "docs" => "https://api-docs.deepseek.com/zh-cn/",
        "keys" => "https://platform.deepseek.com/api_keys",
        "topup" => "https://platform.deepseek.com/top_up",
        _ => return Err(AppError::user("unknown_page", "无法打开该页面。")),
    };
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(url).spawn()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(url).spawn()?;
    Ok(())
}

fn open_path(path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::user("open_failed", format!("无法打开目录：{e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_window_mode(window: WebviewWindow, mode: String) -> AppResult<()> {
    let guided = mode == "guided";
    let _ = window.set_decorations(guided);
    let _ = window.set_skip_taskbar(mode == "capsule");
    if guided {
        let _ = window.set_always_on_top(false);
    }
    let (w, h) = match mode.as_str() {
        "guided" => (720.0, 700.0),
        "capsule" => (212.0, 58.0),
        "panel" => (480.0, 780.0),
        "panorama" => (1220.0, 800.0),
        "review" => (560.0, 800.0),
        "settings" => (860.0, 820.0),
        _ => (480.0, 780.0),
    };
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| AppError::Internal(format!("窗口尺寸调整失败：{e}")))?;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let margin = 18.0;
        let centered = guided || matches!(mode.as_str(), "panorama" | "review" | "settings");
        let (x, y) = if mode == "capsule" {
            (size.width - w - margin, (size.height - h) / 2.0)
        } else if centered {
            ((size.width - w) / 2.0, (size.height - h) / 2.0)
        } else {
            (size.width - w - 24.0, ((size.height - h) / 2.0).max(20.0))
        };
        window
            .set_position(tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)))
            .map_err(|e| AppError::Internal(format!("窗口位置调整失败：{e}")))?;
    }
    let _ = window.show();
    if mode != "capsule" {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn hide_window(window: WebviewWindow) -> AppResult<()> {
    window.hide().map_err(|e| AppError::Internal(format!("隐藏窗口失败：{e}")))?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn set_pinned(window: WebviewWindow, pinned: bool) -> AppResult<BooleanResult> {
    window
        .set_always_on_top(pinned)
        .map_err(|e| AppError::Internal(format!("置顶设置失败：{e}")))?;
    Ok(BooleanResult { ok: true, changed: true })
}

#[tauri::command]
pub fn ui_ready(app: AppHandle, window: WebviewWindow, mode: String) -> AppResult<()> {
    set_window_mode(window.clone(), mode.clone())?;
    if mode != "capsule" {
        let _ = window.set_focus();
    }
    let _ = app.emit("fold:ready", ());
    Ok(())
}

#[tauri::command]
pub async fn submit_answer(
    state: State<'_, AppState>,
    input: SubmitAnswerInput,
) -> AppResult<AttemptView> {
    let (attempt, context, config, notice_seen) = {
        let conn = state.db()?;
        let attempt = review::prepare_answer(&conn, &input.attempt_id, &input.answer, input.latency_ms)?;
        if attempt.card.mode == "self" {
            return Ok(attempt);
        }
        let config = LlmConfig::load(&conn);
        let context = review::grade_context(&conn, &input.attempt_id)?;
        let notice_seen = db::get_setting(&conn, "privacy.cloud_notice_seen").as_deref() == Some("1");
        (attempt, context, config, notice_seen)
    };
    if !notice_seen && !input.cloud_ack {
        let conn = state.db()?;
        conn.execute(
            "UPDATE attempt SET status = 'awaiting_ack', ai_error = '等待确认云端发送范围' WHERE id = ?1",
            [&input.attempt_id],
        )?;
        return Err(AppError::user(
            "cloud_notice_required",
            "首次把原文、你的答案和相邻消息发送到模型前，需要确认。",
        ));
    }
    if input.cloud_ack {
        let conn = state.db()?;
        db::set_setting(&conn, "privacy.cloud_notice_seen", "1")?;
    }
    let Some(config) = config else {
        let conn = state.db()?;
        return review::save_ai_failure(&conn, &input.attempt_id, "模型未配置。答案已保留，可重试或明确改用自评。");
    };
    let messages = llm::build_grade_messages(
        &context.attempt.revision.question,
        &context.attempt.revision.answer,
        &attempt.first_answer,
        &context.evidence,
        &context.session_intent,
    );
    let result = llm::complete(&config, &messages, true, 1200).await;
    let conn = state.db()?;
    match result {
        Ok(raw) => match llm::parse_grade(&raw, &context.evidence, &config.model) {
            Ok(feedback) => review::save_ai_feedback(&conn, &input.attempt_id, &feedback),
            Err(e) => review::save_ai_failure(&conn, &input.attempt_id, &e.message()),
        },
        Err(e) => review::save_ai_failure(&conn, &input.attempt_id, &e.message()),
    }
}

#[tauri::command]
pub async fn retry_grade(
    state: State<'_, AppState>,
    attempt_id: String,
    cloud_ack: bool,
) -> AppResult<AttemptView> {
    let (attempt, context, config, notice_seen) = {
        let conn = state.db()?;
        let attempt = repo::get_attempt(&conn, &attempt_id)?;
        if attempt.card.mode == "self" {
            return Ok(attempt);
        }
        if attempt.first_answer.trim().is_empty() {
            return Err(AppError::user("answer_required", "先提交首次答案。"));
        }
        if attempt.status == "confirmed" || attempt.status == "feedback" || attempt.status == "insufficient" {
            return Ok(attempt);
        }
        let config = LlmConfig::load(&conn);
        let context = review::grade_context(&conn, &attempt_id)?;
        let notice_seen = db::get_setting(&conn, "privacy.cloud_notice_seen").as_deref() == Some("1");
        (attempt, context, config, notice_seen)
    };
    if !notice_seen && !cloud_ack {
        return Err(AppError::user(
            "cloud_notice_required",
            "首次把内容发送到模型前，需要确认发送范围。",
        ));
    }
    if cloud_ack {
        let conn = state.db()?;
        db::set_setting(&conn, "privacy.cloud_notice_seen", "1")?;
    }
    let Some(config) = config else {
        let conn = state.db()?;
        return review::save_ai_failure(&conn, &attempt_id, "模型未配置。答案已保留，可重试或明确改用自评。");
    };
    let messages = llm::build_grade_messages(
        &attempt.revision.question,
        &attempt.revision.answer,
        &attempt.first_answer,
        &context.evidence,
        &context.session_intent,
    );
    let result = llm::complete(&config, &messages, true, 1200).await;
    let conn = state.db()?;
    match result {
        Ok(raw) => match llm::parse_grade(&raw, &context.evidence, &config.model) {
            Ok(feedback) => review::save_ai_feedback(&conn, &attempt_id, &feedback),
            Err(e) => review::save_ai_failure(&conn, &attempt_id, &e.message()),
        },
        Err(e) => review::save_ai_failure(&conn, &attempt_id, &e.message()),
    }
}

#[tauri::command]
pub async fn generate_card_draft(
    state: State<'_, AppState>,
    input: CardGenerationInput,
) -> AppResult<CardGenerationResult> {
    let (session, chunk, config, notice_seen, source_title) = {
        let conn = state.db()?;
        let session = sessions::get_session(&conn, &input.session_id)?;
        let chunk_id = input
            .chunk_id
            .clone()
            .or_else(|| session.session.fork_chunk_id.clone())
            .ok_or_else(|| {
                AppError::user(
                    "chunk_required",
                    "这个会话没有绑定原文片段。先从阅读区选中一段原文，再生成卡片。",
                )
            })?;
        let chunk = repo::get_chunk(&conn, &chunk_id)?;
        let source_title = repo::get_source(&conn, &chunk.source_id).ok().map(|s| s.title);
        let config = LlmConfig::load(&conn);
        let notice_seen = db::get_setting(&conn, "privacy.cloud_notice_seen").as_deref() == Some("1");
        (session, chunk, config, notice_seen, source_title)
    };
    if !notice_seen && !input.cloud_ack {
        return Err(AppError::user(
            "cloud_notice_required",
            "首次把内容发送到模型前，需要确认发送范围。",
        ));
    }
    if input.cloud_ack {
        let conn = state.db()?;
        db::set_setting(&conn, "privacy.cloud_notice_seen", "1")?;
    }
    let config = config.ok_or_else(|| {
        AppError::user(
            "model_not_configured",
            "模型未配置。你仍然可以手写卡片，或先在设置里配置模型。",
        )
    })?;
    let summary: String = {
        let conn = state.db()?;
        conn.query_row(
            "SELECT content FROM message WHERE session_id = ?1 AND role = 'assistant' AND status = 'complete'
             ORDER BY ordinal DESC LIMIT 1",
            [&input.session_id],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| session.session.seed_name.clone())
    };
    let allowed = AllowedEvidence {
        chunk_id: chunk.id.clone(),
        text: chunk.quote_exact.clone(),
        source_title: source_title.clone(),
        label: None,
    };
    let messages = llm::build_card_messages(
        &allowed,
        &summary,
        &session.session.intent,
        Some(input.concept_name.as_deref().unwrap_or(&session.session.seed_name)),
    );
    let raw = llm::complete(&config, &messages, true, 900).await?;
    let generated = llm::parse_generated_card(&raw, &allowed)?;
    let draft = {
        let conn = state.db()?;
        cards::create_draft(
            &conn,
            CardDraftInput {
                concept_name: input
                    .concept_name
                    .clone()
                    .unwrap_or_else(|| session.session.seed_name.clone()),
                question: generated.question,
                answer: generated.answer,
                evidence_chunk_id: Some(chunk.id.clone()),
                evidence_excerpt: generated.evidence_quote.clone(),
                exercise_origin: "generated".into(),
                origin_note: Some(format!("由 {} 根据本次原文新编", config.model)),
                mode: "ai".into(),
                session_id: Some(input.session_id.clone()),
            },
        )?
    };
    Ok(CardGenerationResult {
        draft,
        evidence: EvidenceRef {
            chunk_id: chunk.id,
            excerpt: generated.evidence_quote,
            source_title,
            label: None,
            matched: true,
        },
    })
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
    cloud_ack: bool,
) -> AppResult<ChatStartResult> {
    if text.trim().is_empty() {
        return Err(AppError::user("empty_message", "消息不能为空。"));
    }
    let (session, context, config, user_message, assistant_message) = {
        let conn = state.db()?;
        let session = repo::get_session_summary(&conn, &session_id)?;
        let config = LlmConfig::load(&conn).ok_or_else(|| {
            AppError::user(
                "model_not_configured",
                "模型未配置。请先在设置里填写 Base URL、模型名和密钥。",
            )
        })?;
        let notice_seen = db::get_setting(&conn, "privacy.cloud_notice_seen").as_deref() == Some("1");
        if !notice_seen && !cloud_ack {
            return Err(AppError::user(
                "cloud_notice_required",
                "首次把消息和原文发送到模型前，需要确认发送范围。",
            ));
        }
        let streaming: Option<String> = conn
            .query_row(
                "SELECT id FROM message WHERE session_id = ?1 AND status = 'streaming' LIMIT 1",
                [&session_id],
                |r| r.get(0),
            )
            .ok();
        if streaming.is_some() {
            return Err(AppError::user(
                "stream_in_progress",
                "上一条回复还在生成。请等它结束，或先停止后再发送。",
            ));
        }
        if cloud_ack {
            db::set_setting(&conn, "privacy.cloud_notice_seen", "1")?;
        }
        let context = sessions::build_chat_context(&conn, &session)?;
        let user_message = sessions::insert_message(&conn, &session_id, "user", text.trim(), "complete", None, &[])?;
        let assistant_message = sessions::insert_message(&conn, &session_id, "assistant", "", "streaming", None, &[])?;
        (session, context, config, user_message, assistant_message)
    };
    let messages = llm::build_chat_messages(&context.system, &context.messages, text.trim());
    let app2 = app.clone();
    let session_id2 = session.id.clone();
    let assistant_id = assistant_message.id.clone();
    let full = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let last_persist = std::sync::Arc::new(std::sync::Mutex::new(Instant::now()));
    tauri::async_runtime::spawn(async move {
        let result = {
            let app3 = app2.clone();
            let session_id3 = session_id2.clone();
            let assistant_id3 = assistant_id.clone();
            let full3 = full.clone();
            let last_persist3 = last_persist.clone();
            llm::stream(&config, &messages, 2400, move |delta: &str| {
                let mut buf = match full3.lock() {
                    Ok(v) => v,
                    Err(_) => return,
                };
                buf.push_str(delta);
                let _ = app3.emit(
                    "llm:delta",
                    LlmDeltaPayload {
                        session_id: session_id3.clone(),
                        message_id: assistant_id3.clone(),
                        delta: delta.to_string(),
                    },
                );
                let should_persist = last_persist3
                    .lock()
                    .map(|t| t.elapsed() > Duration::from_millis(300))
                    .unwrap_or(false);
                if should_persist {
                    if let Ok(conn) = app3.state::<AppState>().db() {
                        let _ = sessions::update_message(&conn, &assistant_id3, &buf, "streaming", None);
                    }
                    if let Ok(mut t) = last_persist3.lock() {
                        *t = Instant::now();
                    }
                }
            })
            .await
        };
        let content = full.lock().map(|v| v.clone()).unwrap_or_default();
        let state_now = app2.state::<AppState>();
        let Ok(conn) = state_now.db() else {
            return;
        };
        match result {
            Ok(final_content) => {
                let _ = sessions::update_message(&conn, &assistant_id, &final_content, "complete", None);
                let _ = app2.emit(
                    "llm:done",
                    LlmDonePayload {
                        session_id: session_id2,
                        message_id: assistant_id,
                        content: final_content,
                    },
                );
            }
            Err(e) => {
                let message = e.message();
                let partial = if content.trim().is_empty() {
                    format!("生成失败：{message}")
                } else {
                    content
                };
                let _ = sessions::update_message(&conn, &assistant_id, &partial, "failed", Some(&message));
                let _ = app2.emit(
                    "llm:error",
                    LlmErrorPayload {
                        session_id: session_id2,
                        message_id: assistant_id,
                        code: e.code().to_string(),
                        message,
                    },
                );
            }
        }
    });
    Ok(ChatStartResult {
        user_message,
        assistant_message,
    })
}
