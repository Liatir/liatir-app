use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write as IoWrite,
    path::{Path, PathBuf},
    sync::Mutex,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::bridge::app::{dtr_app_info, AppInfo as AppInfoStruct};
use crate::bridge::fs as dtrfs;

// ==============================
// Centralized relative paths
// ==============================
//
// All paths below are RELATIVE to the "_diagnostics" root.
// Do not use "diagnostics/..." as a prefix elsewhere.
//

#[inline]
fn rel_base() -> &'static str { "" }

#[inline]
fn rel_settings_dir() -> String { format!("{}settings", rel_base()) }

#[inline]
fn rel_privacy_settings() -> String { format!("{}/privacy.json", rel_settings_dir()) }

#[inline]
fn rel_runtime_dir() -> String { format!("{}runtime", rel_base()) }

#[inline]
fn rel_runtime_heartbeat() -> String { format!("{}/heartbeat.json", rel_runtime_dir()) }

#[inline]
fn rel_runtime_shutdown_ok() -> String { format!("{}/shutdown.ok", rel_runtime_dir()) }

#[inline]
fn rel_logs_dir() -> String { format!("{}logs", rel_base()) }

#[inline]
fn rel_monthly_log_file() -> String {
    // e.g., "logs/record-2025-09.jsonl"
    format!("{}/record-{}.jsonl", rel_logs_dir(), Utc::now().format("%Y-%m"))
}

#[inline]
fn rel_crashes_dir() -> String { format!("{}crashes", rel_base()) }

#[inline]
fn rel_crash_json_file(ts_iso_filename: &str) -> String {
    // ts_iso_filename like "2025-09-05T21-30-00Z"
    format!("{}/crash-{}.json", rel_crashes_dir(), ts_iso_filename)
}

#[inline]
fn rel_crash_log_file(ts_iso_filename: &str) -> String {
    format!("{}/crash-{}.log", rel_crashes_dir(), ts_iso_filename)
}

// Backward-compatible helper names.
#[inline]
fn runtime_dir_rel() -> String { rel_runtime_dir() }

#[inline]
fn runtime_heartbeat_rel() -> String { rel_runtime_heartbeat() }

#[inline]
fn runtime_shutdown_ok_rel() -> String { rel_runtime_shutdown_ok() }

// ==============================
// Heartbeat / runtime markers
// ==============================

static HEARTBEAT_STOP: AtomicBool = AtomicBool::new(false);

fn diagnostics_root(app: &AppHandle) -> PathBuf {
    // Resolve the absolute "_diagnostics" root.
    dtrfs::dtr_fs_safe_join_diagnostics(app, ".").expect("_diagnostics base dir not available")
}

/// Write text through dtrfs in the "_diagnostics" scope.
fn fs_write_text(app: &AppHandle, rel: &str, contents: &str, append: bool) -> Result<(), String> {
    dtrfs::dtr_fs_diagnostics_write_text(
        app.clone(),
        rel.to_string(),
        contents.to_string(),
        Some(true),
        Some(append),
    )
}

/// Read text through dtrfs in the "_diagnostics" scope.
fn fs_read_text(app: &AppHandle, rel: &str) -> Result<String, String> {
    dtrfs::dtr_fs_diagnostics_read_text(app.clone(), rel.to_string())
}

/// Read bytes through dtrfs in the "_diagnostics" scope.
fn fs_read_bytes(app: &AppHandle, rel: &str) -> Result<Vec<u8>, String> {
    let b64 = dtrfs::dtr_fs_diagnostics_read_bytes(app.clone(), rel.to_string())?;
    general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| e.to_string())
}

// ==============================
// Settings
// ==============================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrivacySettings {
    pub analytics_enabled: bool,
    pub crash_reports_enabled: bool,
    /// Retention days per area.
    pub retention_days_logs: u32,
    pub retention_days_analytics: u32,
    pub retention_days_crashes: u32,
}

fn default_privacy() -> PrivacySettings {
    PrivacySettings {
        analytics_enabled: false,
        crash_reports_enabled: true,
        retention_days_logs: 180,
        retention_days_analytics: 180,
        retention_days_crashes: 365,
    }
}

fn read_privacy(app: &AppHandle) -> PrivacySettings {
    match fs_read_text(app, &rel_privacy_settings()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| default_privacy()),
        Err(_) => default_privacy(),
    }
}

fn write_privacy(app: &AppHandle, s: &PrivacySettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs_write_text(app, &rel_privacy_settings(), &json, false)
}

fn crash_reports_enabled(app: &AppHandle) -> bool {
    read_privacy(app).crash_reports_enabled
}

