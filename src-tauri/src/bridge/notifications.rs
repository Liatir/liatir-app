//! OS notifications, used to tell the user a long-running job has finished while they are in
//! another app.

use tauri::AppHandle;
use tauri_plugin_notification::{NotificationExt, PermissionState};
use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};

/// Source of unique notification IDs. Distinct IDs stop the OS from coalescing one job's
/// notification over another's; atomic because notifications can be raised from any thread.
static NOTIF_ID: AtomicI32 = AtomicI32::new(1);

/// Current OS permission state, without prompting the user.
#[tauri::command]
pub fn lia_notification_state(app: AppHandle) -> Result<String, String> {
  let s = app.notification().permission_state().map_err(|e| e.to_string())?;
  Ok(s.to_string())
}

/// Explicitly asks the OS for notification permission (shows the system prompt).
#[tauri::command]
pub fn lia_request_permission(app: AppHandle) -> Result<String, String> {
  let r = app.notification().request_permission().map_err(|e| e.to_string())?;
  Ok(r.to_string())
}

/// Reports both whether the notification appeared and how the permission state moved, so the
/// caller can distinguish "the user just denied it" from "it was already denied".
#[derive(Serialize)]
pub struct NotifyResult { pub shown: bool, pub state_before: String, pub state_after: String }

/// Shows a notification, requesting permission first if it has not been granted yet.
///
/// A denied permission is not an error: the call returns `shown: false` and succeeds. Callers
/// are typically finishing a job, and that job did not fail merely because the user does not
/// want notifications.
#[tauri::command]
pub fn lia_notify(app: AppHandle, title: String, body: String) -> Result<NotifyResult, String> {
  let before = app.notification().permission_state().map_err(|e| e.to_string())?;
  let mut after = before.clone();

  if before != PermissionState::Granted {
    after = app.notification().request_permission().map_err(|e| e.to_string())?;
    if after != PermissionState::Granted {
      return Ok(NotifyResult { shown: false, state_before: before.to_string(), state_after: after.to_string() });
    }
  }

  // Relaxed is enough: the only requirement is that no two notifications get the same ID,
  // not that IDs are handed out in any particular order.
  let id = NOTIF_ID.fetch_add(1, Ordering::Relaxed);
  app.notification().builder().id(id).title(title).body(body).show().map_err(|e| e.to_string())?;
  Ok(NotifyResult { shown: true, state_before: before.to_string(), state_after: after.to_string() })
}
