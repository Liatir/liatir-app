use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::bridge::diagnostics::mark_clean_shutdown_now;
use crate::helpers::states::CloseGuard;

fn resolve_webview_url(value: &str) -> Result<WebviewUrl, String> {
  if value.starts_with('/') && !value.starts_with("//") {
    let route = value.trim_start_matches('/');
    if route.split(['/', '?', '#']).any(|segment| segment == "..") {
      return Err("Window route traversal is not allowed".to_string());
    }
    return Ok(WebviewUrl::App(route.into()));
  }
  Ok(WebviewUrl::External(
    value.parse::<Url>().map_err(|error| error.to_string())?
  ))
}

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
pub fn lia_win_minimize(app: AppHandle, label: String) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(&label) {
    window.minimize().map_err(|e| e.to_string())
  } else {
      Err(format!("Window '{}' not found", label))
  }
}

#[tauri::command]
pub fn lia_win_maximize(app: AppHandle, label: String) -> Result<(), String> {
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
pub fn lia_win_fullscreen(app: AppHandle, label: String, enable: bool) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(&label) {
    window.set_fullscreen(enable).map_err(|e| e.to_string())
  } else {
      Err(format!("Window '{}' not found", label))
  }
}

#[tauri::command]
pub async fn lia_win_open(
  app: AppHandle,
  label: String,
  fullscreen: bool,
  url: String,
  width: Option<f64>,
  height: Option<f64>,
) -> Result<(), String> {
  if app.get_webview_window(&label).is_some() {
    return Ok(());
  }
  let webview_url = if url.is_empty() {
    WebviewUrl::App("/".into())
  } else {
    resolve_webview_url(&url)?
  };
  let width = width.unwrap_or_else(|| {
    env!("MAIN_WINDOW_WIDTH").parse::<f64>().unwrap_or(1200.0)
  });
  let height = height.unwrap_or_else(|| {
    env!("MAIN_WINDOW_HEIGHT").parse::<f64>().unwrap_or(800.0)
  });
  if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
    return Err("Window dimensions must be finite positive numbers".to_string());
  }

  // The main window is created programmatically, so there is no window config
  // to clone from tauri.conf.json. Build secondary app windows the same way.
  let _webview_window = WebviewWindowBuilder::new(&app, &label, webview_url)
    .title(env!("MAIN_WINDOW_TITLE"))
    .visible(true)
    .fullscreen(fullscreen)
    .inner_size(width, height)
    .resizable(env!("MAIN_WINDOW_RESIZABLE").parse::<bool>().unwrap_or(true))
    .initialization_script(crate::OPEN_EXTERNAL_SCRIPT)
    .build()
    .map_err(|e| format!("Failed to create window: {e}"))?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::resolve_webview_url;
  use tauri::WebviewUrl;

  #[test]
  fn resolves_internal_window_routes_as_app_urls() {
    match resolve_webview_url("/quenta?intent=report&run=result-1&window=1").unwrap() {
      WebviewUrl::App(path) => {
        assert_eq!(path.to_string_lossy(), "quenta?intent=report&run=result-1&window=1");
      }
      _ => panic!("Quenta route must stay inside the app"),
    }
    assert!(resolve_webview_url("/../settings").is_err());
  }
}

#[tauri::command]
pub fn lia_win_close(app: AppHandle, label: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&label) { w.close().map_err(|e| e.to_string())?; }
  Ok(())
}

#[tauri::command]
pub fn lia_win_continue_close(app: AppHandle, label: String) -> Result<(), String> {
  let guard = app.state::<CloseGuard>();
  guard.pending.store(false, Ordering::SeqCst);
  guard.closing.store(true, Ordering::SeqCst);

  mark_clean_shutdown_now(&app);

  if let Some(w) = app.get_webview_window(&label) {
    w.close().map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn lia_win_cancel_close(app: AppHandle) -> Result<(), String> {
  let guard = app.state::<CloseGuard>();
  guard.pending.store(false, Ordering::SeqCst);
  guard.closing.store(false, Ordering::SeqCst);
  Ok(())
}

#[tauri::command]
pub fn lia_win_get_info(window: WebviewWindow, label: Option<String>) -> Result<WindowInfo, String> {
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
