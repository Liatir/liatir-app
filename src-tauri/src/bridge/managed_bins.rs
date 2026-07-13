use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

// A stalled connection (open but delivering no bytes) must not hang a download
// forever. If no chunk arrives within this window we abort with a clear error;
// the .part file is kept so the user can resume.
const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);

// Keep a safety margin over the reported size so a download cannot fill the
// disk to the last byte (which breaks the OS and other apps mid-write).
pub(crate) const DISK_SPACE_MARGIN_BYTES: u64 = 256 * 1024 * 1024;

/// Find free bytes on the volume that contains `path`, walking up when the final
/// destination has not been created yet.
pub(crate) fn available_space_for_path(path: &Path) -> Option<u64> {
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent()?;
    }
    fs2::available_space(existing).ok()
}

/// Fail fast when the destination volume cannot hold the download. Only enforced
/// when the server reports a size and disk space can be read; otherwise the
/// stall/write paths remain the backstop.
fn ensure_disk_space(dest_path: &str, needed_bytes: u64, already_have: u64) -> Result<(), String> {
    let probe_dir = Path::new(dest_path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let Some(available) = available_space_for_path(&probe_dir) else {
        return Ok(());
    };
    let remaining = needed_bytes.saturating_sub(already_have);
    let required = remaining.saturating_add(DISK_SPACE_MARGIN_BYTES);
    if available < required {
        return Err(format!(
            "Not enough disk space: need ~{} (plus safety margin), only {} free on the destination volume.",
            format_bytes(required),
            format_bytes(available)
        ));
    }
    Ok(())
}

pub(crate) fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

// ── Download registry ─────────────────────────────────────────────

pub struct DownloadRegistry {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadRegistry {
    pub fn new() -> Self {
        Self { active: Mutex::new(HashMap::new()) }
    }

    pub(crate) fn is_active(&self, id: &str) -> bool {
        self.active.lock().unwrap().contains_key(id)
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

pub(crate) fn sha256_of_file(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};

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

    // Preflight: refuse a download the destination volume clearly cannot hold,
    // before writing a single byte, so multi-GB models fail fast and cleanly.
    if let Some(total) = bytes_total {
        ensure_disk_space(dest_path, total, start_bytes)?;
    }

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
    let mut first_chunk = true;

    // Emit initial "connected" progress
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

        // Guard each read with a stall timeout: a hung connection aborts
        // instead of blocking the download (and its UI) indefinitely.
        let next_chunk = match tokio::time::timeout(DOWNLOAD_STALL_TIMEOUT, response.chunk()).await {
            Ok(result) => result,
            Err(_) => {
                // .part kept for resume.
                return Err(format!(
                    "Download stalled: no data for {} seconds. The partial file was kept for resume.",
                    DOWNLOAD_STALL_TIMEOUT.as_secs()
                ));
            }
        };

        match next_chunk {
            Ok(Some(chunk)) => {
                file.write_all(&chunk).map_err(|e| format!("Write error: {e}"))?;
                let chunk_len = chunk.len() as u64;
                bytes_downloaded += chunk_len;
                bytes_since_last_emit += chunk_len;

                let elapsed = last_emit.elapsed();
                // Emit immediately on first chunk, then every 150 ms
                if first_chunk || elapsed.as_millis() >= 150 {
                    let bps = if elapsed.as_secs_f64() > 0.0 {
                        bytes_since_last_emit as f64 / elapsed.as_secs_f64()
                    } else {
                        0.0
                    };
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
                    first_chunk = false;
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

/// Extract a ZIP while rejecting traversal and symbolic-link entries. Runtime
/// boxes use this helper before an atomic activation swap, so no archive entry
/// may escape or redirect writes outside the staging directory.
pub(crate) fn extract_zip(archive_path: &str, dest_dir: &str) -> Result<(), String> {
    extract_zip_with_expected_size(archive_path, dest_dir, None)
}

/// Extract a ZIP and, when provided, reject an unexpected logical payload size
/// before writing the first entry.
pub(crate) fn extract_zip_with_expected_size(
    archive_path: &str,
    dest_dir: &str,
    expected_size: Option<u64>,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let destination = Path::new(dest_dir);

    if let Some(expected) = expected_size {
        let mut declared = 0u64;
        for index in 0..archive.len() {
            declared = declared.saturating_add(archive.by_index(index).map_err(|e| e.to_string())?.size());
        }
        if declared != expected {
            return Err("ZIP payload size does not match the signed Runtime Box release".to_string());
        }
    }

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_symlink() {
            return Err(format!("ZIP symbolic links are not allowed: {}", entry.name()));
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe ZIP entry path: {}", entry.name()))?;
        let out_path = destination.join(enclosed);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            copy_zip_entry_sparse(&mut entry, &mut out_file)?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode & 0o777))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Copy one ZIP entry while representing all-zero regions as sparse file holes.
/// Runtime Boxes remain byte-identical when read, while synthetic or naturally
/// sparse multi-gigabyte files do not consume unnecessary physical storage.
fn copy_zip_entry_sparse<R: Read>(reader: &mut R, output: &mut std::fs::File) -> Result<u64, String> {
    let mut buffer = [0u8; 64 * 1024];
    let mut written = 0u64;
    loop {
        let count = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        if buffer[..count].iter().all(|byte| *byte == 0) {
            output.seek(SeekFrom::Current(count as i64)).map_err(|error| error.to_string())?;
        } else {
            output.write_all(&buffer[..count]).map_err(|error| error.to_string())?;
        }
        written = written.saturating_add(count as u64);
    }
    output.set_len(written).map_err(|error| error.to_string())?;
    Ok(written)
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
