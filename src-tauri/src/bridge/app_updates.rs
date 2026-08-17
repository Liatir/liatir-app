//! User-controlled application updates.
//!
//! The Tauri updater plugin owns transport, signature verification and native
//! installation. This module adds Liatir's lifecycle rules: only the main
//! window may request an update, one update operation runs at a time, and an
//! application replacement or restart is refused while a scientific Job is
//! still running.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

use super::jobs::JobRegistry;

const UPDATE_PROGRESS_EVENT: &str = "app:update-progress";

pub struct AppUpdateState {
    pending: Mutex<Option<Update>>,
    operation_active: Mutex<bool>,
}

impl AppUpdateState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            operation_active: Mutex::new(false),
        }
    }

    fn begin_operation(&self) -> Result<AppUpdateOperation<'_>, String> {
        let mut active = self
            .operation_active
            .lock()
            .map_err(|_| "Application update state is unavailable".to_string())?;
        if *active {
            return Err("Another application update operation is already running".to_string());
        }
        *active = true;
        Ok(AppUpdateOperation {
            active: &self.operation_active,
        })
    }
}

struct AppUpdateOperation<'a> {
    active: &'a Mutex<bool>,
}

impl Drop for AppUpdateOperation<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            *active = false;
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    available: bool,
    current_version: String,
    version: Option<String>,
    published_at: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResult {
    version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgress {
    phase: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Application updates can only be managed from the main window".to_string());
    }
    Ok(())
}

fn ensure_no_running_jobs(app: &AppHandle) -> Result<(), String> {
    let count = app.state::<JobRegistry>().running_count()?;
    if count > 0 {
        return Err(format!(
            "Wait for {count} running Job{} to finish or cancel it before updating Liatir",
            if count == 1 { "" } else { "s" }
        ));
    }
    Ok(())
}

fn updater_error(error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    if message.to_ascii_lowercase().contains("endpoint") {
        "Application updates are not configured for this build".to_string()
    } else {
        format!("Application update failed: {message}")
    }
}

#[tauri::command]
pub async fn lia_app_update_check(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppUpdateState>,
) -> Result<AppUpdateCheckResult, String> {
    ensure_main_window(&window)?;
    let _operation = state.begin_operation()?;
    state
        .pending
        .lock()
        .map_err(|_| "Application update state is unavailable".to_string())?
        .take();

    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;

    let Some(update) = update else {
        return Ok(AppUpdateCheckResult {
            available: false,
            current_version,
            version: None,
            published_at: None,
            notes: None,
        });
    };

    let result = AppUpdateCheckResult {
        available: true,
        current_version,
        version: Some(update.version.clone()),
        published_at: update.date.map(|date| date.to_string()),
        notes: update.body.clone(),
    };
    state
        .pending
        .lock()
        .map_err(|_| "Application update state is unavailable".to_string())?
        .replace(update);
    Ok(result)
}

#[tauri::command]
pub async fn lia_app_update_install(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppUpdateState>,
) -> Result<AppUpdateInstallResult, String> {
    ensure_main_window(&window)?;
    let _operation = state.begin_operation()?;
    ensure_no_running_jobs(&app)?;

    let update = state
        .pending
        .lock()
        .map_err(|_| "Application update state is unavailable".to_string())?
        .take()
        .ok_or_else(|| "Check for an application update before installing it".to_string())?;
    let version = update.version.clone();

    let progress_app = app.clone();
    let mut downloaded_bytes = 0_u64;
    let bytes = update
        .download(
            move |chunk_bytes, total_bytes| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_bytes as u64);
                let _ = progress_app.emit(
                    UPDATE_PROGRESS_EVENT,
                    AppUpdateProgress {
                        phase: "downloading",
                        downloaded_bytes,
                        total_bytes,
                    },
                );
            },
            {
                let app = app.clone();
                move || {
                    let _ = app.emit(
                        UPDATE_PROGRESS_EVENT,
                        AppUpdateProgress {
                            phase: "verifying",
                            downloaded_bytes: 0,
                            total_bytes: None,
                        },
                    );
                }
            },
        )
        .await
        .map_err(updater_error)?;

    // A Job may have started while the update was downloading. Signature
    // verification has completed, but the application is not replaced until
    // this second lifecycle check also succeeds.
    let registry = app.state::<JobRegistry>();
    let _job_gate = registry.block_new_jobs_for_update()?;
    ensure_no_running_jobs(&app)?;
    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        AppUpdateProgress {
            phase: "installing",
            downloaded_bytes: bytes.len() as u64,
            total_bytes: Some(bytes.len() as u64),
        },
    );
    update.install(bytes).map_err(updater_error)?;
    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        AppUpdateProgress {
            phase: "ready",
            downloaded_bytes: 0,
            total_bytes: None,
        },
    );

    Ok(AppUpdateInstallResult { version })
}

#[tauri::command]
pub fn lia_app_restart(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    ensure_main_window(&window)?;
    let registry = app.state::<JobRegistry>();
    let _job_gate = registry.block_new_jobs_for_update()?;
    ensure_no_running_jobs(&app)?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_state_allows_only_one_operation() {
        let state = AppUpdateState::new();
        let first = state.begin_operation().expect("first operation");
        assert!(state.begin_operation().is_err());
        drop(first);
        assert!(state.begin_operation().is_ok());
    }

    #[test]
    fn endpoint_failures_are_actionable() {
        assert_eq!(
            updater_error("empty endpoints"),
            "Application updates are not configured for this build"
        );
        assert_eq!(
            updater_error("signature mismatch"),
            "Application update failed: signature mismatch"
        );
    }
}
