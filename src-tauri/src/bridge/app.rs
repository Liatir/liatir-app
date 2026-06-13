use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri::window::Monitor;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct WindowInfo {
  pub label: String,
  pub width: u32,
  pub height: u32,
  pub x: i32,
  pub y: i32,
  pub is_visible: bool,
  pub is_minimized: bool,
  pub is_maximized: bool,
  pub is_fullscreen: bool,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
  pub name: Option<String>,
  pub width: u32,
  pub height: u32,
  pub x: i32,
  pub y: i32,
  pub scale_factor: f64,
}

#[derive(Serialize)]
pub struct AppInfo {
  // Package / app
  pub name: String,
  pub version: String,

  // Platform
  pub os: String,
  pub arch: String,
  pub is_debug: bool,

  // Process
  pub pid: u32,

  // Paths
  pub exec_path: Option<String>,
  pub exec_dir: Option<String>,
  pub current_dir: Option<String>,
  pub temp_dir: String,

  // Windows
  pub has_main_window: bool,
  pub windows: Vec<WindowInfo>,

  // Displays
  pub primary_screen: Option<ScreenInfo>,
  pub screens: Vec<ScreenInfo>,

  // Utility
  pub now_unix_ms: u128,
}

fn monitor_to_info(m: &Monitor) -> ScreenInfo {
  let size: PhysicalSize<u32> = *m.size();
  let pos: PhysicalPosition<i32> = *m.position();
  ScreenInfo {
    name: m.name().cloned(),
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    scale_factor: m.scale_factor(),
  }
}

#[tauri::command]
pub fn dtr_app_info(app: AppHandle) -> Result<AppInfo, String> {
  // Package info
  let pkg = app.package_info();

  // Platform
  let os = std::env::consts::OS.to_string();
  let arch = std::env::consts::ARCH.to_string();
  let is_debug = cfg!(debug_assertions);
  let pid = std::process::id();

  // Paths
  let exec_path = std::env::current_exe().ok().map(|p| p.to_string_lossy().to_string());
  let exec_dir = exec_path
    .as_ref()
    .and_then(|p| std::path::Path::new(p).parent().map(|pp| pp.to_string_lossy().to_string()));
  let current_dir = std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string());
  let temp_dir = std::env::temp_dir().to_string_lossy().to_string();

  // Windows info
  let mut windows: Vec<WindowInfo> = Vec::new();
  for (label, win) in app.webview_windows() {
    let size: PhysicalSize<u32> = win.inner_size().unwrap_or(PhysicalSize { width: 0, height: 0 });
    let pos: PhysicalPosition<i32> = win.outer_position().unwrap_or(PhysicalPosition { x: 0, y: 0 });
    let is_visible = win.is_visible().unwrap_or(false);
    let is_minimized = win.is_minimized().unwrap_or(false);
    let is_maximized = win.is_maximized().unwrap_or(false);
    let is_fullscreen = win.is_fullscreen().unwrap_or(false);

    windows.push(WindowInfo {
      label: label.clone(),
      width: size.width,
      height: size.height,
      x: pos.x,
      y: pos.y,
      is_visible,
      is_minimized,
      is_maximized,
      is_fullscreen,
    });
  }
  let has_main_window = app.get_webview_window("main").is_some();

  // Displays
  let primary_screen = app.primary_monitor().ok().flatten().map(|m| monitor_to_info(&m));
  let screens = app.available_monitors()
    .ok()
    .unwrap_or_default()
    .into_iter()
    .map(|m| monitor_to_info(&m))
    .collect::<Vec<_>>();

  // Timestamp
  let now_unix_ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or_default();

  Ok(AppInfo {
    name: pkg.name.clone(),
    version: pkg.version.to_string(),
    os,
    arch,
    is_debug,
    pid,
    exec_path,
    exec_dir,
    current_dir,
    temp_dir,
    has_main_window,
    windows,
    primary_screen,
    screens,
    now_unix_ms,
  })
}

#[tauri::command]
pub fn dtr_app_exit(app: AppHandle, code: i32) -> Result<(), String> {
  app.exit(code);
  Ok(())
}
