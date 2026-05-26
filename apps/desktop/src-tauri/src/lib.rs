use std::thread;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewWindow, WindowEvent,
};

#[cfg(target_os = "macos")]
fn round_window_corners(window: &WebviewWindow, radius: f64) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let ns_window_ptr = match window.ns_window() {
        Ok(p) => p as *mut AnyObject,
        Err(_) => return,
    };
    if ns_window_ptr.is_null() {
        return;
    }
    unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window_ptr, contentView];
        if content_view.is_null() {
            return;
        }
        // Force the content view to be layer-backed first.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}

#[cfg(not(target_os = "macos"))]
fn round_window_corners(_window: &WebviewWindow, _radius: f64) {}

const TRAY_ID: &str = "timebill-tray";

/// JS-callable: update the menu-bar text shown next to the tray icon.
/// While a timer is running, the JS layer pushes "5m" / "1h 28m" labels here
/// and we *hide* the icon so the text doesn't crowd the menu bar. When the
/// title clears, we restore the icon. Smaller font is achieved by wrapping
/// the title in an NSAttributedString (a future polish; the default macOS
/// status item font is already compact).
#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(t) => t,
        None => return,
    };
    let trimmed = title.trim();
    if trimmed.is_empty() {
        // Restore icon, clear text.
        let _ = tray.set_title(None::<&str>);
        if let Some(icon) = app.default_window_icon() {
            let _ = tray.set_icon(Some(icon.clone()));
        }
    } else {
        let _ = tray.set_title(Some(trimmed));
        // Hide the icon while running so the time gets full real estate.
        let _ = tray.set_icon(None);
    }
}
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use user_idle::UserIdle;

/// Reposition the menubar window so its top edge sits just under the tray
/// icon, horizontally centered on it. Falls back to a no-op if anything in
/// the math goes sideways.
fn anchor_to_tray(window: &WebviewWindow, tray_rect: &Rect) {
    let win_size = match window.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    // `tray_rect` carries Logical or Physical variants depending on platform;
    // normalize via the `.to_physical()` accessors so we always work in pixels.
    let pos = tray_rect.position.to_physical::<f64>(scale);
    let size = tray_rect.size.to_physical::<f64>(scale);
    let x = pos.x + (size.width / 2.0) - (win_size.width as f64 / 2.0);
    // Tiny gap so it floats just below the tray icon rather than overlapping.
    let y = pos.y + size.height + 4.0;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_menubar_at(window: &WebviewWindow, tray_rect: &Rect) {
    anchor_to_tray(window, tray_rect);
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_menubar_at(window: &WebviewWindow, tray_rect: &Rect) {
    if let Ok(true) = window.is_visible() {
        let _ = window.hide();
    } else {
        show_menubar_at(window, tray_rect);
    }
}

/// Keyboard-triggered toggle — we don't know the tray rect, so just show
/// wherever it last sat. (User can re-click the tray icon to re-anchor.)
fn toggle_menubar_in_place(window: &WebviewWindow) {
    if let Ok(true) = window.is_visible() {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Idle threshold: emit `idle-detected` after the user has been inactive
/// at least this many seconds. Mirrors the Toggl / Timing default.
const IDLE_THRESHOLD_SECS: u64 = 300; // 5 minutes
const IDLE_POLL_SECS: u64 = 30;

/// Spawn a background thread that polls the OS for "seconds since last input"
/// and emits a `idle-detected` Tauri event each time the user crosses the
/// threshold. The renderer decides what to do (typically: if a timer is
/// running, show a "you were idle — keep / discard / stop at idle start"
/// modal).
fn spawn_idle_watcher(app: AppHandle) {
    thread::spawn(move || {
        // Tracks the idle-seconds value of the most recently emitted event,
        // so we don't re-emit on every poll while the user stays idle. Reset
        // when they come back (idle < 60s).
        let mut last_emitted: u64 = 0;
        loop {
            thread::sleep(Duration::from_secs(IDLE_POLL_SECS));
            match UserIdle::get_time() {
                Ok(idle) => {
                    let secs = idle.as_seconds();
                    if secs < 60 {
                        last_emitted = 0;
                        continue;
                    }
                    if secs >= IDLE_THRESHOLD_SECS && secs > last_emitted {
                        let _ = app.emit("idle-detected", secs);
                        last_emitted = secs;
                    }
                }
                Err(_) => {
                    // Idle query failed (likely permission or platform issue);
                    // back off until next tick.
                }
            }
        }
    });
}

pub fn run() {
    // Cmd+Opt+T — for now this just toggles the menu bar window.
    // Once the Tauri <-> Svelte bridge lands we'll emit a "timer-toggle"
    // event here so the renderer can start/stop the most recent timer.
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
            // Menubar popover should dismiss when the user clicks elsewhere
            // (standard macOS menu-bar app behavior).
            if window.label() == "menubar" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            // Register global shortcut.
            app.global_shortcut().register(toggle_shortcut)?;

            // Kick off the idle watcher (emits `idle-detected` events).
            spawn_idle_watcher(app.handle().clone());

            // Round the menubar window's NSWindow itself (not just the inner
            // div) so the OS-level shape matches the visual card.
            if let Some(w) = app.get_webview_window("menubar") {
                round_window_corners(&w, 14.0);
            }

            // Build tray menu (right-click).
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
        .invoke_handler(tauri::generate_handler![set_tray_title])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
