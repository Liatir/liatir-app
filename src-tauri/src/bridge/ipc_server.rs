use std::sync::Arc;

use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
struct InvokeRequest {
    cmd: String,
    payload: Option<Value>,
}

#[derive(Serialize)]
struct InvokeResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct ServerState {
    app: AppHandle,
    token: String,
}

/// Start the local IPC HTTP server. Writes port + auth token to
/// `{app_data_dir}/.ipc` so the Node.js adapter can find it.
pub async fn start(app: AppHandle) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let token = uuid::Uuid::new_v4().to_string();

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("no app data dir: {e}"))?;
    tokio::fs::create_dir_all(&data_dir).await?;
    let port_file = data_dir.join(".ipc");
    tokio::fs::write(
        &port_file,
        serde_json::to_string(&serde_json::json!({ "port": port, "token": token }))?,
    )
    .await?;

    let state = Arc::new(ServerState { app, token });

    let router = Router::new()
        .route("/invoke", post(handle_invoke))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });

    Ok(())
}

async fn handle_invoke(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(req): Json<InvokeRequest>,
) -> (StatusCode, Json<InvokeResponse>) {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    if auth != Some(state.token.as_str()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(InvokeResponse {
                ok: false,
                result: None,
                error: Some("unauthorized".into()),
            }),
        );
    }

    match dispatch(&state.app, &req.cmd, req.payload.unwrap_or(Value::Null)).await {
        Ok(result) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: false,
                result: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch(app: &AppHandle, cmd: &str, payload: Value) -> anyhow::Result<Value> {
    match cmd {
        "lia_jobs_spawn" => {
            let cmd_str = payload["cmd"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("cmd required"))?
                .to_string();
            let args: Vec<String> = payload["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let cwd = payload["cwd"].as_str().map(String::from);
            let workspace_id = payload["workspaceId"].as_str().map(String::from);

            let result = crate::bridge::jobs::lia_jobs_spawn(app.clone(), cmd_str, args, cwd, workspace_id)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(result)
        }

        "lia_jobs_kill" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            let ok = crate::bridge::jobs::lia_jobs_kill(app.clone(), job_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::json!(ok))
        }

        "lia_jobs_status" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            let entry = crate::bridge::jobs::lia_jobs_status(app.clone(), job_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(entry)?)
        }

        "lia_jobs_list" => {
            let workspace_id = payload["workspaceId"].as_str().map(String::from);
            let list = crate::bridge::jobs::lia_jobs_list(app.clone(), workspace_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(list)?)
        }

        "lia_jobs_get_output" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            let since = payload["since"].as_u64().map(|n| n as usize);
            let output = crate::bridge::jobs::lia_jobs_get_output(app.clone(), job_id, since)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(output)
        }

        "lia_deps_check" => {
            let name = payload["name"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("name required"))?
                .to_string();
            let result = crate::bridge::deps::lia_deps_check(name)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(result)
        }

        "lia_deps_check_many" => {
            let names: Vec<String> = payload["names"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .ok_or_else(|| anyhow::anyhow!("names required"))?;
            let result = crate::bridge::deps::lia_deps_check_many(names)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_fs_paths" => {
            let result = crate::bridge::fs::lia_fs_paths(app.clone())
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_liatir_read_manifest" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            crate::bridge::modules::lia_liatir_read_manifest(path)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        "lia_liatir_run" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let inputs = payload["inputs"].clone();
            crate::bridge::modules::lia_liatir_run(app.clone(), path, inputs)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        "lia_read_file_text" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let text = crate::bridge::managed_bins::lia_read_file_text(path)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(Value::String(text))
        }

        "lia_preview_file" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let lines = payload["lines"].as_u64().unwrap_or(50) as usize;
            let text = crate::bridge::managed_bins::lia_preview_file(path, lines)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(Value::String(text))
        }

        // ── Native bio tools ─────────────────────────────────────────────
        // Exposed to .lia Modules so the typed bio wrappers in `@liatir/sdk`
        // (Liatir.align.*, Liatir.variants.*, …) can call the SAME native
        // commands the desktop UI uses — reusing reference auto-indexing,
        // output redirection and stat parsing instead of re-implementing them.

        // BWA-MEM — short-read alignment → SAM. Auto-indexes the reference on first use.
        "lia_bwa_mem" => {
            let reference = payload["reference"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("reference required"))?
                .to_string();
            let reads_r1 = payload["readsR1"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("readsR1 required"))?
                .to_string();
            // Optional second mate for paired-end reads.
            let reads_r2 = payload["readsR2"].as_str().map(String::from);
            let output_sam = payload["outputSam"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputSam required"))?
                .to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            crate::bridge::bwa::lia_bwa_mem(app.clone(), reference, reads_r1, reads_r2, output_sam, job_id)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        // minimap2 — long/short-read alignment → SAM. `preset` picks the mode (sr, lr, map-ont, …).
        "lia_minimap2" => {
            let preset = payload["preset"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("preset required"))?
                .to_string();
            let reference = payload["reference"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("reference required"))?
                .to_string();
            let reads_r1 = payload["readsR1"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("readsR1 required"))?
                .to_string();
            let reads_r2 = payload["readsR2"].as_str().map(String::from);
            let output_sam = payload["outputSam"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputSam required"))?
                .to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            crate::bridge::minimap2::lia_minimap2(app.clone(), preset, reference, reads_r1, reads_r2, output_sam, job_id)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        // SnpEff — functional variant annotation (VCF → annotated VCF + stats). Needs a configured JAR.
        "lia_snpeff_annotate" => {
            let jar_path = payload["jarPath"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jarPath required"))?
                .to_string();
            let genome = payload["genome"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("genome required"))?
                .to_string();
            let data_dir = payload["dataDir"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("dataDir required"))?
                .to_string();
            let input_vcf = payload["inputVcf"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("inputVcf required"))?
                .to_string();
            let output_vcf = payload["outputVcf"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputVcf required"))?
                .to_string();
            // JVM heap (e.g. "4g"); falls back to a sane default if omitted.
            let heap = payload["heap"].as_str().unwrap_or("4g").to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            // Optional explicit java binary; None lets the command resolve it.
            let java_path = payload["javaPath"].as_str().map(String::from);
            crate::bridge::snpeff::lia_snpeff_annotate(
                app.clone(), jar_path, genome, data_dir, input_vcf, output_vcf, heap, job_id, java_path,
            )
            .await
            .map_err(|e| anyhow::anyhow!(e))
        }

        _ => Err(anyhow::anyhow!("unknown command: {cmd}")),
    }
}
