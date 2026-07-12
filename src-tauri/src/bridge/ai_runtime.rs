//! Tauri commands for AI Python runtimes.
//!
//! This module is deliberately thin: the real work of creating venvs, resolving packages and
//! running scripts lives in [`super::python_env`], which is generic over an "environment root".
//! Here we bind that machinery to the AI root and expose it to the frontend.
//!
//! Two different ways of getting a Python environment coexist under the same root:
//! this module *builds* one on the user's machine (pip/uv installing into a venv), while
//! [`super::runtime_boxes`] *downloads* a pre-built, signed one. Both end up in `ai-runtimes/`
//! keyed by runtime ID, so the code that later spawns a script does not care which produced it.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::python_env::{
    command_stdout, first_available, preferred_python, prepare_env, python_candidate_infos,
    remove_env, run_in_env, spawn_in_env, status_env, PythonCandidate, PythonEnvLock,
    PythonEnvPackage, PythonEnvSource, PythonRequirement, PythonRunResult,
};

/// Environment root passed to every `python_env` call, i.e. `<data root>/ai-runtimes/<runtime id>`.
const AI_PYTHON_ENV_ROOT: &str = "ai-runtimes";

// AI-facing names for the generic python_env contracts. These are aliases, not copies: the
// shapes stay defined in exactly one place, so the frontend-facing AI types cannot drift away
// from what the Python environment layer actually returns.
pub type AiPythonCandidate = PythonCandidate;
pub type AiRuntimePackage = PythonEnvPackage;
pub type AiRuntimeSource = PythonEnvSource;
pub type AiPythonRequirement = PythonRequirement;
pub type AiPythonRuntimeLock = PythonEnvLock;
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
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub python_candidates: Vec<AiPythonCandidate>,
    pub uv_path: Option<String>,
}

/// Whether a runtime is ready to use, and if not, precisely what it is missing — so the UI can
/// say "install 2 packages" instead of just "not installed".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeStatus {
    pub runtime_id: String,
    pub runtime_dir: String,
    pub python_path: Option<String>,
    pub uv_path: Option<String>,
    pub installed: bool,
    pub missing_packages: Vec<String>,
    pub missing_sources: Vec<String>,
    /// Set when the environment could not be inspected at all (as opposed to being incomplete).
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
    pub lock: Option<AiPythonRuntimeLock>,
}

/// Outcome of building a runtime. `stdout`/`stderr` are the installer's raw output, kept so a
/// failed dependency resolution can be shown to the user instead of a generic error.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimePrepareResult {
    pub runtime_id: String,
    pub runtime_dir: String,
    pub python_path: String,
    /// Which tool actually did the install (e.g. uv or pip).
    pub installer: String,
    pub stdout: String,
    pub stderr: String,
    pub size_bytes: Option<u64>,
    pub lock: Option<AiPythonRuntimeLock>,
}

/// Installed RAM, probed per platform. Windows has no implementation and yields `None`,
/// which callers must treat as "unknown", not "zero".
fn total_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<u64>()
            .ok()
    }
    #[cfg(target_os = "linux")]
    {
        // /proc/meminfo reports `MemTotal:  16384000 kB`, hence the kB -> bytes conversion.
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        let kb = text
            .lines()
            .find_map(|line| line.strip_prefix("MemTotal:"))
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(|n| n.parse::<u64>().ok())?;
        Some(kb * 1024)
    }
    #[cfg(target_os = "windows")]
    {
        None
    }
}

/// Probes the host: CPU, memory, GPU hints and which Python toolchains are available.
#[tauri::command]
pub fn lia_ai_hardware_info() -> Result<AiHardwareInfo, String> {
    let python_path = preferred_python();
    let python_version = python_path
        .as_deref()
        .and_then(|path| command_stdout(path, &["--version"]));
    let python_candidates = python_candidate_infos();
    let uv_path = first_available(&["uv"]);

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
        cuda_available: first_available(&["nvidia-smi"]).map(|_| true),
        python_path,
        python_version,
        python_candidates,
        uv_path,
    })
}

/// Reports whether a runtime exists and is complete for the given package set.
///
/// Inspection walks the venv and shells out, which is blocking work; `spawn_blocking` keeps it
/// off the async runtime so the UI stays responsive. The same pattern is used by every command
/// below except [`lia_ai_python_spawn`], which is natively async.
#[tauri::command]
pub async fn lia_ai_runtime_status(
    app: AppHandle,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
    sources: Option<Vec<AiRuntimeSource>>,
) -> Result<AiRuntimeStatus, String> {
    // Cloned because the closure moves it, while the original is needed to build the response.
    let runtime_id_for_task = runtime_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let status = status_env(
            app,
            AI_PYTHON_ENV_ROOT.to_string(),
            runtime_id_for_task,
            packages,
            sources.unwrap_or_default(),
        )?;
        Ok(AiRuntimeStatus {
            runtime_id,
            runtime_dir: status.env_dir,
            python_path: status.python_path,
            uv_path: status.uv_path,
            installed: status.installed,
            missing_packages: status.missing_packages,
            missing_sources: status.missing_sources,
            error: status.error,
            size_bytes: status.size_bytes,
            lock: status.lock,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates or repairs a runtime: makes the venv and installs everything it declares.
///
/// This is the "build it locally" path, as opposed to downloading a pre-built Runtime Box.
/// It is idempotent — running it on an already complete environment is how a partially
/// installed runtime gets repaired.
#[tauri::command]
pub async fn lia_ai_runtime_prepare(
    app: AppHandle,
    runtime_id: String,
    requirements: Option<Vec<String>>,
    packages: Option<Vec<AiRuntimePackage>>,
    sources: Option<Vec<AiRuntimeSource>>,
    python_requirement: Option<AiPythonRequirement>,
) -> Result<AiRuntimePrepareResult, String> {
    let runtime_id_for_task = runtime_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_env(
            app,
            AI_PYTHON_ENV_ROOT.to_string(),
            runtime_id_for_task,
            requirements,
            packages,
            sources,
            python_requirement,
        )?;
        Ok(AiRuntimePrepareResult {
            runtime_id,
            runtime_dir: prepared.env_dir,
            python_path: prepared.python_path,
            installer: prepared.installer,
            stdout: prepared.stdout,
            stderr: prepared.stderr,
            size_bytes: prepared.size_bytes,
            lock: prepared.lock,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a runtime's environment directory, freeing its disk space.
#[tauri::command]
pub async fn lia_ai_runtime_remove(app: AppHandle, runtime_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_env(app, AI_PYTHON_ENV_ROOT.to_string(), runtime_id)
    })
    .await
    .map_err(|e| e.to_string())?
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
