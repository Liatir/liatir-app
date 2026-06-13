// src/bridge/events.rs
use tauri::{AppHandle, Emitter}; // <- porta in scope il trait giusto
use serde_json::Value;

#[tauri::command]
pub fn dtr_event_emit( // cross window
  app: AppHandle,
  event: String,
  payload: Option<Value>,
) -> Result<(), String> {
  app
    .emit(event.as_str(), payload) // <- &str esplicito
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_event_emit_to_current_window(
  window: tauri::Window,
  event: String,
  payload: Option<Value>
) -> Result<(), String> {
  window
    .emit(event.as_str(), payload) // <- &str esplicito
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_event_emit_to(
  app: AppHandle,
  window_label: String,
  event: String,
  payload: Option<Value>,
) -> Result<(), String> {
  app
    .emit_to(window_label.as_str(), event.as_str(), payload) // <- &str espliciti
    .map_err(|e| e.to_string())
}
