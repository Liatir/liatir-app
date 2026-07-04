use chrono::Utc;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumableDownload {
    pub path: String,
    pub part_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub resumable_downloads: Vec<ResumableDownload>,
    pub cache_cleared_bytes: u64,
    pub corrupted_runs_removed: u32,
    pub errors: Vec<String>,
}

/// Run at app startup.
/// - Finds `.part` files → reports as resumable (does NOT delete them)
/// - Removes cache entries older than 7 days
/// - Removes malformed JSON run records
/// - Removes orphaned plugin-dev session residues (venv, sandbox fs, vars)
#[tauri::command]
pub fn lia_startup_cleanup(app: AppHandle) -> Result<CleanupReport, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;

    let mut report = CleanupReport {
        resumable_downloads: Vec::new(),
        cache_cleared_bytes: 0,
        corrupted_runs_removed: 0,
        errors: Vec::new(),
    };

    // 1 ── Find .part files in data dir (resumable downloads) ──────
    if data_dir.exists() {
        for entry in WalkDir::new(&data_dir).max_depth(4).follow_links(false) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("part") { continue; }

            let dest_path = path.with_extension(""); // strip .part
            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

            report.resumable_downloads.push(ResumableDownload {
                path: dest_path.to_string_lossy().to_string(),
                part_path: path.to_string_lossy().to_string(),
                size_bytes: size,
            });
        }
    }

    // 2 ── Clear cache entries older than 7 days ───────────────────
    let cutoff_secs = 7 * 24 * 3600i64;
    if cache_dir.exists() {
        for entry in WalkDir::new(&cache_dir).follow_links(false) {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();

            let age_secs = std::fs::metadata(path)
                .and_then(|m| m.modified())
                .map(|modified| {
                    let now = std::time::SystemTime::now();
                    now.duration_since(modified).map(|d| d.as_secs() as i64).unwrap_or(0)
                })
                .unwrap_or(0);

            if age_secs > cutoff_secs {
                let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                if let Err(e) = std::fs::remove_file(path) {
                    report.errors.push(format!("cache rm {}: {e}", path.display()));
                } else {
                    report.cache_cleared_bytes += size;
                }
            }
        }
        // Remove now-empty cache dirs
        remove_empty_dirs(&cache_dir, &mut report.errors);
    }

    // 3 ── Remove corrupted analysis-run JSON files ────────────────
    let runs_dir = data_dir.join("analysis-runs");
    if runs_dir.exists() {
        for entry in WalkDir::new(&runs_dir).follow_links(false) {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }

            match std::fs::read_to_string(path) {
                Err(e) => {
                    report.errors.push(format!("read {}: {e}", path.display()));
                }
                Ok(text) => {
                    if serde_json::from_str::<serde_json::Value>(&text).is_err() {
                        if let Err(e) = std::fs::remove_file(path) {
                            report.errors.push(format!("rm corrupt json {}: {e}", path.display()));
                        } else {
                            report.corrupted_runs_removed += 1;
                        }
                    }
                }
            }
        }
    }

    // 4 ── Remove orphaned plugin-dev session residues ─────────────
    // Dev sessions are volatile: their registry is in-memory, so leftovers
    // on disk (crashed CLI/app) are cleaned here. Active sessions survive.
    for error in crate::bridge::plugin_dev::cleanup_orphan_dev_residues(&app) {
        report.errors.push(format!("plugin-dev residue: {error}"));
    }

    Ok(report)
}

/// Delete a .part file to abandon a partial download.
#[tauri::command]
pub fn lia_cleanup_delete_part(part_path: String) -> Result<(), String> {
    let p = Path::new(&part_path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

fn remove_empty_dirs(dir: &PathBuf, errors: &mut Vec<String>) {
    // Walk bottom-up and remove empty dirs
    for entry in WalkDir::new(dir).min_depth(1).contents_first(true) {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if entry.file_type().is_dir() {
            let _ = std::fs::remove_dir(entry.path()); // silently skip non-empty
        }
    }
}
