use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};

#[derive(Serialize)]
pub struct OpenResult { pub paths: Vec<String> }

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
