//! Plugin structured logging.
//!
//! Plugins emit log entries via `lia_plugin_log`. Each entry is:
//! - Stored in the job's stderr buffer (so it appears in job output)
//! - Emitted as a Tauri event `jobs:log:{jobId}` for real-time UI display

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use super::jobs::JobRegistry;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLogEntry {
    pub job_id: String,
    pub level: String,
    pub message: String,
    pub meta: Option<Value>,
    pub timestamp_ms: u64,
}

// ── Tauri command ────────────────────────────────────────────────────────────

/// Emit a structured log entry from a plugin.
///
/// The entry is:
/// 1. Appended to the job's stderr buffer (formatted as `[LEVEL] message`)
/// 2. Emitted as `jobs:log:{jobId}` event for real-time UI
#[tauri::command]
pub fn lia_plugin_log(
    app: AppHandle,
    job_id: String,
    level: String,
    message: String,
    meta: Option<Value>,
) -> Result<(), String> {
    let entry = PluginLogEntry {
        job_id: job_id.clone(),
        level: level.clone(),
        message: message.clone(),
        meta,
        timestamp_ms: now_ms(),
    };

    // Append formatted log to job's stderr buffer
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.jobs.lock().unwrap();
    if let Some(state) = jobs.get_mut(&job_id) {
        let formatted = format!("[{}] {}", level.to_uppercase(), message);
        state.stderr.lock().unwrap().push(formatted);
    }
    drop(jobs);

    // Emit event for real-time UI display
    let _ = app.emit(&format!("jobs:log:{}", job_id), entry);

    Ok(())
}
