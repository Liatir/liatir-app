use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Result of saving a module output file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFileEntry {
    /// Absolute path of the written file.
    pub path: String,
    /// Virtual folder label used by the Data/Results view (e.g. "Results/MyModule").
    pub virtual_folder: String,
    /// Detected file extension (lowercase).
    pub ext: String,
}

/// Base data dir: app_data_dir/.liatir/.main/data
fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(".liatir")
        .join(".main")
        .join("data");
    Ok(base)
}

/// Sanitize a single path segment: no separators, no traversal, no empties.
fn safe_segment(seg: &str) -> Result<String, String> {
    let clean = seg.trim();
    if clean.is_empty() || clean == "." || clean == ".." {
        return Err(format!("invalid name segment: {seg:?}"));
    }
    if clean.contains('/') || clean.contains('\\') || clean.contains(std::path::is_separator) {
        return Err(format!("name segment may not contain path separators: {seg:?}"));
    }
    Ok(clean.to_string())
}

/// Sanitize a folder-name from a module label (keep it readable but safe).
fn safe_module_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().replace(' ', "-");
    if cleaned.is_empty() { "module".to_string() } else { cleaned }
}

/// Validate that an optional workspace prefix only contains safe components
/// (e.g. "workspaces/<id>/"). Returns the cleaned relative prefix path.
fn safe_prefix(prefix: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for comp in Path::new(prefix).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return Err("invalid workspace prefix".into()),
        }
    }
    Ok(out)
}

fn detect_ext(name: &str) -> String {
    let lower = name.to_lowercase();
    for multi in ["fastq.gz", "fq.gz", "fasta.gz", "fa.gz", "vcf.gz", "bcf.gz"] {
        if lower.ends_with(&format!(".{multi}")) {
            return multi.to_string();
        }
    }
    Path::new(&lower)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string()
}

/// Save a file produced by a .lia module under the workspace-scoped, module-relative
/// `Results/<module>/` folder so it appears in Results exactly like a tool output.
///
/// - `content` is written as UTF-8 text, or decoded from base64 when `is_base64` is true.
/// - `workspace_prefix` is the active workspace's data prefix (e.g. "workspaces/<id>/")
///   or empty/None for the default scope.
#[tauri::command]
pub fn lia_module_save_output(
    app: AppHandle,
    module: String,
    file_name: String,
    content: String,
    is_base64: Option<bool>,
    workspace_prefix: Option<String>,
) -> Result<ModuleFileEntry, String> {
    let safe_module = safe_module_name(&module);
    let safe_file = safe_segment(&file_name)?;

    let prefix = safe_prefix(workspace_prefix.as_deref().unwrap_or(""))?;
    let dir = data_root(&app)?
        .join(&prefix)
        .join("Results")
        .join(&safe_module);

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&safe_file);

    if is_base64.unwrap_or(false) {
        let bytes = general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|e| format!("base64 decode failed: {e}"))?;
        std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    } else {
        std::fs::write(&dest, content.as_bytes()).map_err(|e| e.to_string())?;
    }

    Ok(ModuleFileEntry {
        path: dest.to_string_lossy().to_string(),
        virtual_folder: format!("Results/{safe_module}"),
        ext: detect_ext(&safe_file),
    })
}

/// Delete a file previously saved by a .lia module. The path MUST live inside the
/// app data dir (`.liatir/.main/data`) — arbitrary deletes are rejected.
#[tauri::command]
pub fn lia_module_delete_output(app: AppHandle, path: String) -> Result<(), String> {
    let root = data_root(&app)?;
    let target = PathBuf::from(&path);

    // Canonicalize the root; the target may not exist after deletion attempts,
    // so compare against the (lexical) path prefix instead.
    let root_canon = std::fs::canonicalize(&root).unwrap_or(root);
    let target_canon = std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());

    if !target_canon.starts_with(&root_canon) {
        return Err("refusing to delete a file outside the app data directory".into());
    }

    if target_canon.exists() {
        std::fs::remove_file(&target_canon).map_err(|e| e.to_string())?;
    }
    Ok(())
}
