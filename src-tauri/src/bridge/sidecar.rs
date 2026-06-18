use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

// ---------------------------------
// Types
// ---------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

// ---------------------------------
// Public Tauri commands
// ---------------------------------

/// Run a registered sidecar binary and capture its stdout/stderr.
///
/// The sidecar `name` must be listed in `bundle.externalBin` inside
/// tauri.conf.json (without platform suffix — Tauri appends it at build time).
///
/// # TODO: register real bio sidecars in tauri.conf.json, e.g.:
///   "bundle": { "externalBin": ["binaries/samtools", "binaries/minimap2"] }
///
/// Each sidecar must also be declared in the shell allowlist inside the
/// relevant capability file, e.g. liatir-bridge.toml:
///   [[permission]]
///   identifier = "shell:allow-execute"
///
/// # Current registered sidecars (none — add as needed):
///   (empty — this is the scaffolding entry point)
#[tauri::command]
pub async fn lia_sidecar_run(
    app: AppHandle,
    // Name matches the key in bundle.externalBin (no platform suffix).
    // TODO: restrict to an allowlist of known bio tool names once real
    //       sidecars are bundled (e.g. "samtools", "minimap2", "bwa").
    name: String,
    args: Vec<String>,
) -> Result<SidecarResult, String> {
    let started = Instant::now();

    // Validate name is a simple identifier — no path traversal.
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err(format!("invalid sidecar name: {name:?}"));
    }

    let shell = app.shell();

    let output = shell
        .sidecar(&name)
        .map_err(|e| format!("sidecar '{name}' not found or not configured: {e}"))?
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("sidecar '{name}' execution failed: {e}"))?;

    let duration_ms = started.elapsed().as_millis() as u64;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();
    let ok = output.status.success();

    Ok(SidecarResult {
        ok,
        stdout,
        stderr,
        exit_code,
        error: if ok { None } else { Some(format!("exit code: {exit_code:?}")) },
        duration_ms,
    })
}
