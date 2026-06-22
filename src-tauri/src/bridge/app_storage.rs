//! Isolated, app-managed storage scope.
//!
//! The public `desktop.fs.*` API resolves under `.liatir/.main/data/` and is
//! freely usable by user scripts and .lia modules. App-management state
//! (workspaces, indexes, per-workspace configs, analysis-run metadata, …) must
//! NOT be reachable from there, so it lives in a sibling directory
//! `.liatir/.main/_app/`. Because `safe_join` forbids `..` traversal, code using
//! `desktop.fs.*` cannot escape `data/` into `_app/`.
//!
//! All access goes through the `lia_app_*` commands below.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

/// Root of the isolated app-managed storage: app_data_dir/.liatir/.main/_app
fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(".liatir")
        .join(".main")
        .join("_app");
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(root)
}

/// Legacy public data root where app state used to live: .liatir/.main/data
fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(".liatir")
        .join(".main")
        .join("data"))
}

/// Join base + relative, refusing absolute paths and `..` traversal.
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel == "." {
        return Ok(base.to_path_buf());
    }
    let mut out = PathBuf::from(base);
    let mut depth: isize = 0;
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => {
                out.push(c);
                depth += 1;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if depth > 0 {
                    out.pop();
                    depth -= 1;
                } else {
                    return Err("Path traversal not allowed".into());
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute paths are not allowed".into());
            }
        }
    }
    Ok(out)
}

// ---------------------------------
// Commands
// ---------------------------------

#[tauri::command]
pub fn lia_app_path(app: AppHandle) -> Result<String, String> {
    Ok(app_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn lia_app_exists(app: AppHandle, rel: String) -> Result<bool, String> {
    let p = safe_join(&app_root(&app)?, &rel)?;
    Ok(p.exists())
}

#[tauri::command]
pub fn lia_app_read_text(app: AppHandle, rel: String) -> Result<String, String> {
    let p = safe_join(&app_root(&app)?, &rel)?;
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lia_app_write_text(
    app: AppHandle,
    rel: String,
    content: String,
    create_dirs: Option<bool>,
) -> Result<(), String> {
    let p = safe_join(&app_root(&app)?, &rel)?;
    if create_dirs.unwrap_or(true) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lia_app_mkdir(app: AppHandle, rel: String) -> Result<(), String> {
    let p = safe_join(&app_root(&app)?, &rel)?;
    fs::create_dir_all(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lia_app_remove(app: AppHandle, rel: String, recursive: Option<bool>) -> Result<(), String> {
    let p = safe_join(&app_root(&app)?, &rel)?;
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        if recursive.unwrap_or(false) {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            fs::remove_dir(&p).map_err(|e| e.to_string())
        }
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

// ---------------------------------
// One-time migration from the public data root
// ---------------------------------

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let from = entry.path();
            let to = dst.join(entry.file_name());
            copy_recursive(&from, &to)?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// Copy app-managed state from the old public data root into the isolated `_app`
/// root, once. Non-destructive: originals are left in place (they simply stop
/// being the source of truth). Guarded by a `.migrated` marker.
#[tauri::command]
pub fn lia_app_migrate(app: AppHandle) -> Result<bool, String> {
    let app_root = app_root(&app)?;
    let marker = app_root.join(".migrated");
    if marker.exists() {
        return Ok(false);
    }

    let data_root = data_root(&app)?;

    // App-managed files/dirs. NOT migrated: Results/, tool-outputs/, snpeff*,
    // demo-files/ — those hold user-visible output files referenced by absolute
    // path and must stay under the public data scope.
    const ITEMS: &[&str] = &[
        "workspaces.json",
        "active-workspace.json",
        "data-files.json",
        "pipeline-workspace.json",
        "api-workspace.json",
        "liatir-modules.json",
        "analysis-runs",
        "scripts",
        "workspaces",
    ];

    if data_root.exists() {
        for item in ITEMS {
            let src = data_root.join(item);
            let dst = app_root.join(item);
            if src.exists() && !dst.exists() {
                copy_recursive(&src, &dst).map_err(|e| e.to_string())?;
            }
        }
    }

    fs::write(&marker, b"1").map_err(|e| e.to_string())?;
    Ok(true)
}
