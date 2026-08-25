//! Tauri commands for signed Runtime Components and AI Model execution.
//!
//! Runtime installation and removal live in [`super::runtime_boxes`]. This module inspects an
//! activated box and runs its Python entry points without modifying the environment locally.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::ai_hardware::{nvidia_capability, total_memory_bytes};
use super::python_env::{
    run_in_env, spawn_in_env, status_env, PythonEnvPackage, PythonRunResult,
};
use super::runtime_boxes::{
    runtime_box_activation_metadata,
    runtime_box_activation_metadata_for_component,
    runtime_component_update_status,
    RuntimeComponentKind,
    RuntimeComponentUpdateRequest,
    RuntimeComponentUpdateStatus,
};

/// Environment root passed to every `python_env` call, i.e. `<data root>/ai-runtimes/<runtime id>`.
const AI_PYTHON_ENV_ROOT: &str = "ai-runtimes";

// AI-facing names for the generic execution contracts. These are aliases, not copies.
pub type AiRuntimePackage = PythonEnvPackage;
pub type AiPythonRunResult = PythonRunResult;

/// What the machine can offer, used by the UI to tell the user which models are realistic
/// to run locally before they commit to a multi-gigabyte download.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHardwareInfo {
    pub os: String,
    pub arch: String,
    pub cpu_cores: usize,
    /// `None` when the platform has no probe implemented (see [`total_memory_bytes`]).
    pub total_memory_bytes: Option<u64>,
    pub apple_metal: bool,
    /// `Some(true)` when `nvidia-smi` is on PATH, otherwise `None` — never `Some(false)`,
    /// because a missing tool proves nothing about the absence of a GPU.
    pub cuda_available: Option<bool>,
    /// Exact NVIDIA driver reported by the same probe used by Runtime Box selection.
    pub nvidia_driver_version: Option<String>,
}

/// Whether a runtime is ready to use, and if not, precisely what it is missing — so the UI can
/// say "install 2 packages" instead of just "not installed".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeStatus {
    pub runtime_id: String,
    pub runtime_dir: String,
    pub python_path: Option<String>,
    pub installed: bool,
    pub missing_packages: Vec<String>,
    /// Set when the environment could not be inspected at all (as opposed to being incomplete).
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponentStatus {
    pub component_kind: RuntimeComponentKind,
    pub runtime_id: String,
    pub runtime_dir: String,
    pub python_path: Option<String>,
    pub installed: bool,
    pub missing_packages: Vec<String>,
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
    pub activation: Option<Value>,
    pub update: Option<RuntimeComponentUpdateStatus>,
}

/// Probes the host facts used to select a compatible Runtime Box target.
#[tauri::command]
pub fn lia_ai_hardware_info() -> Result<AiHardwareInfo, String> {
    let nvidia = nvidia_capability();

    Ok(AiHardwareInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        // available_parallelism can fail in restricted environments; assume a single core
        // rather than reporting zero, which callers would likely divide by.
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        total_memory_bytes: total_memory_bytes(),
        // Every Mac Liatir supports has Metal, so this is a build-time fact, not a probe.
        apple_metal: cfg!(target_os = "macos"),
        cuda_available: nvidia.as_ref().map(|_| true),
        nvidia_driver_version: nvidia.map(|capability| capability.driver_version),
    })
}

/// Reports whether a runtime exists and is complete for the given package set.
///
/// Inspection walks the venv and shells out, which is blocking work; `spawn_blocking` keeps it
/// off the async runtime so the UI stays responsive. The same pattern is used by every command
/// below except [`lia_ai_python_spawn`], which is natively async.
#[tauri::command]
pub async fn lia_runtime_box_status(
    app: AppHandle,
    component_kind: RuntimeComponentKind,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
    update: Option<RuntimeComponentUpdateRequest>,
) -> Result<RuntimeComponentStatus, String> {
    runtime_component_status(app, component_kind, runtime_id, packages, update).await
}

