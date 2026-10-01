//! Tauri commands for signed Runtime Components and AI Model execution.
//!
//! Runtime installation and removal live in [`super::runtime_boxes`]. This module inspects an
//! activated box and runs its Python entry points without modifying the environment locally.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::ai_hardware::{nvidia_capability, total_memory_bytes};
#[cfg(target_os = "windows")]
use super::python_env::env_dir;
use super::python_env::{run_in_env, spawn_in_env, status_env, PythonEnvPackage, PythonRunResult};
use super::runtime_boxes::{
    runtime_box_activation_metadata_for_component, runtime_component_update_status,
    wsl_nvidia_driver_version, RuntimeComponentKind, RuntimeComponentUpdateRequest,
    RuntimeComponentUpdateStatus,
};
#[cfg(target_os = "windows")]
use super::runtime_boxes::{runtime_box_host_environment, RuntimeBoxHostEnvironment};

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
    /// The NVIDIA driver as seen inside WSL2, which a Linux CUDA box routed there is checked
    /// against. `None` when the GPU is not reachable from WSL2, even if Windows reports one.
    pub wsl_nvidia_driver_version: Option<String>,
    pub wsl2_available: bool,
    pub wsl_distribution: Option<String>,
    pub wsl_error: Option<String>,
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
    #[cfg(target_os = "windows")]
    let wsl = crate::helpers::wsl::require_runtime_box_distribution();
    #[cfg(not(target_os = "windows"))]
    let wsl: Result<String, String> = Ok(String::new());

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
        // As in Runtime Box selection, only a host whose Windows side reports an NVIDIA driver
        // pays for the round trip into WSL2 — and here only once that distribution is ready.
        wsl_nvidia_driver_version: (nvidia.is_some() && wsl.is_ok())
            .then(wsl_nvidia_driver_version)
            .flatten(),
        nvidia_driver_version: nvidia.map(|capability| capability.driver_version),
        wsl2_available: cfg!(target_os = "windows") && wsl.is_ok(),
        wsl_distribution: cfg!(target_os = "windows")
            .then(|| wsl.as_ref().ok().cloned())
            .flatten(),
        wsl_error: if cfg!(target_os = "windows") {
            wsl.err()
        } else {
            None
        },
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
    let activation_result =
        runtime_box_activation_metadata_for_component(&app, component_kind, &runtime_id);
    #[cfg(target_os = "windows")]
    if let Ok(Some(activation)) = activation_result.as_ref() {
        if runtime_box_host_environment(activation)? == RuntimeBoxHostEnvironment::WindowsWsl2 {
            let app_for_task = app.clone();
            let runtime_id_for_task = runtime_id.clone();
            let packages_for_task = packages.clone();
            let activation_for_task = activation.clone();
            let status = tauri::async_runtime::spawn_blocking(move || {
                super::runtime_box_wsl::status(
                    &app_for_task,
                    component_kind,
                    &runtime_id_for_task,
                    &packages_for_task,
                    &activation_for_task,
                )
            })
            .await
            .map_err(|error| error.to_string())?;
            let (runtime_dir, python_path, installed, missing_packages, error, size_bytes) =
                match status {
                    Ok(status) => (
                        status.runtime_dir,
                        Some(status.python_path),
                        status.missing_packages.is_empty(),
                        status.missing_packages,
                        None,
                        Some(status.size_bytes),
                    ),
                    Err(error) => (
                        env_dir(&app, component_kind.runtime_root(), &runtime_id)?
                            .to_string_lossy()
                            .to_string(),
                        None,
                        false,
                        Vec::new(),
                        Some(error),
                        None,
                    ),
                };
            let update = if installed && error.is_none() {
                match update {
                    Some(request) => Some(
                        runtime_component_update_status(&app, component_kind, &runtime_id, request)
                            .await?,
                    ),
                    None => None,
                }
            } else {
                None
            };
            return Ok(RuntimeComponentStatus {
                component_kind,
                runtime_id,
                runtime_dir,
                python_path,
                installed,
                missing_packages,
                error,
                size_bytes,
                activation: Some(activation.clone()),
                update,
            });
        }
    }
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
    let activation = match activation_result {
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
/// [`lia_runtime_component_python_run`] instead when the result is needed inline.
#[tauri::command]
pub async fn lia_runtime_component_python_spawn(
    app: AppHandle,
    component_kind: RuntimeComponentKind,
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
    // Stamped onto the job so Jobs and Results can attribute the run to its exact component.
    metadata_map.insert(
        "componentKind".to_string(),
        serde_json::to_value(component_kind).map_err(|error| error.to_string())?,
    );
    metadata_map.insert("runtimeId".to_string(), Value::String(runtime_id.clone()));
    let activation =
        runtime_box_activation_metadata_for_component(&app, component_kind, &runtime_id)?;
    if let Some(activation) = activation.as_ref() {
        metadata_map.insert("runtimeBoxActivation".to_string(), activation.clone());
    }

    #[cfg(target_os = "windows")]
    if activation
        .as_ref()
        .map(runtime_box_host_environment)
        .transpose()?
        == Some(RuntimeBoxHostEnvironment::WindowsWsl2)
    {
        return super::runtime_box_wsl::spawn_python(
            app,
            component_kind,
            runtime_id.clone(),
            script,
            args,
            input_json,
            workspace_id,
            label.unwrap_or_else(|| match component_kind {
                RuntimeComponentKind::AiModel => format!("AI runtime: {runtime_id}"),
                RuntimeComponentKind::ToolRuntime => format!("Tool runtime: {runtime_id}"),
            }),
            match component_kind {
                RuntimeComponentKind::AiModel => "ai-python".to_string(),
                RuntimeComponentKind::ToolRuntime => "tool-runtime-python".to_string(),
            },
            Value::Object(metadata_map),
        )
        .await;
    }

    spawn_in_env(
        app,
        component_kind.runtime_root().to_string(),
        runtime_id.clone(),
        script,
        args,
        input_json,
        workspace_id,
        // extra_env: AI runs need no additional environment variables beyond the venv's own.
        None,
        // A readable fallback label, since this is what the user sees in the Jobs list.
        Some(label.unwrap_or_else(|| match component_kind {
            RuntimeComponentKind::AiModel => format!("AI runtime: {runtime_id}"),
            RuntimeComponentKind::ToolRuntime => format!("Tool runtime: {runtime_id}"),
        })),
        // Preserve the established AI kind because direct-run recovery depends on it. Tool
        // Runtime jobs use their own honest kind and still share the same Jobs lifecycle.
        match component_kind {
            RuntimeComponentKind::AiModel => "ai-python".to_string(),
            RuntimeComponentKind::ToolRuntime => "tool-runtime-python".to_string(),
        },
        Some(Value::Object(metadata_map)),
    )
    .await
}

/// Compatibility command for existing AI Model callers.
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
    lia_runtime_component_python_spawn(
        app,
        RuntimeComponentKind::AiModel,
        runtime_id,
        script,
        args,
        input_json,
        workspace_id,
        label,
        metadata,
    )
    .await
}

