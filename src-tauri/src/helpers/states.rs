use tauri::{AppHandle, Manager};
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

pub struct CloseGuard {
    pub closing: AtomicBool,
    pub pending: AtomicBool,
}

pub struct LatestWindowLabel {
    pub label: Mutex<String>,
}
impl LatestWindowLabel {
    pub fn set(&self, v: impl Into<String>) {
        *self.label.lock().unwrap() = v.into();
    }
    pub fn get(&self) -> String {
        self.label.lock().unwrap().clone()
    }
}

pub fn get_latest_window_label(app: &AppHandle) -> String {
    let state = app.state::<LatestWindowLabel>();
    let l = state.label.lock().unwrap().clone();
    return l;
}
