mod commands;
mod db;
mod error;
mod guided;
mod guided_commands;
mod guided_credentials;
mod llm;
mod models;
mod repo;
mod scheduler;
mod state;
mod study_sources;
mod text;

#[cfg(test)]
mod guided_tests;
#[cfg(test)]
mod real_model_test;

use std::path::PathBuf;

use tauri::Manager;

use crate::error::AppError;
use crate::state::AppState;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    if let Ok(custom) = std::env::var("FOLD_DATA_DIR") {
        if !custom.trim().is_empty() {
            let path = PathBuf::from(custom);
            std::fs::create_dir_all(&path)?;
            return Ok(path);
        }
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("无法定位应用数据目录：{e}")))?;
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let dir = data_dir(app.handle())?;
            let db_path = dir.join("fold.db");
            let conn = db::open_db(&db_path).map_err(|e| {
                eprintln!("fold: database open failed: {}", e.message());
                e
            })?;
            guided::init(&conn)?;
            repo::sessions::recover_streaming(&conn).ok();
            let _ = conn.execute(
                "UPDATE attempt SET status = 'ai_failed', ai_error = '上一次批改在应用退出时中断。答案已保留，可重试。'
                 WHERE status = 'grading'",
                [],
            );
            app.manage(AppState::new(conn, dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_bootstrap,
            guided_commands::guided_status,
            guided_commands::guided_save_key,
            guided_commands::guided_find_sources,
            guided_commands::guided_generate,
            guided_commands::guided_reset,
            guided_commands::guided_get_run,
            guided_commands::guided_start_question,
            guided_commands::guided_save_draft,
            guided_commands::guided_submit_answer,
            guided_commands::guided_confirm_answer,
            guided_commands::guided_begin_review,
            commands::complete_onboarding,
            commands::get_overview,
            commands::get_settings,
            commands::save_model_config,
            commands::clear_api_key,
            commands::test_model_connection,
            commands::save_study_settings,
            commands::save_ui_prefs,
            commands::mark_cloud_notice_seen,
            commands::list_sources,
            commands::get_source_detail,
            commands::import_source,
            commands::create_chunk,
            commands::list_annotations,
            commands::delete_source,
            commands::create_external_fragment,
            commands::list_sessions,
            commands::get_session,
            commands::create_session,
            commands::set_session_intent,
            commands::archive_session,
            commands::save_parent_anchor,
            commands::list_cards,
            commands::get_card,
            commands::create_card_draft,
            commands::update_card,
            commands::accept_card,
            commands::resolve_card_revision,
            commands::pause_card,
            commands::archive_card,
            commands::next_task,
            commands::queue_preview,
            commands::get_task,
            commands::abandon_attempt,
            commands::confirm_review,
            commands::request_hint,
            commands::practice_answer,
            commands::raise_objection,
            commands::switch_to_self,
            commands::review_history,
            commands::export_tsv,
            commands::export_json,
            commands::backup_database,
            commands::reveal_data_dir,
            commands::open_deepseek_page,
            commands::set_window_mode,
            commands::hide_window,
            commands::quit_app,
            commands::set_pinned,
            commands::ui_ready,
            commands::submit_answer,
            commands::retry_grade,
            commands::generate_card_draft,
            commands::send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running fold");
}
