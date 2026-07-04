// macOS-specific window utilities: rounded corners and shadow management.

use tauri::WebviewWindow;

/// Round the NSWindow itself (not just the inner webview) so the macOS
/// window shadow follows the rounded shape instead of rendering square
/// corners behind the transparent popover.
///
/// The key step is `setBackgroundColor: clearColor` — without it the
/// window's default background fills the transparent corners with white
/// (or the system window color), which is what creates the "small square
/// spots" visible through the rounded CSS card.
#[cfg(target_os = "macos")]
pub fn round_window_corners(window: &WebviewWindow, radius: f64) {
    use objc2::class;
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
        // The window itself must be non-opaque so the transparent areas
        // show the desktop behind it.
        let _: () = msg_send![ns_window_ptr, setOpaque: false];

        // Clear background — THIS is the fix for square white corners.
        // Without this the window fills its rect with the default
        // background color, which shows through the webview's transparent
        // corners as white squares.
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window_ptr, setBackgroundColor: clear];

        // macOS will then draw a drop-shadow that follows the layer's
        // rounded shape (as long as we invalidate it after setup).
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

        // Recompute the drop-shadow to match the new rounded shape.
        let _: () = msg_send![ns_window_ptr, invalidateShadow];
    }
}

/// Recompute the window shadow after a position change — positioning the
/// window changes its screen context and can cause the shadow to render
/// incorrectly until invalidated.
#[cfg(target_os = "macos")]
pub fn refresh_window_shadow(window: &WebviewWindow) {
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
pub fn round_window_corners(_window: &WebviewWindow, _radius: f64) {}

#[cfg(not(target_os = "macos"))]
pub fn refresh_window_shadow(_window: &WebviewWindow) {}
