use std::thread;
use std::time::Duration;

use tauri::{
    image::Image,
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
        // Force the window content view layer to be the visible shape.
        let _: () = msg_send![ns_window_ptr, setOpaque: false];
        let _: () = msg_send![ns_window_ptr, setHasShadow: true];

        let content_view: *mut AnyObject = msg_send![ns_window_ptr, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: true];

        // Tell macOS to recompute the drop shadow against the new shape.
        let _: () = msg_send![ns_window_ptr, invalidateShadow];
    }
}

#[cfg(target_os = "macos")]
fn refresh_window_shadow(window: &WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    if let Ok(p) = window.ns_window() {
        let ns_window_ptr = p as *mut AnyObject;
        if !ns_window_ptr.is_null() {
            unsafe {
                let _: () = msg_send![ns_window_ptr, invalidateShadow];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn round_window_corners(_window: &WebviewWindow, _radius: f64) {}

#[cfg(not(target_os = "macos"))]
fn refresh_window_shadow(_window: &WebviewWindow) {}

const TRAY_ID: &str = "timebill-tray";

/// Generate a small solid red dot RGBA bitmap to use as the tray icon while
/// a timer is running — visually similar to the macOS camera / mic
/// "active" indicator. ~Half the diameter of an emoji dot.
///
/// Canvas is 22×22 (the standard macOS menu-bar icon point size); the dot
/// itself is ~9px, centered, with a 1-pixel antialiased edge. Color is
/// Apple `systemRed` (#FF3B30). We render this dot with
/// `icon_as_template(false)` so macOS leaves the color alone (template
/// icons get tinted with the menu-bar foreground).
fn make_recording_dot_icon() -> Image<'static> {
    const SIZE: u32 = 22;
    const DOT_DIAMETER: f32 = 9.0;
    const COLOR: [u8; 3] = [255, 59, 48]; // Apple systemRed
    let center = SIZE as f32 / 2.0 - 0.5;
    let r = DOT_DIAMETER / 2.0;
    let mut buf = vec![0u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha: u8 = if dist <= r - 0.5 {
                255
            } else if dist <= r + 0.5 {
                ((r + 0.5 - dist) * 255.0).clamp(0.0, 255.0) as u8
            } else {
                0
            };
            if alpha > 0 {
                let i = ((y * SIZE + x) * 4) as usize;
                buf[i] = COLOR[0];
                buf[i + 1] = COLOR[1];
                buf[i + 2] = COLOR[2];
                buf[i + 3] = alpha;
            }
        }
    }
    Image::new_owned(buf, SIZE, SIZE)
}

/// JS-callable: update the menu-bar text shown next to the tray icon.
/// While a timer is running, the JS layer pushes "5m" / "1h 28m" labels and
/// we swap the tray icon for a small red dot (`make_recording_dot_icon`),
/// so the menu bar shows `[•] 5m` — a glanceable "recording" cue without
/// hiding the elapsed time. When the title clears we restore the default
/// (template-tinted) icon.
#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(t) => t,
        None => return,
    };
    let trimmed = title.trim();
    if trimmed.is_empty() {
        let _ = tray.set_title(None::<&str>);
        let _ = tray.set_icon_as_template(true);
        if let Some(icon) = app.default_window_icon() {
            let _ = tray.set_icon(Some(icon.clone()));
        }
    } else {
        let _ = tray.set_title(Some(trimmed));
        // Recording dot stays its own color; don't let macOS tint it.
        let _ = tray.set_icon_as_template(false);
        let _ = tray.set_icon(Some(make_recording_dot_icon()));
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
    // Position changed → re-mask the shadow to fit the rounded shape.
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
