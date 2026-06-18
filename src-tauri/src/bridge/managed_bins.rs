use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

// ---------------------------------
// Types
// ---------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub done: bool,
}

// ---------------------------------
// Commands
// ---------------------------------

/// Download a file from `url` and write it to `dest_path`.
/// Emits `managed:progress:{id}` with a DownloadProgress payload.
/// Returns total bytes written.
#[tauri::command]
pub async fn dtr_managed_download(
    app: AppHandle,
    id: String,
    url: String,
    dest_path: String,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .user_agent("Liatir/2")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}: {url}", response.status()));
    }

    let bytes_total = response.content_length();

    let _ = app.emit(
        &format!("managed:progress:{id}"),
        DownloadProgress {
            id: id.clone(),
            bytes_downloaded: 0,
            bytes_total,
            done: false,
        },
    );

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let bytes_downloaded = bytes.len() as u64;

    if let Some(parent) = Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    std::fs::write(&dest_path, &bytes).map_err(|e| format!("Write failed: {e}"))?;

    let _ = app.emit(
        &format!("managed:progress:{id}"),
        DownloadProgress {
            id: id.clone(),
            bytes_downloaded,
            bytes_total: Some(bytes_downloaded),
            done: true,
        },
    );

    Ok(bytes_downloaded)
}

/// Extract a tar.gz / tar.bz2 / zip archive to `dest_dir`.
/// Uses the system `tar` command (available on macOS, Linux, Windows 10+).
/// For .zip files on any platform, falls back to the `zip` crate.
#[tauri::command]
pub fn dtr_managed_extract(
    archive_path: String,
    dest_dir: String,
) -> Result<(), String> {
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let lower = archive_path.to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(&archive_path, &dest_dir)
    } else {
        extract_tar(&archive_path, &dest_dir)
    }
}

fn extract_tar(archive_path: &str, dest_dir: &str) -> Result<(), String> {
    let output = std::process::Command::new("tar")
        .args(["-xf", archive_path, "-C", dest_dir])
        .output()
        .map_err(|e| format!("tar not found: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tar failed: {stderr}"));
    }

    Ok(())
}

fn extract_zip(archive_path: &str, dest_dir: &str) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = Path::new(dest_dir).join(entry.name());

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Find a file by name inside `dir`, recursively.
/// Returns its absolute path, or null if not found.
#[tauri::command]
pub fn dtr_managed_find_binary(dir: String, name: String) -> Result<Option<String>, String> {
    for entry in WalkDir::new(&dir).follow_links(true) {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            if let Some(fname) = entry.file_name().to_str() {
                // Match exact name or name without .exe suffix
                let matches = fname == name
                    || fname == format!("{name}.exe")
                    || fname.to_lowercase() == name.to_lowercase();
                if matches {
                    return Ok(Some(entry.path().to_string_lossy().to_string()));
                }
            }
        }
    }
    Ok(None)
}

/// Move a file from `src` to `dest` (both absolute paths).
/// Falls back to copy+delete if they are on different filesystems.
#[tauri::command]
pub fn dtr_managed_move(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dest)
        .or_else(|_| {
            std::fs::copy(&src, &dest).map(|_| ())?;
            std::fs::remove_file(&src)
        })
        .map_err(|e| format!("Move failed: {e}"))
}

/// Remove a file or directory (absolute path).
#[tauri::command]
pub fn dtr_managed_remove(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Ok(()); }
    if p.is_dir() && recursive {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.is_dir() {
        std::fs::remove_dir(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Get the byte size of a file at any absolute path.
#[tauri::command]
pub fn dtr_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Read text content from any absolute path.
#[tauri::command]
pub fn dtr_read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write text content to any absolute path (used for script export).
#[tauri::command]
pub fn dtr_write_file_path(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// Set the executable bit on a file (Unix only — no-op on Windows).
#[tauri::command]
pub fn dtr_managed_set_executable(path: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let mut perms = meta.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }
    Ok(())
}
