#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Clone, Serialize, Deserialize, Default)]
struct AnchorSeed {
    subject: String,
    selected: String,
    title: String,
    parent: String,
}

#[derive(Default)]
struct AppState {
    seed: Mutex<AnchorSeed>,
    hud: Mutex<Value>,
    menu: Mutex<Option<tauri::menu::Menu<tauri::Wry>>>,
    gate: tokio::sync::Mutex<()>,
}

#[tauri::command]
async fn core_request(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    request: Value,
) -> Result<Value, String> {
    let _guard = state.gate.lock().await;
    let mut input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if input.len() > 1_000_000 {
        return Err("请求过大".into());
    }
    input.push(b'\n');
    let data_dir = match std::env::var_os("TACK_DATA_DIR") {
        Some(path) => std::path::PathBuf::from(path),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    let command = app
        .shell()
        .sidecar("tack-core")
        .map_err(|e| e.to_string())?
        .env("TACK_DATA_DIR", data_dir)
        .kill_on_drop(true)
        .set_process_group(true);
    let (mut rx, mut child) = command
        .spawn()
        .map_err(|e| format!("学习内核启动失败：{e}"))?;
    child
        .write(&input)
        .map_err(|e| format!("学习内核请求发送失败：{e}"))?;
    let execution = async {
        let mut output = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    output.extend(bytes);
                    if output.len() > 8_000_000 {
                        return Err("学习内核响应过大".to_string());
                    }
                }
                CommandEvent::Error(_) => return Err("学习内核通信失败".into()),
                CommandEvent::Terminated(status) => {
                    if status.code != Some(0) {
                        return Err(format!("学习内核异常退出：{:?}", status.code));
                    }
                    let envelope: Value = serde_json::from_slice(&output)
                        .map_err(|_| "学习内核返回了无效响应".to_string())?;
                    if envelope["ok"] == true {
                        return Ok(envelope["result"].clone());
                    }
                    return Err(envelope["error"]
                        .as_str()
                        .unwrap_or("学习内核报告错误")
                        .to_string());
                }
                _ => {}
            }
        }
        Err("学习内核连接意外关闭".into())
    };
    let result = tokio::time::timeout(Duration::from_secs(1250), execution)
        .await
        .map_err(|_| "操作超时，请使用相同操作重试；不会重复保存".to_string())?;
    // kill_on_drop also cleans PyInstaller's child process on timeout/cancellation.
    drop(child);
    result
}

