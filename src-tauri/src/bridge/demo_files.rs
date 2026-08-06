use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoFileEntry {
    pub path: String,
    pub folder: String,
}

fn find_demo_resource_dir(app: &AppHandle) -> Option<PathBuf> {
    // Production: resources are bundled adjacent to the binary
    if let Ok(d) = app.path().resource_dir() {
        let p = d.join("demo-files");
        if p.exists() { return Some(p); }
    }
    // Development fallback: files live in src-tauri/resources/demo-files/
    #[cfg(debug_assertions)]
    {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("demo-files");
        if p.exists() { return Some(p); }
    }
    None
}

/// Copy bundled demo files from the resource directory to app_data/demo-files/.
/// Idempotent — skips files that already exist.
/// Returns the list of all demo file paths (existing or just copied).
#[tauri::command]
pub fn lia_init_demo_files(app: AppHandle) -> Result<Vec<DemoFileEntry>, String> {
    let resource_dir = match find_demo_resource_dir(&app) {
        Some(d) => d,
        None => return Ok(vec![]),
    };

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("demo-files");

    if !resource_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<DemoFileEntry> = Vec::new();

    for entry in walkdir::WalkDir::new(&resource_dir).follow_links(false) {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if !entry.file_type().is_file() { continue; }

        let src = entry.path();
        let relative = src.strip_prefix(&resource_dir).map_err(|e| e.to_string())?;

        let dest = data_dir.join(relative);

        // Create parent dirs if needed
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Copy only if not already present (preserve user-untouched files)
        if !dest.exists() {
            std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        }

        // Determine folder label from the subfolder name
        let folder = relative
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .map(|s| format!("Demo Files/{}", capitalize(s)))
            .unwrap_or_else(|| "Demo Files".to_string());

        entries.push(DemoFileEntry {
            path: dest.to_string_lossy().to_string(),
            folder,
        });
    }

    Ok(entries)
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}
