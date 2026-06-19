use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Run `bwa mem` with stdout streamed directly to disk.
/// Emits `jobs:stderr:{job_id}` events for live terminal display.
#[tauri::command]
pub async fn lia_bwa_mem(
    app: AppHandle,
    reference: String,
    reads_r1: String,
    reads_r2: Option<String>,
    output_sam: String,
    job_id: String,
) -> Result<serde_json::Value, String> {
    if let Some(parent) = Path::new(&output_sam).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create output dir: {e}"))?;
    }

    tauri::async_runtime::spawn_blocking(move || {
        use std::fs::File;
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        // Auto-index reference if index files don't exist
        if !Path::new(&format!("{reference}.amb")).exists() {
            let _ = app.emit(&format!("jobs:stderr:{job_id}"), "[liatir] Indexing reference (first use)…".to_string());
            let idx = Command::new("bwa")
                .args(["index", &reference])
                .stderr(Stdio::piped())
                .status()
                .map_err(|e| format!("failed to run bwa index: {e}"))?;
            if !idx.success() {
                return Err("bwa index failed".to_string());
            }
            let _ = app.emit(&format!("jobs:stderr:{job_id}"), "[liatir] Index complete.".to_string());
        }

        let out_file = File::create(&output_sam)
            .map_err(|e| format!("cannot create output file: {e}"))?;

        let mut args = vec![
            "mem".to_string(),
            reference,
            reads_r1,
        ];
        if let Some(r2) = reads_r2 {
            args.push(r2);
        }

        let mut child = Command::new("bwa")
            .args(&args)
            // OS-level redirect — SAM bytes go straight to disk, never through Rust
            .stdout(out_file)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn bwa: {e}"))?;

        let stderr = child.stderr.take()
            .ok_or_else(|| "failed to capture stderr".to_string())?;

        let mut stderr_lines: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(l) => {
                    if stderr_lines.len() < 2000 {
                        stderr_lines.push(l.clone());
                    }
                    let _ = app.emit(&format!("jobs:stderr:{job_id}"), l);
                }
                Err(_) => break,
            }
        }

        let status = child.wait().map_err(|e| format!("wait error: {e}"))?;
        let exit_code = status.code();
        let ok = exit_code.map(|c| c == 0).unwrap_or(false);

        Ok::<serde_json::Value, String>(serde_json::json!({
            "ok": ok,
            "exitCode": exit_code,
            "stderr": stderr_lines,
        }))
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}
