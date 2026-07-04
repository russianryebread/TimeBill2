// Idle detection: polls the OS for user inactivity and emits Tauri events
// so the renderer can surface an "idle — keep/discard time?" prompt.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Emit `idle-detected` after the user has been inactive at least this
/// many seconds. Mirrors the Toggl / Timing default.
const IDLE_THRESHOLD_SECS: u64 = 300; // 5 minutes
const IDLE_POLL_SECS: u64 = 30;

use user_idle::UserIdle;

/// Spawn a background thread that polls the OS for "seconds since last input"
/// and emits a `idle-detected` Tauri event each time the user crosses the
/// threshold. The renderer decides what to do (typically: if a timer is
/// running, show a "you were idle — keep / discard / stop at idle start"
/// modal).
pub fn spawn_idle_watcher(app: AppHandle) {
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
