use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}};
use base64::{engine::general_purpose, Engine as _};

const MAX_WEBVIEW_BINARY_READ_BYTES: u64 = 268_435_456;

#[derive(Serialize)]
pub struct OpenResult { pub paths: Vec<String> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
  pub size_bytes: u64,
  pub sha256: String,
  /** First eight bytes, lowercase hex. Enough to identify container signatures without loading the file. */
  pub prefix_hex: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBase64 {
  pub size_bytes: u64,
  pub data_base64: String,
}

fn read_file_base64(path: &str, max_bytes: u64) -> Result<FileBase64, String> {
  if max_bytes == 0 || max_bytes > MAX_WEBVIEW_BINARY_READ_BYTES {
    return Err(format!("Binary viewer reads must be between 1 byte and {MAX_WEBVIEW_BINARY_READ_BYTES} bytes"));
  }
  let file = fs::File::open(path).map_err(|error| error.to_string())?;
  let expected_size = file.metadata().map_err(|error| error.to_string())?.len();
  if expected_size > max_bytes {
    return Err(format!("The file is too large for interactive playback ({expected_size} bytes; limit {max_bytes})"));
  }
  // Read through a hard limit as well as checking metadata: the file may be a simulation output
  // that is still growing, and a concurrent append must not bypass the webview memory bound.
  let mut bytes = Vec::with_capacity(expected_size as usize);
  file.take(max_bytes + 1)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  if bytes.len() as u64 > max_bytes {
    return Err(format!("The file grew beyond the interactive playback limit of {max_bytes} bytes"));
  }
  Ok(FileBase64 {
    size_bytes: bytes.len() as u64,
    data_base64: general_purpose::STANDARD.encode(bytes),
  })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRangeBase64 {
  /// The whole file's size: a byte-range answer has to state it.
  pub total_bytes: u64,
  pub data_base64: String,
}

/// Reads `length` bytes from `offset`, or the rest of the file when `length` is absent. Viewers that
/// seek into an indexed file (BAM, tabix VCF) read only the region on screen through this; a read
/// past the end is empty rather than an error, as an HTTP server would answer it.
fn read_file_range_base64(path: &str, offset: u64, length: Option<u64>) -> Result<FileRangeBase64, String> {
  let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
  let total_bytes = file.metadata().map_err(|error| error.to_string())?.len();
  let start = offset.min(total_bytes);
  let wanted = length.unwrap_or(total_bytes - start).min(total_bytes - start);
  if wanted > MAX_WEBVIEW_BINARY_READ_BYTES {
    return Err(format!(
      "This read is too large for the viewer ({wanted} bytes; limit {MAX_WEBVIEW_BINARY_READ_BYTES}). Index the file so only the region on screen is read."
    ));
  }
  file.seek(SeekFrom::Start(start)).map_err(|error| error.to_string())?;
  let mut bytes = Vec::with_capacity(wanted as usize);
  file.take(wanted).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
  Ok(FileRangeBase64 { total_bytes, data_base64: general_purpose::STANDARD.encode(bytes) })
}

fn inspect_file_identity(path: &str) -> Result<FileIdentity, String> {
  let mut file = fs::File::open(path).map_err(|e| format!("Could not open file for inspection: {e}"))?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 65_536];
  let mut prefix = Vec::with_capacity(8);
  let mut size_bytes = 0u64;

  loop {
    let read = file.read(&mut buffer).map_err(|e| format!("Could not inspect file: {e}"))?;
    if read == 0 { break; }
    if prefix.len() < 8 {
      let take = (8 - prefix.len()).min(read);
      prefix.extend_from_slice(&buffer[..take]);
    }
    size_bytes = size_bytes.checked_add(read as u64)
      .ok_or_else(|| "File size overflow while inspecting artifact".to_string())?;
    hasher.update(&buffer[..read]);
  }

  Ok(FileIdentity {
    size_bytes,
    sha256: format!("{:x}", hasher.finalize()),
    prefix_hex: prefix.iter().map(|byte| format!("{byte:02x}")).collect(),
  })
}

/// Stream a local file once to establish its stable content identity and container signature.
#[tauri::command]
pub async fn lia_file_identity(_app: AppHandle, path: String) -> Result<FileIdentity, String> {
  tauri::async_runtime::spawn_blocking(move || inspect_file_identity(&path))
    .await
    .map_err(|e| format!("File inspection task failed: {e}"))?
}

/// Bounded binary read used only after a user asks to load an interactive Result viewer.
#[tauri::command]
pub async fn lia_file_read_base64(
  _app: AppHandle,
  path: String,
  max_bytes: u64,
) -> Result<FileBase64, String> {
  tauri::async_runtime::spawn_blocking(move || read_file_base64(&path, max_bytes))
  .await
  .map_err(|error| error.to_string())?
}

/// Bounded byte-range read for a sandboxed viewer, which cannot fetch local files itself.
#[tauri::command]
pub async fn lia_file_read_range(
  _app: AppHandle,
  path: String,
  offset: u64,
  length: Option<u64>,
) -> Result<FileRangeBase64, String> {
  tauri::async_runtime::spawn_blocking(move || read_file_range_base64(&path, offset, length))
  .await
  .map_err(|error| error.to_string())?
}

fn file_path_to_string(p: FilePath) -> String {
  match p {
    FilePath::Path(pb) => pb.to_string_lossy().to_string(),
    FilePath::Url(u)   => u.to_string(),
  }
}


fn is_local_path(s: &str) -> bool {
  !(s.starts_with("http://") || s.starts_with("https://") || s.starts_with("file://"))
}

fn within_size_cap(pb: &PathBuf, max_bytes: Option<u64>) -> bool {
  if let Some(cap) = max_bytes {
    if let Ok(meta) = fs::metadata(pb) {
      return meta.len() <= cap;
    }
    return false; // if we can't stat, treat as not allowed under cap
  }
  true
}

fn normalize_extension(ext: &str) -> String {
  ext.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn cleaned_extensions(exts: &[String]) -> Vec<String> {
  exts.iter()
    .map(|e| normalize_extension(e))
    .filter(|e| !e.is_empty())
    .collect()
}

fn path_matches_allowed_extensions(path: &Path, allowed_extensions: &[String]) -> bool {
  if allowed_extensions.is_empty() { return true; }

  let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
    return false;
  };
  let file_name = file_name.to_ascii_lowercase();

  allowed_extensions.iter().any(|ext| file_name.ends_with(&format!(".{ext}")))
}

#[tauri::command]
pub async fn lia_file_open(
  app: AppHandle,
  multi: bool,
  allowed_extensions: Option<Vec<String>>,
  max_bytes: Option<u64>
) -> Result<OpenResult, String> {
  let handle = app.clone();

  // Show the blocking system dialog off the async runtime thread, then return
  // the selected paths as strings.
  let (picked_paths, exts) = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Select file(s)");
    if let Some(exts) = allowed_extensions.as_ref() {
      let cleaned = cleaned_extensions(exts);
      let refs: Vec<&str> = cleaned.iter().map(|s| s.as_str()).collect();
      builder = builder.add_filter("Allowed", &refs);
    }

    let picked_paths: Vec<String> = if multi {
      match builder.blocking_pick_files() {
        Some(list) => list.into_iter().map(file_path_to_string).collect::<Vec<_>>(),
        None => Vec::new(),
      }
    } else {
      match builder.blocking_pick_file() {
        Some(p) => vec![file_path_to_string(p)],
        None => Vec::new(),
      }
    };

    (picked_paths, allowed_extensions)
  })
  .await
  .map_err(|e| format!("Join error: {e}"))?;

  // Enforce extension and size constraints on local paths even if the platform
  // dialog allows manual filename entry or does not understand multipart
  // extensions such as ".fastq.gz".
  let mut filtered: Vec<String> = Vec::with_capacity(picked_paths.len());
  let cleaned_exts = exts.as_ref().map(|list| cleaned_extensions(list));
  for p in picked_paths {
    if is_local_path(&p) {
      let pb = PathBuf::from(&p);
      if let Some(ext_list) = &cleaned_exts {
        if !path_matches_allowed_extensions(&pb, ext_list) { continue; }
      }
      if !within_size_cap(&pb, max_bytes) { continue; }
    }
    filtered.push(p);
  }

  Ok(OpenResult { paths: filtered })
}

