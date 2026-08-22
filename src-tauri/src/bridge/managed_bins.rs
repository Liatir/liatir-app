use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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

/// `true` when a rename failure is a transient Windows lock rather than a permanent error.
///
/// On Windows a rename fails with ERROR_ACCESS_DENIED (5) or ERROR_SHARING_VIOLATION (32) while
/// another handle is still open on the source tree — most often antivirus real-time scanning of
/// freshly written executables, or a child process (such as a just-finished self-test
/// interpreter) whose handles the OS has not released yet. These clear within a moment. Unix does
/// not report these on rename, so this only ever changes behavior on Windows.
fn is_transient_rename_lock(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(5) | Some(32))
        || error.kind() == std::io::ErrorKind::PermissionDenied
}

/// Rename `from` to `to`, retrying briefly on transient Windows sharing violations.
///
/// Activation and rollback move a directory into place immediately after extracting and executing
/// its contents, which is exactly when Windows may still hold a transient lock (see
/// [`is_transient_rename_lock`]). A bounded backoff turns a spurious sharing violation into a
/// reliable move; a genuinely permanent error is returned on the first attempt. On Unix the first
/// rename almost always succeeds, so this is effectively a direct rename there.
pub(crate) fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    const MAX_ATTEMPTS: u32 = 8;
    for attempt in 1..=MAX_ATTEMPTS {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if attempt < MAX_ATTEMPTS && is_transient_rename_lock(&error) => {
                std::thread::sleep(Duration::from_millis((50 * attempt as u64).min(400)));
            }
            Err(error) => return Err(error),
        }
    }
    // The `attempt < MAX_ATTEMPTS` guard forces the final iteration to return.
    unreachable!("rename_with_retry always returns on the last attempt")
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
    rename_with_retry(Path::new(&part_path), Path::new(dest_path))
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

// ── Removal ───────────────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_with_retry_moves_a_directory_tree() {
        let root = std::env::temp_dir().join(format!("liatir-rename-retry-{}", uuid_like()));
        let from = root.join("from");
        let to = root.join("to");
        std::fs::create_dir_all(from.join("nested")).unwrap();
        std::fs::write(from.join("nested").join("file.txt"), b"payload").unwrap();

        rename_with_retry(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(
            std::fs::read_to_string(to.join("nested").join("file.txt")).unwrap(),
            "payload"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rename_with_retry_reports_a_permanent_error_without_looping_forever() {
        let root = std::env::temp_dir().join(format!("liatir-rename-missing-{}", uuid_like()));
        std::fs::create_dir_all(&root).unwrap();
        // A missing source is a permanent error (NotFound, not a transient lock), so it must
        // surface immediately rather than exhaust the retry budget.
        let error = rename_with_retry(&root.join("absent"), &root.join("target")).unwrap_err();
        assert!(!is_transient_rename_lock(&error));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn is_transient_rename_lock_classifies_windows_sharing_violations() {
        assert!(is_transient_rename_lock(&std::io::Error::from_raw_os_error(32)));
        assert!(is_transient_rename_lock(&std::io::Error::from_raw_os_error(5)));
        assert!(is_transient_rename_lock(&std::io::Error::from(
            std::io::ErrorKind::PermissionDenied
        )));
        assert!(!is_transient_rename_lock(&std::io::Error::from(
            std::io::ErrorKind::NotFound
        )));
    }

    // A tiny process/time-seeded unique suffix so parallel test runs never share a temp path,
    // without pulling the uuid crate into this module's test scope.
    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{}-{}", std::process::id(), nanos)
    }
}
