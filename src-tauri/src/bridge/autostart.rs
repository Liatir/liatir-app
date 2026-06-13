// All comments are in English.

use serde::{Deserialize, Serialize};
use tauri::{App, AppHandle, Manager};
use serde_json::{json, Value};
use tokio::time::sleep;
use std::time::Duration;

use crate::bridge::fs::{dtr_fs_read_text, dtr_fs_write_text};
use crate::bridge::events::{dtr_event_emit};

// ✅ Correct trait for v2 to access autostart manager via `app.autolaunch()`
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum AutostartMode {
  Shown,
  Minimized,
  Hidden,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AutostartSettings {
  autostart_mode: AutostartMode,
}

/// Persisted under the `data/` scope using your fs.rs helpers.
const SETTINGS_REL_PATH: &str = "settings/autostart.json";

fn load_settings(app: &AppHandle) -> AutostartSettings {
  match dtr_fs_read_text(app.clone(), SETTINGS_REL_PATH.to_string(), Some(true), None, None) {
    Ok(text) => serde_json::from_str::<AutostartSettings>(&text)
      .unwrap_or(AutostartSettings { autostart_mode: AutostartMode::Shown }),
    Err(_) => AutostartSettings { autostart_mode: AutostartMode::Shown },
  }
}

fn save_settings(app: &AppHandle, s: &AutostartSettings) -> Result<(), String> {
  let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
  // create_dirs = true, append = false
  dtr_fs_write_text(
    app.clone(),
    SETTINGS_REL_PATH.to_string(),
    Some(true),
    json,
    Some(true),
    Some(false),
    None,
    None
  )
}

/// Apply how the main window should appear when launched by the OS.
fn apply_autostart_window_behavior(app: &AppHandle, mode: AutostartMode) {
  // ✅ v2 uses `get_webview_window`
  let app_handle = app.clone();
  if let Some(win) = app.get_webview_window("main") {
    match mode {
      AutostartMode::Shown => {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
      }
      AutostartMode::Minimized => {
        // Ensure hidden first, then show+minimize on the next ticks to avoid flashing.
        let _ = win.hide();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
          use std::time::Duration;
          sleep(Duration::from_millis(120)).await;
          if let Some(w) = app2.get_webview_window("main") {
            let _ = w.show();
            let _ = w.minimize();
          }
          // Re-apply once more in case something else showed the window late.
          sleep(Duration::from_millis(300)).await;
          if let Some(w) = app2.get_webview_window("main") {
            let _ = w.minimize();
          }
        });
      }
      AutostartMode::Hidden => {
        // Keep running (e.g., with tray) without showing the main window.
        let _ = win.hide();
      }
    }
  }
}

/// Register the plugin with a constant CLI flag used to detect OS autostart.
pub fn init_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
  tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    Some(vec!["--autostart".into()]), // any flags you want at OS launch
  )
}

pub fn run_from_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let launched_by_os = std::env::args().any(|a| a == "--autostart");
  if launched_by_os {
    eprintln!("[autostart] Detected --autostart, applying mode…");
    if let Some(win) = app.get_webview_window("main") {
      // Ensure the window is not visible before applying mode-specific behavior,
      // to prevent any flashing at startup.
      let _ = win.hide();
    }
    let s = load_settings(&app.handle());
    apply_autostart_window_behavior(&app.handle(), s.autostart_mode);
  } else {
    // In dev / manual start the window may not exist yet at setup() time.
    // Retry for a short period and then show/focus it once available.
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      for _ in 0..40 { // ~2s total at 50ms interval
        if let Some(win) = handle.get_webview_window("main") {
          let _ = win.show();
          let _ = win.unminimize();
          let _ = win.set_focus();
          return;
        }
        sleep(std::time::Duration::from_millis(50)).await;
      }
      // Optional: emit a diagnostics event if the window never appeared.
      let _ = dtr_event_emit(handle, "autostart".to_string(), Some(serde_json::json!({
        "mode": "manual",
        "note": "main window not found within retry window"
      })));
    });
  }
  Ok(())
}

// ---------- Commands (Rust only; your TS bridge uses `invoke`) ----------

#[tauri::command]
pub fn dtr_autostart_enable(app: AppHandle) -> Result<(), String> {
  // ✅ v2: use the autostart manager from the extension trait
  app.autolaunch().enable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_autostart_disable(app: AppHandle) -> Result<(), String> {
  app.autolaunch().disable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_autostart_status(app: AppHandle) -> Result<bool, String> {
  app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_get_autostart_mode(app: AppHandle) -> Result<String, String> {
  let s = load_settings(&app);
  Ok(match s.autostart_mode {
    AutostartMode::Shown => "shown",
    AutostartMode::Minimized => "minimized",
    AutostartMode::Hidden => "hidden",
  }.to_string())
}

#[tauri::command]
pub fn dtr_set_autostart_mode(app: AppHandle, mode: String) -> Result<(), String> {
  let mut s = load_settings(&app);
  s.autostart_mode = match mode.as_str() {
    "shown" => AutostartMode::Shown,
    "minimized" => AutostartMode::Minimized,
    "hidden" => AutostartMode::Hidden,
    _ => return Err("Invalid autostart mode".into()),
  };
  save_settings(&app, &s)
}