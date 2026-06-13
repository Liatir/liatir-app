// src-tauri/src/bridge/dragdrop.rs
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, window::Window};

#[derive(Serialize, Debug, Clone)]
pub struct DragDropPayload {
  /// "enter" | "over" | "drop" | "cancel"
  pub kind: &'static str,
  pub paths: Vec<String>,
  pub position: Option<Position>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Position { pub x: f64, pub y: f64 }

fn paths_to_strings(paths: &[PathBuf]) -> Vec<String> {
  paths.iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

pub fn emit_enter(window: &Window, paths: &[PathBuf], x: f64, y: f64) {
  let _ = window.emit("dragdrop:enter", DragDropPayload {
    kind: "enter",
    paths: paths_to_strings(paths),
    position: Some(Position { x, y }),
  });
}

pub fn emit_over(window: &Window, x: f64, y: f64) {
  let _ = window.emit("dragdrop:hover", DragDropPayload {
    kind: "over",
    paths: Vec::new(),
    position: Some(Position { x, y }),
  });
}

pub fn emit_drop(window: &Window, paths: &[PathBuf], x: f64, y: f64) {
  let _ = window.emit("dragdrop:drop", DragDropPayload {
    kind: "drop",
    paths: paths_to_strings(paths),
    position: Some(Position { x, y }),
  });
}

pub fn emit_cancel(window: &Window) {
  let _ = window.emit("dragdrop:cancel", DragDropPayload {
    kind: "cancel",
    paths: Vec::new(),
    position: None,
  });
}
