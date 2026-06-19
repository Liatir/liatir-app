use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Run `minimap2 -ax <preset>` with stdout streamed directly to disk.
/// Emits `jobs:stderr:{job_id}` events for live terminal display.
#[tauri::command]
pub async fn lia_minimap2(
    app: AppHandle,
    preset: String,
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

        let out_file = File::create(&output_sam)
            .map_err(|e| format!("cannot create output file: {e}"))?;

        // -ax: output SAM instead of default PAF
        let mut args = vec![
            "-ax".to_string(),
            preset,
            reference,
            reads_r1,
        ];
        if let Some(r2) = reads_r2 {
            args.push(r2);
        }

        let mut child = Command::new("minimap2")
            .args(&args)
            // OS-level redirect — SAM bytes go straight to disk, never through Rust
            .stdout(out_file)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn minimap2: {e}"))?;

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