#[tauri::command]
async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("学习材料", &["txt", "md", "pdf"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn anchor_seed(state: tauri::State<'_, AppState>) -> Result<AnchorSeed, String> {
    Ok(state.seed.lock().map_err(|e| e.to_string())?.clone())
}

fn place_anchor(app: &AppHandle) -> tauri::Result<()> {
    let main = app
        .get_webview_window("main")
        .expect("configured main window");
    let anchor = app
        .get_webview_window("anchor")
        .expect("configured anchor window");
    let pos = main.outer_position()?;
    let size = main.outer_size()?;
    let anchor_size = anchor.outer_size()?;
    let monitor = main
        .current_monitor()?
        .ok_or_else(|| std::io::Error::other("显示器缺失"))?;
    let area = monitor.work_area();
    let gap = (16.0 * main.scale_factor()?) as i32;
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let preferred = pos.x + size.width as i32 + gap;
    let x = if preferred + anchor_size.width as i32 <= right {
        preferred
    } else {
        pos.x - anchor_size.width as i32 - gap
    };
    anchor.set_position(PhysicalPosition::new(
        x.clamp(
            area.position.x,
            (right - anchor_size.width as i32).max(area.position.x),
        ),
        (pos.y + gap).clamp(
            area.position.y,
            (bottom - anchor_size.height as i32).max(area.position.y),
        ),
    ))
}

#[tauri::command]
fn open_anchor(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    seed: AnchorSeed,
) -> Result<(), String> {
    if seed.selected.is_empty() || seed.selected.chars().count() > 4000 {
        return Err("请选择 1–4000 字的原文".into());
    }
    *state.seed.lock().map_err(|e| e.to_string())? = seed;
    place_anchor(&app).map_err(|e| e.to_string())?;
    let anchor = app.get_webview_window("anchor").ok_or("锚点窗口缺失")?;
    anchor
        .emit("anchor:refresh", ())
        .map_err(|e| e.to_string())?;
    anchor.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_anchor(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("anchor")
        .ok_or("锚点窗口缺失")?
        .hide()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn notify_hud(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    due: u32,
    mode: String,
) -> Result<(), String> {
    let status = json!({"due": due, "mode": mode});
    *state.hud.lock().map_err(|e| e.to_string())? = status.clone();
    app.emit_to("hud", "hud:status", status)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hud_status(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    Ok(state.hud.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn data_changed(app: AppHandle) -> Result<(), String> {
    app.emit_to("main", "data:changed", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_main(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or("主窗缺失")?
        .hide()
        .map_err(|e| e.to_string())?;
    close_anchor(app)
}

#[tauri::command]
fn toggle_main(app: AppHandle) -> Result<bool, String> {
    let main = app.get_webview_window("main").ok_or("主窗缺失")?;
    if main.is_visible().map_err(|e| e.to_string())?
        && !main.is_minimized().map_err(|e| e.to_string())?
    {
        hide_main(app)?;
        Ok(false)
    } else {
        main.unminimize().map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

fn place_hud(app: &AppHandle) -> Result<(), String> {
    let hud = app.get_webview_window("hud").ok_or("HUD 缺失")?;
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("显示器缺失")?;
    let area = monitor.work_area();
    let size = hud.outer_size().map_err(|e| e.to_string())?;
    let margin = (20.0 * monitor.scale_factor()) as i32;
    hud.set_position(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - size.width as i32 - margin,
        area.position.y + area.size.height as i32 - size.height as i32 - margin,
    ))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_hud_menu(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    let hud = app.get_webview_window("hud").ok_or("HUD 缺失")?;
    let open = MenuItem::with_id(&app, "open", "打开今日", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let reset = MenuItem::with_id(&app, "reset", "回到右下角", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let top = CheckMenuItem::with_id(
        &app,
        "top",
        "置顶",
        true,
        hud.is_always_on_top().map_err(|e| e.to_string())?,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", "退出 tack", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu =
        Menu::with_items(&app, &[&open, &reset, &top, &sep, &quit]).map_err(|e| e.to_string())?;
    *state.menu.lock().map_err(|e| e.to_string())? = Some(menu.clone());
    hud.popup_menu(&menu).map_err(|e| e.to_string())
}

fn menu_action(app: &AppHandle, id: &str) -> Result<(), String> {
    match id {
        "open" => {
            let main = app.get_webview_window("main").ok_or("主窗缺失")?;
            main.unminimize().map_err(|e| e.to_string())?;
            main.show().map_err(|e| e.to_string())?;
            main.set_focus().map_err(|e| e.to_string())
        }
        "reset" => place_hud(app),
        "top" => {
            let hud = app.get_webview_window("hud").ok_or("HUD 缺失")?;
            hud.set_always_on_top(!hud.is_always_on_top().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())
        }
        "quit" => {
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            core_request,
            pick_files,
            anchor_seed,
            open_anchor,
            close_anchor,
            notify_hud,
            hud_status,
            data_changed,
            hide_main,
            toggle_main,
            show_hud_menu
        ])
        .on_menu_event(|app, event| {
            if let Err(err) = menu_action(app, event.id().as_ref()) {
                eprintln!("[tack] {err}");
                let _ = app.emit("app:error", err);
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
            let handle = app.handle().clone();
            place_hud(&handle).map_err(std::io::Error::other)?;
            let main = app.get_webview_window("main").ok_or("主窗缺失")?;
            let windows_app = handle.clone();
            main.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(err) = hide_main(windows_app.clone()) {
                        eprintln!("{err}");
                    }
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    if let Some(anchor) = windows_app.get_webview_window("anchor") {
                        if anchor.is_visible().unwrap_or(false) {
                            if let Err(err) = place_anchor(&windows_app) {
                                eprintln!("{err}");
                            }
                        }
                    }
                }
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                    let files: Vec<String> = paths
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    if let Err(err) = windows_app.emit_to("main", "main:dropped", files) {
                        eprintln!("{err}");
                    }
                }
                _ => {}
            });
            if let Some(anchor) = app.get_webview_window("anchor") {
                let anchor_app = handle.clone();
                anchor.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Err(err) = close_anchor(anchor_app.clone()) {
                            eprintln!("{err}");
                        }
                    }
                });
            }
            let open = MenuItem::with_id(app, "open", "打开 tack", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().ok_or("缺少图标")?.clone())
                .tooltip("tack · 知识钉板")
                .menu(&menu)
                .build(app)?;
            let hotkey_app = handle.clone();
            app.global_shortcut()
                .on_shortcut("ctrl+shift+t", move |_app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Err(err) = toggle_main(hotkey_app.clone()) {
                            eprintln!("{err}");
                        }
                    }
                })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tack 启动失败");
}