// ==============================
// Types for logs
// ==============================

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyticsRecord {
    pub name: String,
    #[serde(default)]
    pub props: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Payload {
    Error(ErrorPayload),
    Analytics(AnalyticsRecord),
    Any(Value),
}

pub type AppInfoJson = Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct LogData {
    pub record_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    pub payload: Payload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_info: Option<AppInfoJson>,
}

#[derive(Debug, Serialize)]
pub struct ListedFile {
    pub rel_path: String,
    pub bytes: u64,
    pub modified_ms: u64,
}

// ==============================
// Low-level logging helpers
// ==============================

static ROTATE_MAX_BYTES: usize = 10 * 1024 * 1024;
static LOG_MUTEX: Mutex<()> = Mutex::new(());

/// Rename "<file>.jsonl" to "<file>.partN.jsonl" when size exceeds the threshold.
fn rotate_with_part_suffix(abs_path: &Path) -> std::io::Result<()> {
    if let Ok(meta) = fs::metadata(abs_path) {
        if meta.len() as usize >= ROTATE_MAX_BYTES {
            let (stem, ext) = if let Some(ext) = abs_path.extension().and_then(|s| s.to_str()) {
                let stem = abs_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
                (stem.to_string(), format!(".{}", ext))
            } else {
                ("file".to_string(), String::new())
            };

            let mut n = 2;
            loop {
                let rotated_name = format!("{}.part{}{}", stem, n, ext);
                let rotated_path = abs_path.with_file_name(rotated_name);

                if !rotated_path.exists() {
                    fs::rename(abs_path, rotated_path)?;
                    break;
                }

                n += 1;
            }
        }
    }

    Ok(())
}

/// Append JSONL through the diagnostics scope, with rotation on the resolved absolute path.
fn append_jsonl(app: &AppHandle, rel_path: &str, value: &serde_json::Value) -> Result<(), String> {
    let _guard = LOG_MUTEX.lock().unwrap();

    let abs = dtrfs::dtr_fs_safe_join_diagnostics(app, rel_path)?;
    rotate_with_part_suffix(&abs).map_err(|e| e.to_string())?;

    let line = serde_json::to_string(value).unwrap() + "\n";
    fs_write_text(app, rel_path, &line, true)
}

fn new_log_data(
    app: &tauri::AppHandle,
    payload: Payload,
    record_type: String,
    env: Option<String>,
    app_version: Option<String>,
) -> LogData {
    let app_info_json: Option<Value> = dtr_app_info(app.clone())
        .ok()
        .and_then(|ai: AppInfoStruct| serde_json::to_value(ai).ok());

    LogData {
        record_type,
        env,
        timestamp: Some(Utc::now().timestamp_millis() as u64),
        app_version,
        payload,
        app_info: app_info_json,
    }
}

// ==============================
// Heartbeat
// ==============================

/// Start the heartbeat that writes "runtime/heartbeat.json" every few seconds under "_diagnostics".
/// If a heartbeat exists at startup but "shutdown.ok" does not, a dirty shutdown is recorded.
pub fn start_heartbeat(app: AppHandle) {
    let base = diagnostics_root(&app);
    let hb_abs = base.join(&runtime_heartbeat_rel());
    let ok_abs = base.join(&runtime_shutdown_ok_rel());
    let dirty = hb_abs.exists() && !ok_abs.exists();

    if dirty {
        let entry = serde_json::json!({
          "record_type": "dirty_shutdown",
          "timestamp": Utc::now().timestamp_millis() as u64,
          "note": "previous run did not shut down cleanly"
        });

        if crash_reports_enabled(&app) {
            let ts = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();

            let _ = fs_write_text(
                &app,
                &rel_crash_json_file(&ts),
                &serde_json::to_string_pretty(&entry).unwrap(),
                false,
            );
        }

        let log_rel = rel_monthly_log_file();
        let _ = append_jsonl(&app, &log_rel, &entry);
    }

    let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), runtime_shutdown_ok_rel().into(), false);
    let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), runtime_heartbeat_rel().into(), false);

    thread::spawn(move || {
        while !HEARTBEAT_STOP.load(Ordering::Relaxed) {
            let payload = serde_json::json!({ "ts": Utc::now().to_rfc3339() });

            let _ = fs_write_text(
                &app,
                &runtime_heartbeat_rel(),
                &serde_json::to_string(&payload).unwrap(),
                false,
            );

            thread::sleep(Duration::from_secs(5));
        }

        let _ = fs_write_text(&app, &runtime_shutdown_ok_rel(), "ok", false);
        let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), runtime_heartbeat_rel().into(), false);
    });
}

/// Mark a clean shutdown immediately.
pub fn mark_clean_shutdown_now(app: &AppHandle) {
    HEARTBEAT_STOP.store(true, Ordering::Relaxed);

    let _ = fs_write_text(app, &runtime_shutdown_ok_rel(), "ok", false);
    let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), runtime_heartbeat_rel().into(), false);
}

