//! System clipboard access.
//!
//! Thin wrappers over the Tauri clipboard plugin: they exist so clipboard use goes through the
//! same `lia_*` command surface (and the same permission file) as every other capability,
//! rather than through a second, separately-permissioned API in the webview.

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Copies text to the system clipboard.
#[tauri::command]
pub fn lia_clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
  app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// Reads text from the system clipboard.
#[tauri::command]
pub fn lia_clipboard_read(app: AppHandle) -> Result<String, String> {
  app.clipboard().read_text().map_err(|e| e.to_string())
}
