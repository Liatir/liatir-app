use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub fn dtr_clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
  app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_clipboard_read(app: AppHandle) -> Result<String, String> {
  app.clipboard().read_text().map_err(|e| e.to_string())
}
