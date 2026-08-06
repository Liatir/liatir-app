//! Saving a rectangle of the screen to a PNG, used to export scientific plots and viewers.
//!
//! The capture is done by the OS rather than in the webview, so what lands in the file is
//! exactly what the user sees — including WebGL/canvas content that an in-page DOM snapshot
//! would miss. Today only macOS has a native implementation.

use chrono::Utc;
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCaptureResult {
  pub path: String,
}

/// Screenshots land in a `Screenshots` folder inside the app's data scope, so they show up in
/// the Data sidebar like any other user file. Created on demand.
fn screenshot_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = crate::bridge::fs::lia_fs_safe_join_data(app, "Screenshots")?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

/// Turns a caller-supplied name into one that is safe to write to disk.
///
/// The name may come from a plugin or a chart title, so every character outside
/// `[A-Za-z0-9._-]` is replaced with `-` — that rules out path separators and traversal rather
/// than trying to detect them. A `.png` extension is enforced because that is what is written,
/// and a name that sanitises down to nothing falls back to a timestamp.
fn safe_filename(raw: Option<String>) -> String {
  let fallback = format!("visualization-{}.png", Utc::now().format("%Y%m%d-%H%M%S"));
  let name = raw.unwrap_or(fallback);
  let mut cleaned = name
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') { ch } else { '-' })
    .collect::<String>();
  if !cleaned.to_ascii_lowercase().ends_with(".png") {
    cleaned.push_str(".png");
  }
  // e.g. a name made entirely of illegal characters collapses to "---".
  if cleaned.trim_matches('-').is_empty() {
    format!("visualization-{}.png", Utc::now().format("%Y%m%d-%H%M%S"))
  } else {
    cleaned
  }
}

/// Shells out to the macOS `screencapture` tool: `-x` silences the shutter sound, `-R` takes
/// the region as `x,y,width,height` in physical screen pixels.
///
/// A failure here is most often a missing Screen Recording permission, which `screencapture`
/// reports with an empty stderr — hence the explicit hint when there is nothing to quote.
#[cfg(target_os = "macos")]
fn capture_screen_region(path: &PathBuf, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
  // Clamped so a region partly off-screen still yields a valid, non-empty rectangle.
  let region = format!("{},{},{},{}", x.max(0), y.max(0), width.max(1), height.max(1));
  let output = std::process::Command::new("screencapture")
    .arg("-x")
    .arg("-R")
    .arg(region)
    .arg(path)
    .output()
    .map_err(|e| format!("Failed to start screencapture: {e}"))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
      "macOS screen capture failed. Check Screen Recording permission for Liatir.".to_string()
    } else {
      stderr
    })
  }
}

/// Same signature on other platforms so the caller needs no `cfg`, but there is no native
/// capture backend yet, so it always fails with a message the UI can show as-is.
#[cfg(not(target_os = "macos"))]
fn capture_screen_region(_path: &PathBuf, _x: i32, _y: i32, _width: u32, _height: u32) -> Result<(), String> {
  Err("Native region screenshots are currently available on macOS only.".to_string())
}

/// Captures a region of the window and writes it as a PNG.
///
/// The coordinates arrive from the webview: logical (CSS) pixels, relative to the window's
/// top-left. `screencapture` works in physical pixels in global screen space, so the two-step
/// conversion below is the heart of this function — scale by the display's DPI factor, then
/// translate by the window's on-screen origin. Skipping either step silently captures the
/// wrong rectangle on a Retina display or on a window that is not at (0, 0).
#[tauri::command]
pub fn lia_visual_capture_region(
  app: AppHandle,
  window: WebviewWindow,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  filename: Option<String>,
) -> Result<VisualCaptureResult, String> {
  // Guards against NaN/Infinity too, which a JS caller can easily produce from a 0-sized
  // element and which would otherwise become a garbage `as u32` cast.
  if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
    return Err("Invalid capture region.".to_string());
  }

  // Assume 1.0 if the scale factor is unavailable: a non-Retina-sized capture is a better
  // outcome than refusing to capture at all.
  let scale = window.scale_factor().unwrap_or(1.0);
  // Prefer the content area's origin; fall back to the frame's if the webview cannot report it.
  let origin = window
    .inner_position()
    .or_else(|_| window.outer_position())
    .map_err(|e| format!("Could not resolve window position: {e}"))?;

  // Logical -> physical, then window-relative -> screen-absolute.
  let capture_x = origin.x + (x * scale).round() as i32;
  let capture_y = origin.y + (y * scale).round() as i32;
  let capture_width = (width * scale).round().max(1.0) as u32;
  let capture_height = (height * scale).round().max(1.0) as u32;

  let path = screenshot_dir(&app)?.join(safe_filename(filename));
  capture_screen_region(&path, capture_x, capture_y, capture_width, capture_height)?;

  Ok(VisualCaptureResult {
    path: path.to_string_lossy().into_owned(),
  })
}
