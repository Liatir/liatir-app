use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WebviewWindow};
use url::Url;

#[derive(Serialize)]
pub struct WindowSizeInfo {
  pub width: u32,
  pub height: u32,
}

#[derive(Serialize)]
pub struct WindowPositionInfo {
  pub x: i32,
  pub y: i32,
}

#[derive(Serialize)]
pub struct WindowInfo {
  pub label: String,
  pub title: Option<String>,
  pub url: Option<String>,
  pub visible: Option<bool>,
  pub focused: Option<bool>,
  pub minimized: Option<bool>,
  pub maximized: Option<bool>,
  pub fullscreen: Option<bool>,
  pub decorated: Option<bool>,
  pub resizable: Option<bool>,
  pub enabled: Option<bool>,
  pub always_on_top: Option<bool>,
  pub inner_size: Option<WindowSizeInfo>,
  pub outer_size: Option<WindowSizeInfo>,
  pub inner_position: Option<WindowPositionInfo>,
  pub outer_position: Option<WindowPositionInfo>,
  pub scale_factor: Option<f64>,
}

#[tauri::command]
pub fn dtr_win_minimize(app: AppHandle, label: String) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(&label) {
    window.minimize().map_err(|e| e.to_string())
  } else {
      Err(format!("Window '{}' not found", label))
  }
}

#[tauri::command]
pub fn dtr_win_maximize(app: AppHandle, label: String) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(&label) {
    if window.is_maximized().unwrap_or(false) {
      window.unmaximize().map_err(|e| e.to_string())
    } else {
      window.maximize().map_err(|e| e.to_string())
    }
  } else {
      Err(format!("Window '{}' not found", label))
  }
}

#[tauri::command]
pub fn dtr_win_fullscreen(app: AppHandle, label: String, enable: bool) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(&label) {
    window.set_fullscreen(enable).map_err(|e| e.to_string())
  } else {
      Err(format!("Window '{}' not found", label))
  }
}

#[tauri::command]
pub async fn dtr_win_open(
  app: AppHandle,
  label: String,
  fullscreen: bool,
  url: String,
) -> Result<(), String> {
  if app.get_webview_window(&label).is_some() {
    return Ok(());
  }
  let s = url.to_string();

  let mut conf = app.config().app.windows.iter()
    .find(|c| c.label == "main")
    .ok_or_else(|| "main window config not found".to_string())?
    .clone();
  // This should be a unique label for all windows.
  let mut buf = [0u8; 1];
  assert_eq!(getrandom::fill(&mut buf), Ok(()));
  conf.label = label;
  conf.visible = true;
  conf.fullscreen = fullscreen;
  if !s.is_empty(){
    let webview_url = WebviewUrl::External(
        s.parse::<Url>().map_err(|e| e.to_string())?
    );
    conf.url = webview_url;
  }
  let _webview_window = tauri::WebviewWindowBuilder::from_config(&app, &conf)
    .map_err(|e| format!("Failed to build window config: {e}"))?
    .build()
    .map_err(|e| format!("Failed to create window: {e}"))?;

  Ok(())
}

#[tauri::command]
pub fn dtr_win_close(app: AppHandle, label: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&label) { w.close().map_err(|e| e.to_string())?; }
  Ok(())
}

#[tauri::command]
pub fn dtr_win_get_info(window: WebviewWindow, label: Option<String>) -> Result<WindowInfo, String> {
  let app = window.app_handle();

  // Decide which window to inspect:
  // - If a label is provided, try to resolve that window.
  // - Otherwise, use the current window that invoked the command.
  let target = if let Some(ref lbl) = label {
    app.get_webview_window(lbl)
  } else {
    Some(window)
  };

  if let Some(win) = target {
    // Basic metadata
    let label_str = win.label().to_string();
    let title = win.title().ok();
    let url = win.url().ok().map(|u| u.to_string());

    // Visibility and state
    let visible = win.is_visible().ok();
    let focused = win.is_focused().ok();
    let minimized = win.is_minimized().ok();
    let maximized = win.is_maximized().ok();
    let fullscreen = win.is_fullscreen().ok();
    let decorated = win.is_decorated().ok();
    let resizable = win.is_resizable().ok();
    let enabled = win.is_enabled().ok();
    let always_on_top = win.is_always_on_top().ok();

    // Geometry
    let inner_size = win.inner_size().ok().map(|s| WindowSizeInfo {
      width: s.width,
      height: s.height,
    });
    let outer_size = win.outer_size().ok().map(|s| WindowSizeInfo {
      width: s.width,
      height: s.height,
    });
    let inner_position = win.inner_position().ok().map(|p| WindowPositionInfo {
      x: p.x,
      y: p.y,
    });
    let outer_position = win.outer_position().ok().map(|p| WindowPositionInfo {
      x: p.x,
      y: p.y,
    });

    let scale_factor = win.scale_factor().ok();

    Ok(WindowInfo {
      label: label_str,
      title,
      url,
      visible,
      focused,
      minimized,
      maximized,
      fullscreen,
      decorated,
      resizable,
      enabled,
      always_on_top,
      inner_size,
      outer_size,
      inner_position,
      outer_position,
      scale_factor,
    })
  } else {
    let requested = label.unwrap_or_else(|| "<current>".to_string());
    Err(format!("Window '{}' not found", requested))
  }
}