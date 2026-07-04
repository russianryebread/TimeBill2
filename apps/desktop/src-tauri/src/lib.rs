mod macos;
mod tray;
mod idle;

use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, Rect, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::idle::spawn_idle_watcher;
use crate::macos::{refresh_window_shadow, round_window_corners};
use crate::tray::{spawn_tray_tick, TimerTickState, TRAY_ID};

// ---- Menubar window positioning ----

/// Reposition the menubar window so its top edge sits just under the tray
/// icon, horizontally centered on it.
fn anchor_to_tray(window: &WebviewWindow, tray_rect: &Rect) {
    let win_size = match window.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = tray_rect.position.to_physical::<f64>(scale);
    let size = tray_rect.size.to_physical::<f64>(scale);
    let x = pos.x + (size.width / 2.0) - (win_size.width as f64 / 2.0);
    let y = pos.y + size.height + 4.0; // tiny gap below tray icon
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_menubar_at(window: &WebviewWindow, tray_rect: &Rect) {
    anchor_to_tray(window, tray_rect);
    let _ = window.show();
    let _ = window.set_focus();
    refresh_window_shadow(window);
}

fn toggle_menubar_at(window: &WebviewWindow, tray_rect: &Rect) {
    if let Ok(true) = window.is_visible() {
        let _ = window.hide();
    } else {
        show_menubar_at(window, tray_rect);
    }
}

/// Keyboard-triggered toggle — we don't know the tray rect, so just show
/// wherever it last sat.
fn toggle_menubar_in_place(window: &WebviewWindow) {
    if let Ok(true) = window.is_visible() {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---- Simple app-level commands ----

/// JS-callable: quit the application.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ---- Entry point ----

pub fn run() {
    let toggle_shortcut = Shortcut::new(
        Some(Modifiers::SUPER | Modifiers::ALT),
        Code::KeyT,
    );

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle_shortcut
                        && event.state() == ShortcutState::Pressed
                    {
                        if let Some(window) = app.get_webview_window("menubar") {
                            toggle_menubar_in_place(&window);
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "menubar" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            // Global shortcut.
            app.global_shortcut().register(toggle_shortcut)?;

            // Managed tray-tick state — shared between the tick thread
            // and the JS push_timer_state command.
            let timer_state = Arc::new(Mutex::new(TimerTickState::default()));
            app.manage(timer_state.clone());

            // Native tray tick — immune to webview timer throttling.
            spawn_tray_tick(app.handle().clone(), timer_state);

            // Idle detection.
            spawn_idle_watcher(app.handle().clone());

            // Round the menubar NSWindow for a proper popover look.
            if let Some(w) = app.get_webview_window("menubar") {
                round_window_corners(&w, 14.0);
            }

            // Tray menu (right-click).
            let show_main =
                MenuItem::with_id(app, "show_main", "Open TimeBill", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&show_main, &quit])?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_main" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("menubar") {
                            toggle_menubar_at(&window, &rect);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray::push_timer_state,
            tray::set_tray_title,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