#[derive(Serialize)]
pub struct FileWithBytes {
  pub path: String,
  pub bytes: Vec<u8>,
}

#[derive(Serialize)]
pub struct OpenWithBytesResult {
  pub files: Vec<FileWithBytes>,
}

/// Open one or more local files, optionally enforce allowed extensions, and
/// return their bytes. Files over the optional size cap are skipped.
#[tauri::command]
pub async fn lia_file_open_with_bytes(
  app: AppHandle,
  multi: bool,
  allowed_extensions: Option<Vec<String>>,
  max_bytes: Option<u64>,
) -> Result<OpenWithBytesResult, String> {
  let handle = app.clone();

  // Show the blocking system dialog off the async runtime thread.
  let (paths, exts) = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Select file(s)");

    if let Some(exts) = allowed_extensions.as_ref() {
      let cleaned = cleaned_extensions(exts);
      let refs: Vec<&str> = cleaned.iter().map(|s| s.as_str()).collect();
      builder = builder.add_filter("Allowed", &refs);
    }

    let picked: Vec<String> = if multi {
      builder.blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(file_path_to_string)
        .collect()
    } else {
      builder.blocking_pick_file()
        .map(file_path_to_string)
        .into_iter()
        .collect()
    };

    (picked, allowed_extensions)
  })
  .await
  .map_err(|e| format!("Join error: {e}"))?;

  // Read file contents and enforce size/extension constraints in the backend.
  let mut out: Vec<FileWithBytes> = Vec::new();
  let cleaned_exts = exts.as_ref().map(|list| cleaned_extensions(list));

  'next: for p in paths {
    if !is_local_path(&p) { continue; }

    let pb = PathBuf::from(&p);

    if let Some(ext_list) = &cleaned_exts {
      if !path_matches_allowed_extensions(&pb, ext_list) { continue 'next; }
    }

    if !within_size_cap(&pb, max_bytes) { continue; }

    match fs::read(&pb) {
      Ok(bytes) => out.push(FileWithBytes { path: p, bytes }),
      Err(_) => { /* skip unreadable files */ }
    }
  }

  Ok(OpenWithBytesResult { files: out })
}

