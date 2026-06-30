use chrono::Utc;
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCaptureResult {
  pub path: String,
}

fn screenshot_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = crate::bridge::fs::lia_fs_safe_join_data(app, "Screenshots")?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

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
  if cleaned.trim_matches('-').is_empty() {
    format!("visualization-{}.png", Utc::now().format("%Y%m%d-%H%M%S"))
  } else {
    cleaned
  }
}

#[cfg(target_os = "macos")]
fn capture_screen_region(path: &PathBuf, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
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

#[cfg(not(target_os = "macos"))]
fn capture_screen_region(_path: &PathBuf, _x: i32, _y: i32, _width: u32, _height: u32) -> Result<(), String> {
  Err("Native region screenshots are currently available on macOS only.".to_string())
}

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
  if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
    return Err("Invalid capture region.".to_string());
  }

  let scale = window.scale_factor().unwrap_or(1.0);
  let origin = window
    .inner_position()
    .or_else(|_| window.outer_position())
    .map_err(|e| format!("Could not resolve window position: {e}"))?;

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
