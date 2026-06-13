// src/bridge/badge.rs
// Badge support is enabled only on macOS to avoid cross‑platform issues.
// On Windows/Linux these commands are no‑ops.

use tauri::AppHandle;

// -------- macOS implementation --------
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn dtr_badge_set(_app: AppHandle, count: Option<u32>) -> Result<(), String> {
    set_badge_macos(count)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn dtr_badge_clear(app: AppHandle) -> Result<(), String> {
    dtr_badge_set(app, None)
}

#[cfg(target_os = "macos")]
fn set_badge_macos(count: Option<u32>) -> Result<(), String> {
    // Safety: Interacting with Cocoa APIs requires unsafe
    unsafe {
        use objc::{msg_send, sel, sel_impl};
        use cocoa::appkit::NSApp;
        use cocoa::base::{id, nil};
        use cocoa::foundation::{NSString, NSAutoreleasePool};
        let _pool = NSAutoreleasePool::new(nil);

        let app: id = NSApp();
        let dock_tile: id = msg_send![app, dockTile];

        let label_str: id = match count {
            Some(0) | None => nil,
            Some(c) => NSString::alloc(nil).init_str(&format!("{}", c)),
        };

        // nil clears the badge.
        let _: () = msg_send![dock_tile, setBadgeLabel: label_str];
    }
    Ok(())
}

// -------- Non‑macOS stubs (no‑ops) --------
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn dtr_badge_set(_app: AppHandle, _count: Option<u32>) -> Result<(), String> {
    // No‑op on non‑macOS platforms to keep compatibility.
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn dtr_badge_clear(_app: AppHandle) -> Result<(), String> {
    // No‑op on non‑macOS platforms to keep compatibility.
    Ok(())
}