// ==============================
// Public Tauri commands
// ==============================

/// Generic error record. Normal errors are written only to logs/.
#[tauri::command]
pub fn dtr_logs_record_error(
    app: AppHandle,
    payload: ErrorPayload,
    env: String,
    app_version: String,
) -> Result<(), String> {
    let log_rel = rel_monthly_log_file();

    let log_data = new_log_data(
        &app,
        Payload::Error(payload),
        "error".to_string(),
        Some(env),
        Some(app_version),
    );

    let entry = serde_json::to_value(&log_data).unwrap();
    append_jsonl(&app, &log_rel, &entry)
}

/// Shortcut for JS errors.
#[tauri::command]
pub fn dtr_logs_record_js_error(
    app: AppHandle,
    payload: ErrorPayload,
    app_version: String,
) -> Result<(), String> {
    dtr_logs_record_error(app, payload, "js".to_string(), app_version)
}

/// Shortcut for native errors.
#[tauri::command]
pub fn dtr_logs_record_native_error(
    app: AppHandle,
    payload: ErrorPayload,
    app_version: String,
) -> Result<(), String> {
    dtr_logs_record_error(app, payload, "native".to_string(), app_version)
}

/// Append one analytics record if analytics are enabled.
#[tauri::command]
pub fn dtr_logs_new_record(
    app: AppHandle,
    record_type: String,
    payload: AnalyticsRecord,
    env: String,
    app_version: String,
) -> Result<(), String> {
    let settings = read_privacy(&app);

    if !settings.analytics_enabled {
        return Ok(());
    }

    let log_rel = rel_monthly_log_file();

    let log_data = new_log_data(
        &app,
        Payload::Analytics(payload),
        record_type,
        Some(env),
        Some(app_version),
    );

    let entry = serde_json::to_value(&log_data).unwrap();
    append_jsonl(&app, &log_rel, &entry)
}

