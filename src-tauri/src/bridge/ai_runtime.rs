use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::python_env::{
    command_stdout, first_available, preferred_python, prepare_env, python_candidate_infos,
    remove_env, run_in_env, spawn_in_env, status_env, PythonCandidate, PythonEnvLock,
    PythonEnvPackage, PythonEnvSource, PythonRequirement, PythonRunResult,
};

const AI_PYTHON_ENV_ROOT: &str = "ai-runtimes";

pub type AiPythonCandidate = PythonCandidate;
pub type AiRuntimePackage = PythonEnvPackage;
pub type AiRuntimeSource = PythonEnvSource;
pub type AiPythonRequirement = PythonRequirement;
pub type AiPythonRuntimeLock = PythonEnvLock;
pub type AiPythonRunResult = PythonRunResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHardwareInfo {
    pub os: String,
    pub arch: String,
    pub cpu_cores: usize,
    pub total_memory_bytes: Option<u64>,
    pub apple_metal: bool,
    pub cuda_available: Option<bool>,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub python_candidates: Vec<AiPythonCandidate>,
    pub uv_path: Option<String>,
}

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
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
    pub lock: Option<AiPythonRuntimeLock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimePrepareResult {
    pub runtime_id: String,
    pub runtime_dir: String,
    pub python_path: String,
    pub installer: String,
    pub stdout: String,
    pub stderr: String,
    pub size_bytes: Option<u64>,
    pub lock: Option<AiPythonRuntimeLock>,
}

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
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        total_memory_bytes: total_memory_bytes(),
        apple_metal: cfg!(target_os = "macos"),
        cuda_available: first_available(&["nvidia-smi"]).map(|_| true),
        python_path,
        python_version,
        python_candidates,
        uv_path,
    })
}

#[tauri::command]
pub async fn lia_ai_runtime_status(
    app: AppHandle,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
    sources: Option<Vec<AiRuntimeSource>>,
) -> Result<AiRuntimeStatus, String> {
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

#[tauri::command]
pub async fn lia_ai_runtime_remove(app: AppHandle, runtime_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_env(app, AI_PYTHON_ENV_ROOT.to_string(), runtime_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

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
    let mut metadata_map = match metadata {
        Some(Value::Object(map)) => map,
        Some(value) => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), value);
            map
        }
        None => serde_json::Map::new(),
    };
    metadata_map.insert("runtimeId".to_string(), Value::String(runtime_id.clone()));

    spawn_in_env(
        app,
        AI_PYTHON_ENV_ROOT.to_string(),
        runtime_id.clone(),
        script,
        args,
        input_json,
        workspace_id,
        Some(label.unwrap_or_else(|| format!("AI runtime: {runtime_id}"))),
        "ai-python".to_string(),
        Some(Value::Object(metadata_map)),
    )
    .await
}

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
