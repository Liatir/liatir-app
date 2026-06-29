use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHardwareInfo {
    pub os: String,
    pub arch: String,
    pub cpu_cores: usize,
    pub total_memory_bytes: Option<u64>,
    pub apple_metal: bool,
    pub cuda_available: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimePackage {
    pub package: String,
    pub import_name: Option<String>,
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
    pub error: Option<String>,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPythonRunResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
}

fn validate_runtime_id(runtime_id: &str) -> Result<(), String> {
    if runtime_id.is_empty()
        || runtime_id.len() > 80
        || !runtime_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid AI runtime id: {runtime_id:?}"));
    }
    Ok(())
}

fn find_in_path(name: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;

    #[cfg(target_os = "windows")]
    let extensions = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(target_os = "windows"))]
    let extensions = [""];

    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    None
}

fn first_available(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| find_in_path(name))
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(base.join(".liatir").join(".main").join("data"))
}

fn runtime_dir(app: &AppHandle, runtime_id: &str) -> Result<PathBuf, String> {
    validate_runtime_id(runtime_id)?;
    Ok(data_root(app)?.join("ai-runtimes").join(runtime_id))
}

fn venv_dir(dir: &Path) -> PathBuf {
    dir.join("venv")
}

fn venv_python(dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        venv_dir(dir).join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv_dir(dir).join("bin").join("python")
    }
}