/// Export diagnostics subdirectories as a zip file.
/// Opens an OS save dialog so the user explicitly chooses the destination path.
/// Returns the chosen path, or an empty string if the user cancelled.
#[tauri::command]
pub async fn dtr_logs_export_zip(app: AppHandle) -> Result<String, String> {
    let handle = app.clone();
    let default_name = format!("diagnostics-{}.zip", Utc::now().format("%Y-%m-%d"));

    let chosen = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Save Diagnostics")
            .set_file_name(&default_name)
            .add_filter("Zip archive", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog error: {e}"))?;

    let target_zip_path = match chosen {
        None => return Ok(String::new()),
        Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
        Some(FilePath::Url(u)) => u.to_string(),
    };

    let base = diagnostics_root(&app);
    let file = std::fs::File::create(&target_zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let dirs = [rel_logs_dir(), rel_crashes_dir(), runtime_dir_rel()];

    for d in dirs {
        let dir_path = base.join(&d);

        if !dir_path.exists() {
            continue;
        }

        for entry in WalkDir::new(&dir_path).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() {
                let rel = entry
                    .path()
                    .strip_prefix(&base)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                let bytes = fs_read_bytes(&app, &rel)?;

                zip.start_file(rel, options).map_err(|e| e.to_string())?;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(target_zip_path)
}

/// Install a Rust panic hook that writes crash files if crash reports are enabled.
pub fn install_panic_hook(app: AppHandle, app_version: String) {
    std::panic::set_hook(Box::new(move |info| {
        let ts = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
        let cause = info.to_string();
        let bt = std::backtrace::Backtrace::force_capture().to_string();

        let json = serde_json::json!({
          "record_type": "panic",
          "timestamp": Utc::now().timestamp_millis() as u64,
          "appVersion": app_version,
          "cause": cause,
          "backtrace": bt
        });

        if crash_reports_enabled(&app) {
            let _ = fs_write_text(
                &app,
                &rel_crash_json_file(&ts),
                &serde_json::to_string_pretty(&json).unwrap(),
                false,
            );

            let _ = fs_write_text(
                &app,
                &rel_crash_log_file(&ts),
                &format!("{}\n\n{}", cause, bt),
                false,
            );
        }
    }));
}

// ==============================
// Retention
// ==============================

fn purge_older_than(
    app: &AppHandle,
    base: &Path,
    dir_rel: &str,
    max_age_days: u32,
) -> std::io::Result<()> {
    let dir = base.join(dir_rel);

    if !dir.exists() {
        return Ok(());
    }

    let now = std::time::SystemTime::now();
    let cutoff = now - Duration::from_secs((max_age_days as u64) * 24 * 3600);

    for entry in WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() {
            let meta = entry.metadata()?;

            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let rel = entry
                        .path()
                        .strip_prefix(base)
                        .ok()
                        .map(|p| p.to_string_lossy().to_string());

                    if let Some(rel) = rel {
                        let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), rel, false);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Run retention for logs/ and crashes/ according to current settings.
fn run_retention(app: &AppHandle) -> Result<(), String> {
    let s = read_privacy(app);
    let base = diagnostics_root(app);

    purge_older_than(app, &base, &rel_logs_dir(), s.retention_days_logs)
        .map_err(|e| e.to_string())?;

    purge_older_than(app, &base, &rel_crashes_dir(), s.retention_days_crashes)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn dtr_logs_run_retention(app: AppHandle) -> Result<(), String> {
    run_retention(&app)
}

// ==============================
// File listing/reading
// ==============================

#[tauri::command]
pub fn dtr_logs_list_files(app: AppHandle, area: String) -> Result<Vec<ListedFile>, String> {
    let base = diagnostics_root(&app);

    let dir_rel = match area.as_str() {
        "logs" => rel_logs_dir(),
        "crashes" => rel_crashes_dir(),
        "runtime" => rel_runtime_dir(),
        _ => return Err("Invalid area".into()),
    };

    let dir = base.join(&dir_rel);
    let mut out = vec![];

    if dir.exists() {
        for entry in WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() {
                let meta = entry.metadata().map_err(|e| e.to_string())?;
                let m = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);

                let modified_ms = m
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                let rel = entry
                    .path()
                    .strip_prefix(&base)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                out.push(ListedFile {
                    rel_path: rel,
                    bytes: meta.len(),
                    modified_ms,
                });
            }
        }
    }

    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));

    Ok(out)
}

#[tauri::command]
pub fn dtr_logs_read_file(
    app: AppHandle,
    rel_path: String,
    // max_bytes: Option<u64>,
) -> Result<String, String> {
    let data = fs_read_text(&app, &rel_path)?;

    // if let Some(limit) = max_bytes {
    //     if data.len() as u64 > limit {
    //         return Err(format!("File too large ({} > {})", data.len(), limit));
    //     }
    // }

    Ok(data)
}

// ==============================
// Privacy toggle commands
// ==============================

#[tauri::command]
pub fn dtr_logs_get_privacy(app: AppHandle) -> Result<PrivacySettings, String> {
    Ok(read_privacy(&app))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PrivacyPatch {
    pub analytics_enabled: Option<bool>,
    pub crash_reports_enabled: Option<bool>,
    pub retention_days_logs: Option<u32>,
    pub retention_days_analytics: Option<u32>,
    pub retention_days_crashes: Option<u32>,
}

#[tauri::command]
pub fn dtr_logs_set_privacy(app: AppHandle, patch: PrivacyPatch) -> Result<PrivacySettings, String> {
    let mut s = read_privacy(&app);

    if let Some(v) = patch.analytics_enabled {
        s.analytics_enabled = v;
    }

    if let Some(v) = patch.crash_reports_enabled {
        s.crash_reports_enabled = v;
    }

    if let Some(v) = patch.retention_days_logs {
        s.retention_days_logs = v.max(30);
    }

    if let Some(v) = patch.retention_days_analytics {
        s.retention_days_analytics = v.max(30);
    }

    if let Some(v) = patch.retention_days_crashes {
        s.retention_days_crashes = v.max(90);
    }

    write_privacy(&app, &s)?;

    Ok(s)
}

// ==============================
// Test commands
// ==============================

#[cfg(debug_assertions)]
#[tauri::command]
pub fn dtr_logs_test_record_n(app: AppHandle, n: u32) -> Result<(), String> {
    for i in 0..n {
        let rec = AnalyticsRecord {
            name: "test_event".into(),
            props: serde_json::json!({
                "i": i,
                "blob": "x".repeat((i % 5 + 1) as usize * 2000)
            }),
        };

        dtr_logs_new_record(
            app.clone(),
            "test".into(),
            rec,
            "dev".into(),
            "0.0.0-dev".into(),
        )?;
    }

    Ok(())
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn dtr_logs_test_panic() {
    panic!("Intentional panic for testing crash pipeline");
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn dtr_logs_test_force_retention(app: AppHandle, area: String) -> Result<(), String> {
    let base = diagnostics_root(&app);

    let dir_rel = match area.as_str() {
        "logs" => rel_logs_dir(),
        "crashes" => rel_crashes_dir(),
        "runtime" => rel_runtime_dir(),
        _ => return Err("Invalid area".into()),
    };

    let dir = base.join(&dir_rel);

    if dir.exists() {
        for entry in WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() {
                let rel = entry
                    .path()
                    .strip_prefix(&base)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                let _ = dtrfs::dtr_fs_diagnostics_rm(app.clone(), rel, false);
            }
        }
    }

    Ok(())
}