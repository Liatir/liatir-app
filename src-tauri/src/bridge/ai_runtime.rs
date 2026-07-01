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
pub struct AiPythonCandidate {
    pub path: String,
    pub version: String,
}

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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimePackage {
    pub package: String,
    pub import_name: Option<String>,
    pub specifier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPythonRequirement {
    pub min_version: Option<String>,
    pub max_version_exclusive: Option<String>,
    pub label: Option<String>,
    pub reason: Option<String>,
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

const AI_PYTHON_JOB_RUNNER: &str = r#"
import io
import pathlib
import runpy
import sys

input_path = pathlib.Path(sys.argv[1])
script_path = pathlib.Path(sys.argv[2])
script_args = sys.argv[3:]

sys.argv = [str(script_path), *script_args]
sys.path.insert(0, str(script_path.parent))
sys.stdin = io.StringIO(input_path.read_text(encoding="utf-8"))
runpy.run_path(str(script_path), run_name="__main__")
"#;

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

fn preferred_python() -> Option<String> {
    first_available(&[
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ])
}

fn python_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    for name in ["python3.12", "python3.11", "python3.10", "python3", "python"] {
        if let Some(path) = find_in_path(name) {
            if !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    }
    candidates
}

fn python_candidate_infos() -> Vec<AiPythonCandidate> {
    python_candidates()
        .into_iter()
        .filter_map(|path| {
            command_stdout(&path, &["--version"]).map(|version| AiPythonCandidate { path, version })
        })
        .collect()
}

fn command_stdout(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Some(if stdout.is_empty() { stderr } else { stdout })
}

fn parse_version_parts(value: &str) -> Vec<u64> {
    let mut started = false;
    let cleaned = value
        .chars()
        .filter_map(|c| {
            if c.is_ascii_digit() {
                started = true;
                Some(c)
            } else if started && c == '.' {
                Some(c)
            } else if started {
                None
            } else {
                None
            }
        })
        .collect::<String>();
    cleaned
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let left = parse_version_parts(a);
    let right = parse_version_parts(b);
    let len = left.len().max(right.len());
    for i in 0..len {
        let av = left.get(i).copied().unwrap_or(0);
        let bv = right.get(i).copied().unwrap_or(0);
        match av.cmp(&bv) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

fn python_requirement_matches(version: &str, requirement: Option<&AiPythonRequirement>) -> bool {
    let Some(requirement) = requirement else {
        return true;
    };
    if let Some(min) = requirement.min_version.as_deref() {
        if version_cmp(version, min).is_lt() {
            return false;
        }
    }
    if let Some(max) = requirement.max_version_exclusive.as_deref() {
        if !version_cmp(version, max).is_lt() {
            return false;
        }
    }
    true
}

fn preferred_python_matching(requirement: Option<&AiPythonRequirement>) -> Result<String, String> {
    let candidates = python_candidates();
    if candidates.is_empty() {
        return Err("Python 3 is required to prepare this AI runtime".to_string());
    }

    let mut seen = Vec::new();
    for python in &candidates {
        if let Some(version) = command_stdout(python, &["--version"]) {
            if python_requirement_matches(&version, requirement) {
                return Ok(python.clone());
            }
            seen.push(format!("{version} at {python}"));
        }
    }

    let required = requirement
        .map(python_requirement_label)
        .unwrap_or_else(|| "a compatible Python version".to_string());
    let reason = requirement
        .and_then(|requirement| requirement.reason.as_deref())
        .map(|text| format!(" {text}"))
        .unwrap_or_default();
    let found = if seen.is_empty() {
        "no readable Python version".to_string()
    } else {
        seen.join(", ")
    };
    Err(format!(
        "This AI runtime requires {required}, but Liatir found {found}. Install a compatible Python from Dependencies, then retry."
    ) + &reason)
}

fn python_requirement_label(requirement: &AiPythonRequirement) -> String {
    if let Some(label) = requirement.label.as_deref() {
        return label.to_string();
    }
    match (
        requirement.min_version.as_deref(),
        requirement.max_version_exclusive.as_deref(),
    ) {
        (Some(min), Some(max)) => format!("Python >={min},<{max}"),
        (Some(min), None) => format!("Python >={min}"),
        (None, Some(max)) => format!("Python <{max}"),
        (None, None) => "a compatible Python version".to_string(),
    }
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
    let packages_json = serde_json::to_string(packages).unwrap_or_else(|_| "[]".to_string());
    format!(
        r#"
import importlib, importlib.metadata, json, re

packages = {packages_json}
missing = []

def parse_version(value):
    parts = []
    for part in re.split(r"[.+-]", str(value)):
        if part.isdigit():
            parts.append(int(part))
        elif parts:
            break
    return parts

def compare_versions(left, right):
    a = parse_version(left)
    b = parse_version(right)
    size = max(len(a), len(b))
    a.extend([0] * (size - len(a)))
    b.extend([0] * (size - len(b)))
    return (a > b) - (a < b)

def constraints(specifier):
    if not specifier:
        return []
    match = re.search(r"(===|==|>=|<=|!=|~=|>|<)", specifier)
    if not match:
        return []
    return [part.strip() for part in specifier[match.start():].split(",") if part.strip()]

def specifier_matches(version, specifier):
    for item in constraints(specifier):
        match = re.match(r"(==|>=|<=|>|<)\s*([0-9][0-9A-Za-z.+!-]*)", item)
        if not match:
            continue
        op, expected = match.groups()
        cmp = compare_versions(version, expected)
        if op == "==" and cmp != 0:
            return False
        if op == ">=" and cmp < 0:
            return False
        if op == "<=" and cmp > 0:
            return False
        if op == ">" and cmp <= 0:
            return False
        if op == "<" and cmp >= 0:
            return False
    return True

for pkg in packages:
    package = pkg.get("package") or ""
    import_name = (pkg.get("importName") or package).replace("-", "_")
    specifier = pkg.get("specifier")
    try:
        importlib.import_module(import_name)
    except Exception:
        missing.append(import_name)
        continue
    if specifier:
        try:
            version = importlib.metadata.version(package)
        except Exception:
            continue
        if not specifier_matches(version, specifier):
            missing.append(f"{{package}} {{version}} does not satisfy {{specifier}}")

print(json.dumps({{"missing": missing}}))
"#
    )
}

fn total_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("sysctl")
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
                .map(|p| {
                    p.import_name
                        .as_deref()
                        .unwrap_or(p.package.as_str())
                        .replace('-', "_")
                })
                .collect();
        }

        Ok(AiRuntimeStatus {
            runtime_id,
            runtime_dir: dir.to_string_lossy().to_string(),
            python_path,
            uv_path,
            installed: missing_packages.is_empty()
                && error.is_none()
                && venv_python(&dir).is_file(),
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
    python_requirement: Option<AiPythonRequirement>,
) -> Result<AiRuntimePrepareResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = runtime_dir(&app, &runtime_id)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let python = preferred_python_matching(python_requirement.as_ref())?;
        let uv = first_available(&["uv"]);
        let venv = venv_dir(&dir);
        let py = venv_python(&dir);
        let mut stdout = String::new();
        let mut stderr = String::new();
        let installer: String;

        if py.is_file() {
            let venv_python_version = command_stdout(&py.to_string_lossy(), &["--version"]);
            let compatible = venv_python_version
                .as_deref()
                .map(|version| python_requirement_matches(version, python_requirement.as_ref()))
                .unwrap_or(false);
            if !compatible {
                std::fs::remove_dir_all(&venv).map_err(|e| {
                    format!(
                        "Failed to recreate incompatible AI runtime environment at {}: {e}",
                        venv.to_string_lossy()
                    )
                })?;
                stdout.push_str("Removed incompatible Python virtual environment.\n");
            }
        }

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
                let args = vec![
                    "-m".to_string(),
                    "venv".to_string(),
                    venv.to_string_lossy().to_string(),
                ];
                let (out, err) = run_command(&python, &args, Some(&dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
                installer = "venv".to_string();
            }
        } else {
            installer = if uv.is_some() {
                "uv".to_string()
            } else {
                "venv".to_string()
            };
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
    let dir = runtime_dir(&app, &runtime_id)?;
    let py = venv_python(&dir);
    if !py.is_file() {
        return Err(format!("AI runtime is not installed: {runtime_id}"));
    }

    let run_dir = dir.join("runs").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;

    let script_path = run_dir.join("script.py");
    let input_path = run_dir.join("input.json");
    let runner_path = run_dir.join("_liatir_ai_job_runner.py");
    std::fs::write(&script_path, script.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(
        &input_path,
        serde_json::to_vec(&input_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(&runner_path, AI_PYTHON_JOB_RUNNER.as_bytes()).map_err(|e| e.to_string())?;

    let mut job_args = vec![
        runner_path.to_string_lossy().to_string(),
        input_path.to_string_lossy().to_string(),
        script_path.to_string_lossy().to_string(),
    ];
    job_args.extend(args);

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

    super::jobs::lia_jobs_spawn_with_cleanup(
        app,
        py.to_string_lossy().to_string(),
        job_args,
        Some(dir.to_string_lossy().to_string()),
        workspace_id,
        None,
        Some(label.unwrap_or_else(|| format!("AI runtime: {runtime_id}"))),
        Some("ai-python".to_string()),
        Some(Value::Object(metadata_map)),
        Some(run_dir.to_string_lossy().to_string()),
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