fn run_command(cmd: &str, args: &[String], cwd: Option<&Path>) -> Result<(String, String), String> {
    let mut command = Command::new(cmd);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .map_err(|e| format!("failed to run {cmd}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "{cmd} failed with code {:?}\n{}{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }
    Ok((stdout, stderr))
}

fn import_check_script(packages: &[AiRuntimePackage]) -> String {
    let imports = packages
        .iter()
        .map(|p| {
            p.import_name
                .as_deref()
                .unwrap_or(p.package.as_str())
                .replace('-', "_")
        })
        .collect::<Vec<_>>();
    format!(
        "import importlib, json\nmissing=[]\nfor name in {imports:?}:\n    try:\n        importlib.import_module(name)\n    except Exception:\n        missing.append(name)\nprint(json.dumps({{\"missing\": missing}}))\n"
    )
}

fn total_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("sysctl").args(["-n", "hw.memsize"]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse::<u64>().ok()
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
    Ok(AiHardwareInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        total_memory_bytes: total_memory_bytes(),
        apple_metal: cfg!(target_os = "macos"),
        cuda_available: first_available(&["nvidia-smi"]).map(|_| true),
    })
}

#[tauri::command]
pub async fn lia_ai_runtime_status(
    app: AppHandle,
    runtime_id: String,
    packages: Vec<AiRuntimePackage>,
) -> Result<AiRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = runtime_dir(&app, &runtime_id)?;
        let python = venv_python(&dir);
        let python_path = if python.is_file() {
            Some(python.to_string_lossy().to_string())
        } else {
            None
        };
        let uv_path = first_available(&["uv"]);
        let mut missing_packages = Vec::new();
        let mut error = None;

        if let Some(python_path) = python_path.as_deref() {
            if !packages.is_empty() {
                let script = import_check_script(&packages);
                match Command::new(python_path).arg("-c").arg(script).output() {
                    Ok(out) if out.status.success() => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let parsed: Result<Value, _> = serde_json::from_str(stdout.trim());
                        if let Ok(value) = parsed {
                            if let Some(items) = value.get("missing").and_then(|v| v.as_array()) {
                                missing_packages = items
                                    .iter()
                                    .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                                    .collect();
                            }
                        }
                    }
                    Ok(out) => {
                        error = Some(String::from_utf8_lossy(&out.stderr).trim().to_string());
                    }
                    Err(e) => error = Some(e.to_string()),
                }
            }
        } else {
            missing_packages = packages
                .iter()
                .map(|p| p.import_name.as_deref().unwrap_or(p.package.as_str()).replace('-', "_"))
                .collect();
        }

        Ok(AiRuntimeStatus {
            runtime_id,
            runtime_dir: dir.to_string_lossy().to_string(),
            python_path,
            uv_path,
            installed: missing_packages.is_empty() && error.is_none() && venv_python(&dir).is_file(),
            missing_packages,
            error,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lia_ai_runtime_prepare(
    app: AppHandle,
    runtime_id: String,
    requirements: Vec<String>,
) -> Result<AiRuntimePrepareResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = runtime_dir(&app, &runtime_id)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let python = first_available(&["python3", "python"])
            .ok_or_else(|| "Python 3 is required to prepare this AI runtime".to_string())?;
        let uv = first_available(&["uv"]);
        let venv = venv_dir(&dir);
        let py = venv_python(&dir);
        let mut stdout = String::new();
        let mut stderr = String::new();
        let installer: String;

        if !py.is_file() {
            if let Some(uv_path) = uv.as_deref() {
                let args = vec![
                    "venv".to_string(),
                    venv.to_string_lossy().to_string(),
                    "--python".to_string(),
                    python.clone(),
                ];
                let (out, err) = run_command(uv_path, &args, Some(&dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
                installer = "uv".to_string();
            } else {
                let args = vec!["-m".to_string(), "venv".to_string(), venv.to_string_lossy().to_string()];
                let (out, err) = run_command(&python, &args, Some(&dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
                installer = "venv".to_string();
            }
        } else {
            installer = if uv.is_some() { "uv".to_string() } else { "venv".to_string() };
        }

        if !requirements.is_empty() {
            if let Some(uv_path) = uv.as_deref() {
                let mut args = vec![
                    "pip".to_string(),
                    "install".to_string(),
                    "--python".to_string(),
                    py.to_string_lossy().to_string(),
                ];
                args.extend(requirements.clone());
                let (out, err) = run_command(uv_path, &args, Some(&dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
            } else {
                let mut args = vec!["-m".to_string(), "pip".to_string(), "install".to_string()];
                args.extend(requirements.clone());
                let py_path = py.to_string_lossy().to_string();
                let (out, err) = run_command(&py_path, &args, Some(&dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
            }
        }

        Ok(AiRuntimePrepareResult {
            runtime_id,
            runtime_dir: dir.to_string_lossy().to_string(),
            python_path: py.to_string_lossy().to_string(),
            installer,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|e| e.to_string())?
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
        let dir = runtime_dir(&app, &runtime_id)?;
        let py = venv_python(&dir);
        if !py.is_file() {
            return Err(format!("AI runtime is not installed: {runtime_id}"));
        }

        let run_dir = dir.join("runs");
        std::fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
        let script_path = run_dir.join(format!("{}.py", uuid::Uuid::new_v4()));
        std::fs::write(&script_path, script.as_bytes()).map_err(|e| e.to_string())?;

        let started = Instant::now();
        let mut child = Command::new(&py)
            .arg(&script_path)
            .args(args)
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start AI runtime: {e}"))?;

        if let Some(stdin) = child.stdin.as_mut() {
            let payload = serde_json::to_vec(&input_json).map_err(|e| e.to_string())?;
            stdin.write_all(&payload).map_err(|e| e.to_string())?;
        }
        drop(child.stdin.take());

        let timeout = Duration::from_secs(timeout_seconds.unwrap_or(3600));
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if started.elapsed() > timeout {
                        let _ = child.kill();
                        let output = child.wait_with_output().map_err(|e| e.to_string())?;
                        let _ = std::fs::remove_file(&script_path);
                        return Ok(AiPythonRunResult {
                            ok: false,
                            exit_code: None,
                            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                            stderr: format!(
                                "{}\nAI runtime timed out after {} seconds",
                                String::from_utf8_lossy(&output.stderr),
                                timeout.as_secs()
                            ),
                            duration_ms: started.elapsed().as_millis(),
                        });
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&script_path);
        Ok(AiPythonRunResult {
            ok: output.status.success(),
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms: started.elapsed().as_millis(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