async fn runtime_component_status(
    app: AppHandle,
    component_kind: RuntimeComponentKind,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
    update: Option<RuntimeComponentUpdateRequest>,
) -> Result<RuntimeComponentStatus, String> {
    // Cloned because the closure moves it, while the original is needed to build the response.
    let runtime_id_for_task = runtime_id.clone();
    let app_for_task = app.clone();
    let mut status = tauri::async_runtime::spawn_blocking(move || {
        status_env(
            app_for_task,
            component_kind.runtime_root().to_string(),
            runtime_id_for_task,
            packages,
            Vec::new(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let activation = match runtime_box_activation_metadata_for_component(
        &app,
        component_kind,
        &runtime_id,
    ) {
        Ok(value) => value,
        Err(error) => {
            status.installed = false;
            status.error = Some(error);
            None
        }
    };
    let update = if status.installed && status.error.is_none() {
        match update {
            Some(request) => Some(
                runtime_component_update_status(&app, component_kind, &runtime_id, request).await?,
            ),
            None => None,
        }
    } else {
        None
    };
    Ok(RuntimeComponentStatus {
        component_kind,
        runtime_id,
        runtime_dir: status.env_dir,
        python_path: status.python_path,
        installed: status.installed,
        missing_packages: status.missing_packages,
        error: status.error,
        size_bytes: status.size_bytes,
        activation,
        update,
    })
}

/// Compatibility command for existing AI Model callers; it performs no network update check.
#[tauri::command]
pub async fn lia_ai_runtime_status(
    app: AppHandle,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
) -> Result<AiRuntimeStatus, String> {
    let status = runtime_component_status(
        app,
        RuntimeComponentKind::AiModel,
        runtime_id,
        packages,
        None,
    )
    .await?;
    Ok(AiRuntimeStatus {
        runtime_id: status.runtime_id,
        runtime_dir: status.runtime_dir,
        python_path: status.python_path,
        installed: status.installed,
        missing_packages: status.missing_packages,
        error: status.error,
        size_bytes: status.size_bytes,
    })
}

/// Starts a Python script as a tracked background job and returns immediately.
///
/// This is the long-running path: the caller gets a job handle, and output and progress arrive
/// later as events, so inference that takes minutes does not block the UI. Use
/// [`lia_ai_python_run`] instead when the result is needed inline.
#[tauri::command]
pub async fn lia_ai_python_spawn(
    app: AppHandle,
    runtime_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    workspace_id: Option<String>,
    label: Option<String>,
    metadata: Option<Value>,
) -> Result<Value, String> {
    // Job metadata must be an object so `runtimeId` can be added to it. A caller that passed a
    // bare value (string, number, array) gets it preserved under a `value` key rather than
    // dropped, and passing nothing simply starts from an empty object.
    let mut metadata_map = match metadata {
        Some(Value::Object(map)) => map,
        Some(value) => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), value);
            map
        }
        None => serde_json::Map::new(),
    };
    // Stamped onto the job so Jobs and Results can attribute the run to its runtime.
    metadata_map.insert("runtimeId".to_string(), Value::String(runtime_id.clone()));
    if let Some(activation) = runtime_box_activation_metadata(&app, &runtime_id)? {
        metadata_map.insert("runtimeBoxActivation".to_string(), activation);
    }

    spawn_in_env(
        app,
        AI_PYTHON_ENV_ROOT.to_string(),
        runtime_id.clone(),
        script,
        args,
        input_json,
        workspace_id,
        // extra_env: AI runs need no additional environment variables beyond the venv's own.
        None,
        // A readable fallback label, since this is what the user sees in the Jobs list.
        Some(label.unwrap_or_else(|| format!("AI runtime: {runtime_id}"))),
        // job_kind: lets the UI filter AI jobs apart from plugin or native-tool jobs.
        "ai-python".to_string(),
        Some(Value::Object(metadata_map)),
    )
    .await
}

/// Runs a Python script to completion and returns its result.
///
/// The blocking counterpart of [`lia_ai_python_spawn`]: no job is created and the caller waits,
/// so this suits short work with a bounded `timeout_seconds`.
#[tauri::command]
pub async fn lia_ai_python_run(
    app: AppHandle,
    runtime_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    timeout_seconds: Option<u64>,
) -> Result<AiPythonRunResult, String> {
    // Keep the inline path under the same Runtime Box gate as tracked Jobs. Without this check a
    // schema-v1 activation was blocked by `lia_ai_python_spawn` but could still execute here.
    runtime_box_activation_metadata(&app, &runtime_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_in_env(
            app,
            AI_PYTHON_ENV_ROOT.to_string(),
            runtime_id,
            script,
            args,
            input_json,
            timeout_seconds,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
