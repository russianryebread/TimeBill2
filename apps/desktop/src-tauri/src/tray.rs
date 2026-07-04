// Tray icon, tray title, and the native tick thread that keeps the macOS
// menu-bar title accurate even when webview timers are throttled.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{
    image::Image, AppHandle,
};

pub const TRAY_ID: &str = "timebill-tray";

// ---- Timer state shared between the tick thread and the JS layer ----

/// State the frontend pushes so the Rust tick thread can update the tray
/// title independently of webview throttling.
#[derive(Debug, Clone, Default)]
pub struct TimerTickState {
    /// `Date.now()` of the running timer's `started_at`, or `None` if idle.
    pub running_started_ms: Option<i64>,
    /// Sum of completed (non-running) entries for the running project today,
    /// in milliseconds.
    pub daily_base_ms: i64,
}

/// Compact "menu-bar friendly" label: "Xh Ym" or "Ym". Mirrors the JS
/// `compactElapsed` in `timer.svelte.ts`.
fn compact_elapsed(ms: i64) -> String {
    let total_minutes = (ms.max(0) / 60_000) as i64;
    let h = total_minutes / 60;
    let m = total_minutes % 60;
    if h > 0 {
        format!("{}h {}m", h, m)
    } else {
        format!("{}m", m)
    }
}

// ---- Red recording-dot icon ----

/// Generate a small solid red dot RGBA bitmap to use as the tray icon while
/// a timer is running — visually similar to the macOS camera / mic
/// "active" indicator. ~Half the diameter of an emoji dot.
///
/// Canvas is 22×22 (the standard macOS menu-bar icon point size); the dot
/// itself is ~9px, centered, with a 1-pixel antialiased edge. Color is
/// Apple `systemRed` (#FF3B30). We render this dot with
/// `icon_as_template(false)` so macOS leaves the color alone (template
/// icons get tinted with the menu-bar foreground).
pub fn make_recording_dot_icon() -> Image<'static> {
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

// ---- Tauri commands ----

/// JS-callable: push the running timer state so the Rust tick thread can
/// compute the correct tray title even when webviews are throttled.
#[tauri::command]
pub fn push_timer_state(
    state: tauri::State<'_, Arc<Mutex<TimerTickState>>>,
    running_started_ms: Option<i64>,
    daily_base_ms: Option<i64>,
) {
    let mut s = state.lock().unwrap();
    s.running_started_ms = running_started_ms;
    s.daily_base_ms = daily_base_ms.unwrap_or(0);
}

/// JS-callable: update the menu-bar text shown next to the tray icon.
/// (Legacy command — the tick thread now drives tray title updates, but
/// this is kept for backward compatibility.)
#[tauri::command]
pub fn set_tray_title(app: AppHandle, title: String) {
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
        let _ = tray.set_icon_as_template(false);
        let _ = tray.set_icon(Some(make_recording_dot_icon()));
    }
}

// ---- Native tick thread ----

/// Spawn a background thread that ticks every second and updates the tray
/// title using the state pushed by the frontend. Immune to webview timer
/// throttling because it runs in a native OS thread.
pub fn spawn_tray_tick(app: AppHandle, state: Arc<Mutex<TimerTickState>>) {
    thread::spawn(move || {
        let mut last_title = String::new();
        loop {
            thread::sleep(Duration::from_secs(1));
            let (started, base) = {
                let s = state.lock().unwrap();
                (s.running_started_ms, s.daily_base_ms)
            };
            let title = if let Some(started_ms) = started {
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                let elapsed = (now_ms - started_ms).max(0);
                compact_elapsed(base + elapsed)
            } else {
                String::new()
            };
            if title == last_title {
                continue;
            }
            last_title = title.clone();

            let tray = match app.tray_by_id(TRAY_ID) {
                Some(t) => t,
                None => continue,
            };
            if title.is_empty() {
                let _ = tray.set_title(None::<&str>);
                let _ = tray.set_icon_as_template(true);
                if let Some(icon) = app.default_window_icon() {
                    let _ = tray.set_icon(Some(icon.clone()));
                }
            } else {
                let _ = tray.set_title(Some(title.as_str()));
                let _ = tray.set_icon_as_template(false);
                let _ = tray.set_icon(Some(make_recording_dot_icon()));
            }
        }
    });
}
