#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

/// 锚点窗收到的种子：选中原文 + 父会话脉络。
#[derive(Clone, Serialize, Deserialize, Default)]
struct AnchorSeed {
    selected: String,
    title: String,
    parent: String,
    prev: String,
    next: String,
}

/// 钉住的一颗钉子，钉回主窗。
#[derive(Clone, Serialize, Deserialize)]
struct Pin {
    title: String,
    line: String,
    at: String,
}

#[derive(Default)]
struct AppState {
    seed: Mutex<AnchorSeed>,
    pins: Mutex<Vec<Pin>>,
}

#[tauri::command]
fn anchor_seed(state: tauri::State<'_, AppState>) -> AnchorSeed {
    state.seed.lock().unwrap().clone()
}

#[tauri::command]
fn open_anchor(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    selected: String,
    title: String,
    parent: String,
    prev: String,
    next: String,
) -> Result<(), String> {
    *state.seed.lock().unwrap() = AnchorSeed {
        selected,
        title,
        parent,
        prev,
        next,
    };

    let anchor = app.get_webview_window("anchor").ok_or("anchor window missing")?;

    // 贴在主窗右侧，留 16px 间隙、向下让 96px。
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(pos) = main.outer_position() {
            let scale = main.scale_factor().unwrap_or(1.0);
            let _ = anchor.set_position(PhysicalPosition::new(
                pos.x + (456.0 * scale) as i32,
                pos.y + (96.0 * scale) as i32,
            ));
        }
    }

    anchor.show().map_err(|e| e.to_string())?;
    anchor.emit("anchor:refresh", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pin_anchor(app: AppHandle, state: tauri::State<'_, AppState>, card: Pin) -> Result<(), String> {
    state.pins.lock().unwrap().push(card.clone());
    app.emit_to("main", "main:pinned", card)
        .map_err(|e| e.to_string())?;
    if let Some(anchor) = app.get_webview_window("anchor") {
        let _ = anchor.hide();
    }
    Ok(())
}

#[tauri::command]
fn close_anchor(app: AppHandle) -> Result<(), String> {
    if let Some(anchor) = app.get_webview_window("anchor") {
        anchor.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 主窗把"今日待复习数"推给 HUD；HUD 只读，不主动查库。
#[tauri::command]
fn notify_hud(app: AppHandle, due: u32, mode: Option<String>) -> Result<(), String> {
    app.emit_to("hud", "hud:due", due)
        .map_err(|e| e.to_string())?;
    if let Some(m) = mode {
        app.emit_to("hud", "hud:mode", m).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// HUD 单击：主窗可见就收起（连同锚点窗），否则唤出。
#[tauri::command]
pub fn toggle_main(app: AppHandle) -> Result<bool, String> {
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let visible = main.is_visible().unwrap_or(false);
    if visible {
        let _ = main.hide();
        if let Some(anchor) = app.get_webview_window("anchor") {
            let _ = anchor.hide();
        }
    } else {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(!visible)
}

/// HUD 右键：回到右下角。
#[tauri::command]
fn reset_hud(app: AppHandle) -> Result<(), String> {
    place_hud(&app);
    Ok(())
}

/// HUD 右键：钉住/取消钉在屏幕最上层。
#[tauri::command]
fn set_hud_always_on_top(app: AppHandle, on_top: bool) -> Result<(), String> {
    let hud = app.get_webview_window("hud").ok_or("hud window missing")?;
    hud.set_always_on_top(on_top).map_err(|e| e.to_string())
}

/// HUD 右键：退出。
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 把 HUD 放到主显示器右下角，距边 20px。
fn place_hud(app: &AppHandle) {
    let Some(hud) = app.get_webview_window("hud") else {
        return;
    };
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let Ok(size) = hud.outer_size() else {
        return;
    };
    let scale = monitor.scale_factor();
    let margin = (20.0 * scale).round() as i32;
    let pos = monitor.position();
    let msize = monitor.size();
    let x = pos.x + msize.width as i32 - size.width as i32 - margin;
    let y = pos.y + msize.height as i32 - size.height as i32 - margin;
    let _ = hud.set_position(PhysicalPosition::new(x, y));
}

/// 主窗移动时锚点窗跟随；关闭主窗改为隐藏；拖入文件转发给前端。
fn wire_windows(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    main.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(pos) => {
            if let Some(anchor) = handle.get_webview_window("anchor") {
                if anchor.is_visible().unwrap_or(false) {
                    let scale = handle
                        .get_webview_window("main")
                        .and_then(|w| w.scale_factor().ok())
                        .unwrap_or(1.0);
                    let _ = anchor.set_position(PhysicalPosition::new(
                        pos.x + (456.0 * scale) as i32,
                        pos.y + (96.0 * scale) as i32,
                    ));
                }
            }
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.hide();
            }
            if let Some(a) = handle.get_webview_window("anchor") {
                let _ = a.hide();
            }
        }
        tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
            let files: Vec<String> = paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = handle.emit_to("main", "main:dropped", files);
        }
        _ => {}
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let open = MenuItem::with_id(app, "open", "打开 tack", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut builder = TrayIconBuilder::new();
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    } else {
        builder = builder.icon(pin_icon());
    }

    builder
        .tooltip("tack · 知识钉板")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// 打包前若图标尚未生成，托盘也有一个程序绘制的钉头回落。
fn pin_icon() -> tauri::image::Image<'static> {
    const W: u32 = 32;
    const H: u32 = 32;
    let mut rgba = vec![0u8; (W * H * 4) as usize];
    let paper = [243u8, 240, 232, 255];
    let pin = [181u8, 67, 42, 255];
    let deep = [140u8, 51, 32, 255];
    for y in 0..H {
        for x in 0..W {
            let i = ((y * W + x) * 4) as usize;
            let dx = x as f32 - 16.0;
            let dy = y as f32 - 12.5;
            let d = (dx * dx + dy * dy).sqrt();
            let px = if d <= 8.6 {
                pin
            } else if (x == 15 || x == 16) && (22..=29).contains(&y) {
                deep
            } else {
                paper
            };
            rgba[i..i + 4].copy_from_slice(&px);
        }
    }
    tauri::image::Image::new_owned(rgba, W, H)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            anchor_seed,
            open_anchor,
            pin_anchor,
            close_anchor,
            toggle_main,
            notify_hud,
            reset_hud,
            set_hud_always_on_top,
            quit_app
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            place_hud(&handle);
            wire_windows(&handle);
            build_tray(&handle)?;

            // 全局热键：Ctrl+Shift+T 随时唤出/收起主窗。
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let hotkey_app = handle.clone();
                if let Err(err) = app.global_shortcut().on_shortcut(
                    "ctrl+shift+t",
                    move |_app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = toggle_main(hotkey_app.clone());
                        }
                    },
                ) {
                    eprintln!("[tack] 全局热键注册失败：{err}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tack");
}