/// Runs a Python script to completion and returns its result.
///
/// The blocking counterpart of [`lia_runtime_component_python_spawn`]: no job is created and the
/// caller waits, so this suits short work with a bounded `timeout_seconds`.
#[tauri::command]
pub async fn lia_runtime_component_python_run(
    app: AppHandle,
    component_kind: RuntimeComponentKind,
    runtime_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    timeout_seconds: Option<u64>,
) -> Result<AiPythonRunResult, String> {
    // Keep the inline path under the same Runtime Box gate as tracked Jobs. Without this check a
    // schema-v1 activation blocked by spawn could still execute here.
    let activation =
        runtime_box_activation_metadata_for_component(&app, component_kind, &runtime_id)?
            .ok_or_else(|| "Runtime Box activation metadata is missing".to_string())?;
    #[cfg(not(target_os = "windows"))]
    let _ = &activation;
    #[cfg(target_os = "windows")]
    if runtime_box_host_environment(&activation)? == RuntimeBoxHostEnvironment::WindowsWsl2 {
        return tauri::async_runtime::spawn_blocking(move || {
            super::runtime_box_wsl::run_python(
                &app,
                component_kind,
                &runtime_id,
                &script,
                &args,
                &input_json,
                timeout_seconds,
            )
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        run_in_env(
            app,
            component_kind.runtime_root().to_string(),
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

/// Compatibility command for existing AI Model callers.
#[tauri::command]
pub async fn lia_ai_python_run(
    app: AppHandle,
    runtime_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    timeout_seconds: Option<u64>,
) -> Result<AiPythonRunResult, String> {
    lia_runtime_component_python_run(
        app,
        RuntimeComponentKind::AiModel,
        runtime_id,
        script,
        args,
        input_json,
        timeout_seconds,
    )
    .await
}
