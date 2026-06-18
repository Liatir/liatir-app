use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

// ── Download registry ─────────────────────────────────────────────

pub struct DownloadRegistry {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadRegistry {
    pub fn new() -> Self {
        Self { active: Mutex::new(HashMap::new()) }
    }

    pub(crate) fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.active.lock().unwrap().insert(id.to_string(), Arc::clone(&flag));
        flag
    }

    pub(crate) fn unregister(&self, id: &str) {
        self.active.lock().unwrap().remove(id);
    }

    fn cancel_flag(&self, id: &str) -> Option<Arc<AtomicBool>> {
        self.active.lock().unwrap().get(id).cloned()
    }
}

// ── Progress payload ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub bytes_per_sec: f64,
    pub done: bool,
    pub error: Option<String>,
}

// ── SHA-256 helper ────────────────────────────────────────────────

fn sha256_of_file(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// ── Commands ──────────────────────────────────────────────────────

/// Download a URL to `dest_path` with:
///  - streaming to disk (no full-RAM load)
///  - resume via HTTP Range if a `.part` file already exists
///  - optional SHA-256 verification
///  - cancellation via `lia_managed_download_cancel`
///  - progress events `managed:progress:{id}` every ~500 ms
#[tauri::command]
pub async fn lia_managed_download(
    app: AppHandle,
    state: tauri::State<'_, DownloadRegistry>,
    id: String,
    url: String,
    dest_path: String,
    sha256: Option<String>,
) -> Result<u64, String> {
    let cancelled = state.register(&id);

    let result = stream_download(&app, &id, &url, &dest_path, sha256.as_deref(), &cancelled).await;

    state.unregister(&id);

    // Emit final event
    match &result {
        Ok(bytes) => {
            let _ = app.emit(&format!("managed:progress:{id}"), DownloadProgress {
                id: id.clone(),
                bytes_downloaded: *bytes,
                bytes_total: Some(*bytes),
                bytes_per_sec: 0.0,
                done: true,
                error: None,
            });
        }
        Err(e) => {
            let _ = app.emit(&format!("managed:progress:{id}"), DownloadProgress {
                id: id.clone(),
                bytes_downloaded: 0,
                bytes_total: None,
                bytes_per_sec: 0.0,
                done: true,
                error: Some(e.clone()),
            });
        }
    }

    result
}

pub(crate) async fn stream_download(
    app: &AppHandle,
    id: &str,
    url: &str,
    dest_path: &str,
    sha256: Option<&str>,
    cancelled: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let part_path = format!("{dest_path}.part");

    // Determine resume offset from existing .part file
    let resume_from = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    // Build HTTP request — add Range header if resuming
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 Liatir/2")
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url);
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={resume_from}-"));
    }

    let response = req.send().await.map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() && response.status().as_u16() != 206 {
        return Err(format!("HTTP {}: {url}", response.status()));
    }

    // 206 Partial Content → server supports resume; otherwise restart from 0
    let (append, start_bytes) = if response.status().as_u16() == 206 && resume_from > 0 {
        (true, resume_from)
    } else {
        (false, 0u64)
    };

    let content_length = response.content_length();
    let bytes_total = content_length.map(|cl| cl + start_bytes);

    // Ensure parent directory exists
    if let Some(parent) = Path::new(&part_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Open .part file
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(append)
        .truncate(!append)
        .write(true)
        .open(&part_path)
        .map_err(|e| format!("Cannot open part file: {e}"))?;

    let mut bytes_downloaded = start_bytes;
    let mut last_emit = Instant::now();
    let mut bytes_since_last_emit = 0u64;

    // Emit initial progress
    let _ = app.emit(&format!("managed:progress:{id}"), DownloadProgress {
        id: id.to_string(),
        bytes_downloaded,
        bytes_total,
        bytes_per_sec: 0.0,
        done: false,
        error: None,
    });

    // Stream chunks
    let mut response = response;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            // Leave .part file in place so download can be resumed later
            return Err("Download cancelled".to_string());
        }

        match response.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk).map_err(|e| format!("Write error: {e}"))?;
                let chunk_len = chunk.len() as u64;
                bytes_downloaded += chunk_len;
                bytes_since_last_emit += chunk_len;

                // Emit every 500 ms
                let elapsed = last_emit.elapsed();
                if elapsed.as_millis() >= 500 {
                    let bps = bytes_since_last_emit as f64 / elapsed.as_secs_f64();
                    let _ = app.emit(&format!("managed:progress:{id}"), DownloadProgress {
                        id: id.to_string(),
                        bytes_downloaded,
                        bytes_total,
                        bytes_per_sec: bps,
                        done: false,
                        error: None,
                    });
                    last_emit = Instant::now();
                    bytes_since_last_emit = 0;
                }
            }
            Ok(None) => break, // done
            Err(e) => return Err(format!("Stream error: {e}")),
        }
    }

    // Flush file before checksum
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    // SHA-256 verification
    if let Some(expected) = sha256 {
        let computed = sha256_of_file(&part_path)?;
        let expected_lower = expected.to_lowercase();
        if computed != expected_lower {
            // Delete corrupted .part so a fresh download can start
            let _ = std::fs::remove_file(&part_path);
            return Err(format!(
                "SHA-256 mismatch — file deleted\n  expected: {expected_lower}\n  computed: {computed}"
            ));
        }
    }

    // Rename .part → final destination
    if let Some(parent) = Path::new(dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&part_path, dest_path)
        .or_else(|_| {
            // Cross-device rename fallback
            std::fs::copy(&part_path, dest_path).map(|_| ())?;
            std::fs::remove_file(&part_path)
        })
        .map_err(|e| format!("Rename failed: {e}"))?;

    Ok(bytes_downloaded)
}

/// Cancel an active download by ID.
/// The .part file is kept for future resume.
#[tauri::command]
pub fn lia_managed_download_cancel(
    state: tauri::State<'_, DownloadRegistry>,
    id: String,
) -> bool {
    if let Some(flag) = state.cancel_flag(&id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

/// Verify the SHA-256 checksum of a file without downloading it.
#[tauri::command]
pub fn lia_managed_verify_sha256(path: String, expected: String) -> Result<bool, String> {
    let computed = sha256_of_file(&path)?;
    Ok(computed == expected.to_lowercase())
}

// ── Archive extraction ────────────────────────────────────────────

#[tauri::command]
pub fn lia_managed_extract(archive_path: String, dest_dir: String) -> Result<(), String> {
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
        return Err(format!("tar failed: {}", String::from_utf8_lossy(&output.stderr)));
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

// ── Binary search + move + remove ────────────────────────────────

#[tauri::command]
pub fn lia_managed_find_binary(dir: String, name: String) -> Result<Option<String>, String> {
    for entry in WalkDir::new(&dir).follow_links(true) {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            if let Some(fname) = entry.file_name().to_str() {
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

#[tauri::command]
pub fn lia_managed_move(src: String, dest: String) -> Result<(), String> {
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

#[tauri::command]
pub fn lia_managed_remove(path: String, recursive: bool) -> Result<(), String> {
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

#[tauri::command]
pub fn lia_managed_set_executable(path: String) -> Result<(), String> {
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

// ── File utilities ────────────────────────────────────────────────

#[tauri::command]
pub fn lia_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path).map(|m| m.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lia_read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lia_preview_file(path: String, lines: usize) -> Result<String, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut result = Vec::with_capacity(lines);
    for line in reader.lines().take(lines) {
        result.push(line.map_err(|e| e.to_string())?);
    }
    Ok(result.join("\n"))
}

#[tauri::command]
pub fn lia_write_file_path(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}