#[tauri::command]
pub async fn lia_file_save(app: AppHandle, default_name: Option<String>) -> Result<String, String> {
  let handle = app.clone();

  let saved = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Save As");
    if let Some(name) = default_name.as_deref() {
      builder = builder.set_file_name(name);
    }
    builder.blocking_save_file().map(file_path_to_string).unwrap_or_default()
  })
  .await
  .map_err(|e| format!("Join error: {e}"))?;

  Ok(saved)
}

#[cfg(test)]
mod tests {
  use super::{inspect_file_identity, read_file_base64, read_file_range_base64};
  use std::{fs, path::PathBuf};

  #[test]
  fn file_identity_streams_size_digest_and_signature() {
    let mut path = PathBuf::from(std::env::temp_dir());
    path.push(format!("liatir-file-identity-{}.h5ad", std::process::id()));
    let contents = b"\x89HDF\r\n\x1a\nfixture";
    fs::write(&path, contents).expect("write fixture");

    let identity = inspect_file_identity(path.to_str().expect("utf8 path")).expect("inspect fixture");
    assert_eq!(identity.size_bytes, contents.len() as u64);
    assert_eq!(identity.prefix_hex, "894844460d0a1a0a");
    assert_eq!(
      identity.sha256,
      "49c125f35c8cf401e1ec1e7739825d788afb0d361d5906d18d0df6bcf2de4bd2",
    );

    let _ = fs::remove_file(path);
  }

  #[test]
  fn binary_viewer_read_is_bounded_and_base64_encoded() {
    let mut path = PathBuf::from(std::env::temp_dir());
    path.push(format!("liatir-binary-viewer-{}.dcd", std::process::id()));
    fs::write(&path, [0_u8, 1, 2, 255]).expect("write fixture");
    let path = path.to_str().expect("utf8 path");
    assert_eq!(read_file_base64(path, 4).expect("read fixture").data_base64, "AAEC/w==");
    assert!(read_file_base64(path, 3).unwrap_err().contains("too large"));
    let _ = fs::remove_file(path);
  }

  #[test]
  fn range_read_returns_the_slice_and_the_whole_size() {
    let mut path = PathBuf::from(std::env::temp_dir());
    path.push(format!("liatir-range-read-{}.bam", std::process::id()));
    fs::write(&path, [0_u8, 1, 2, 255]).expect("write fixture");
    let path = path.to_str().expect("utf8 path");
    let middle = read_file_range_base64(path, 1, Some(2)).expect("read middle");
    assert_eq!((middle.total_bytes, middle.data_base64.as_str()), (4, "AQI="));
    assert_eq!(read_file_range_base64(path, 2, None).expect("read tail").data_base64, "Av8=");
    assert_eq!(read_file_range_base64(path, 3, Some(10)).expect("read clipped").data_base64, "/w==");
    assert_eq!(read_file_range_base64(path, 9, Some(1)).expect("read past end").data_base64, "");
    let _ = fs::remove_file(path);
  }
}
