//! Plugin progress tracking.
//!
//! Plugins emit progress updates via `lia_plugin_progress`. Each update:
//! - Updates the job's `progress` field in the registry
//! - Is emitted as a Tauri event `jobs:progress:{jobId}` for real-time UI display

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::jobs::JobRegistry;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub current: u64,
    pub total: Option<u64>,
    pub label: Option<String>,
    pub done: bool,
}

// ── Tauri command ────────────────────────────────────────────────────────────

/// Update progress for a running job.
///
/// Parameters:
/// - `current`: absolute progress value (mutually exclusive with `delta`)
/// - `delta`: increment to add to current progress (mutually exclusive with `current`)
/// - `total`: total units (optional, can be set once and reused)
/// - `label`: human-readable label for current step
/// - `done`: mark progress as complete
///
/// The progress is:
/// 1. Stored in the job's `progress` field
/// 2. Emitted as `jobs:progress:{jobId}` event for real-time UI
#[tauri::command]
pub fn lia_plugin_progress(
    app: AppHandle,
    job_id: String,
    current: Option<u64>,
    total: Option<u64>,
    label: Option<String>,
    delta: Option<u64>,
    done: Option<bool>,
) -> Result<(), String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.jobs.lock().unwrap();

    let state = jobs
        .get_mut(&job_id)
        .ok_or_else(|| format!("job not found: {}", job_id))?;

    // Preserve the last meaningful counters when a caller marks progress done.
    // Resetting a completed Job to 0/unknown made its durable history disagree
    // with the progress users had just observed.
    let prev = state.entry.progress.as_ref();
    let new_current = if let Some(d) = delta {
        prev.map(|p| p.current).unwrap_or(0) + d
    } else {
        current.unwrap_or_else(|| prev.map(|p| p.current).unwrap_or(0))
    };
    let progress = JobProgress {
        current: new_current,
        total: total.or_else(|| prev.and_then(|p| p.total)),
        label: label.or_else(|| prev.and_then(|p| p.label.clone())),
        done: done.unwrap_or(false),
    };

    state.entry.progress = Some(progress.clone());
    drop(jobs);

    // Emit event for real-time UI display
    let _ = app.emit(&format!("jobs:progress:{}", job_id), progress);

    Ok(())
}
