use tauri::AppHandle;
use tauri_plugin_notification::{NotificationExt, PermissionState};
use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};

static NOTIF_ID: AtomicI32 = AtomicI32::new(1);

#[tauri::command]
pub fn dtr_notification_state(app: AppHandle) -> Result<String, String> {
  let s = app.notification().permission_state().map_err(|e| e.to_string())?;
  Ok(s.to_string())
}

#[tauri::command]
pub fn dtr_request_permission(app: AppHandle) -> Result<String, String> {
  let r = app.notification().request_permission().map_err(|e| e.to_string())?;
  Ok(r.to_string())
}

#[derive(Serialize)]
pub struct NotifyResult { pub shown: bool, pub state_before: String, pub state_after: String }

#[tauri::command]
pub fn dtr_notify(app: AppHandle, title: String, body: String) -> Result<NotifyResult, String> {
  let before = app.notification().permission_state().map_err(|e| e.to_string())?;
  let mut after = before.clone();

  if before != PermissionState::Granted {
    after = app.notification().request_permission().map_err(|e| e.to_string())?;
    if after != PermissionState::Granted {
      return Ok(NotifyResult { shown: false, state_before: before.to_string(), state_after: after.to_string() });
    }
  }

  let id = NOTIF_ID.fetch_add(1, Ordering::Relaxed);
  app.notification().builder().id(id).title(title).body(body).show().map_err(|e| e.to_string())?;
  Ok(NotifyResult { shown: true, state_before: before.to_string(), state_after: after.to_string() })
}
