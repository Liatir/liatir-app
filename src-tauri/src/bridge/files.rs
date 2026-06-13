use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use serde::Serialize;
use std::{fs, path::PathBuf};

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

#[tauri::command]
pub async fn dtr_file_open(
  app: AppHandle,
  multi: bool,
  allowed_extensions: Option<Vec<String>>,
  max_bytes: Option<u64>
) -> Result<OpenResult, String> {
  // Cloniamo ciò che serve nel task bloccante
  let handle = app.clone();

  // 1) Mostra dialog e raccoglie i percorsi selezionati (come stringhe)
  let (picked_paths, exts) = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Select file(s)");
    if let Some(exts) = allowed_extensions.as_ref() {
      let cleaned: Vec<String> = exts.iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .collect();
      let refs: Vec<&str> = cleaned.iter().map(|s| s.as_str()).collect();
      builder = builder.add_filter("Allowed", &refs);
    }

    let picked_paths: Vec<String> = if multi {
      // Option<Vec<FilePath>>
      match builder.blocking_pick_files() {
        Some(list) => list.into_iter().map(file_path_to_string).collect::<Vec<_>>(),
        None => Vec::new(),
      }
    } else {
      // Option<FilePath> -> Vec<String>
      match builder.blocking_pick_file() {
        Some(p) => vec![file_path_to_string(p)],
        None => Vec::new(),
      }
    };

    (picked_paths, allowed_extensions)
  })
  .await
  .map_err(|e| format!("Join error: {e}"))?; // errore nel thread pool

  // 2) Applica il filtro di size cap su file locali
  let mut filtered: Vec<String> = Vec::with_capacity(picked_paths.len());
  for p in picked_paths {
    if is_local_path(&p) {
      let pb = PathBuf::from(&p);
      // Check extension backend enforcement
      if let Some(ext_list) = &exts {
        match pb.extension().and_then(|s| s.to_str()) {
          Some(ext) => {
            let ok = ext_list.iter().any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(ext));
            if !ok { continue; }
          }
          None => continue,
        }
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

/// Apre uno o più file, opzionalmente limita le estensioni selezionabili, e ritorna i contenuti come bytes.
/// Applica anche un size cap opzionale (in bytes); i file che eccedono il cap vengono ignorati.
#[tauri::command]
pub async fn dtr_file_open_with_bytes(
  app: AppHandle,
  multi: bool,
  allowed_extensions: Option<Vec<String>>,
  max_bytes: Option<u64>,
) -> Result<OpenWithBytesResult, String> {
  let handle = app.clone();

  // 1) Dialog di selezione con filtro opzionale di estensioni
  let (paths, exts) = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Select file(s)");

    if let Some(exts) = allowed_extensions.as_ref() {
      let cleaned: Vec<String> = exts.iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .collect();
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

  // 2) Lettura contenuti e enforcement size/estensioni lato backend
  let mut out: Vec<FileWithBytes> = Vec::new();

  'next: for p in paths {
    // Salta URL remoti: trattiamo solo path locali
    if !is_local_path(&p) { continue; }

    let pb = PathBuf::from(&p);

    // Enforcement estensioni lato backend (se fornito)
    if let Some(ext_list) = &exts {
      match pb.extension().and_then(|s| s.to_str()) {
        Some(ext) => {
          let ok = ext_list.iter().any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(ext));
          if !ok { continue 'next; }
        }
        None => continue 'next,
      }
    }

    // Size cap
    if !within_size_cap(&pb, max_bytes) { continue; }

    match fs::read(&pb) {
      Ok(bytes) => out.push(FileWithBytes { path: p, bytes }),
      Err(_) => { /* ignora file non leggibili */ }
    }
  }

  Ok(OpenWithBytesResult { files: out })
}

#[tauri::command]
pub async fn dtr_file_save(app: AppHandle, default_name: Option<String>) -> Result<String, String> {
  let handle = app.clone();

  let saved = tauri::async_runtime::spawn_blocking(move || {
    let mut builder = handle.dialog().file().set_title("Save As");
    if let Some(name) = default_name.as_deref() {
      builder = builder.set_file_name(name);
    }
    // Option<FilePath> -> String (vuota se cancel)
    builder.blocking_save_file().map(file_path_to_string).unwrap_or_default()
  })
  .await
  .map_err(|e| format!("Join error: {e}"))?;

  Ok(saved)
}
