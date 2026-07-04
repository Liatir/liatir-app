use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonCandidate {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvPackage {
    pub package: String,
    pub version: Option<String>,
    pub import_name: Option<String>,
    pub specifier: Option<String>,
    pub install_options: Option<PythonEnvPackageInstallOptions>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvPackageInstallOptions {
    pub no_build_isolation: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvSource {
    pub url: String,
    pub revision: Option<String>,
    pub relative_path: String,
    pub python_path: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonRequirement {
    pub min_version: Option<String>,
    pub max_version_exclusive: Option<String>,
    pub label: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvLockedPackage {
    pub package: String,
    pub import_name: Option<String>,
    pub specifier: Option<String>,
    pub requested: String,
    pub installed_version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvLockedSource {
    pub url: String,
    pub revision: Option<String>,
    pub relative_path: String,
    pub python_path: bool,
    pub resolved_revision: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvLock {
    pub schema_version: u32,
    pub env_root: String,
    pub env_id: String,
    pub python_version: Option<String>,
    pub installer: String,
    pub requirements: Vec<String>,
    pub packages: Vec<PythonEnvLockedPackage>,
    pub sources: Vec<PythonEnvLockedSource>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvStatus {
    pub env_id: String,
    pub env_dir: String,
    pub python_path: Option<String>,
    pub uv_path: Option<String>,
    pub installed: bool,
    pub missing_packages: Vec<String>,
    pub missing_sources: Vec<String>,
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
    pub lock: Option<PythonEnvLock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvPrepareResult {
    pub env_id: String,
    pub env_dir: String,
    pub python_path: String,
    pub installer: String,
    pub stdout: String,
    pub stderr: String,
    pub size_bytes: Option<u64>,
    pub lock: Option<PythonEnvLock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonRunResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
}

const PYTHON_JOB_RUNNER: &str = r#"
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

const PYTHON_BOOTSTRAP_REQUIREMENTS: &[&str] = &[
    "pip>=23,<27",
    "setuptools>=68,<81",
    "wheel>=0.41,<1",
    "packaging>=23,<26",
];

pub fn first_available(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| find_in_path(name))
}

pub fn preferred_python() -> Option<String> {
    first_available(&[
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ])
}

pub fn python_candidate_infos() -> Vec<PythonCandidate> {
    python_candidates()
        .into_iter()
        .filter_map(|path| {
            command_stdout(&path, &["--version"]).map(|version| PythonCandidate { path, version })
        })
        .collect()
}

pub fn command_stdout(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Some(if stdout.is_empty() { stderr } else { stdout })
}

pub fn env_dir(app: &AppHandle, env_root: &str, env_id: &str) -> Result<PathBuf, String> {
    validate_env_root(env_root)?;
    validate_env_id(env_id)?;
    Ok(data_root(app)?.join(env_root).join(env_id))
}

pub fn venv_python(dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        venv_dir(dir).join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv_dir(dir).join("bin").join("python")
    }
}

pub fn status_env(
    app: AppHandle,
    env_root: String,
    env_id: String,
    packages: Vec<PythonEnvPackage>,
    sources: Vec<PythonEnvSource>,
) -> Result<PythonEnvStatus, String> {
    let dir = env_dir(&app, &env_root, &env_id)?;
    let python = venv_python(&dir);
    let python_path = if python.is_file() {
        Some(python.to_string_lossy().to_string())
    } else {
        None
    };
    let uv_path = first_available(&["uv"]);
    let mut missing_packages = Vec::new();
    let mut missing_sources = Vec::new();
    let mut error = None;

    let source_python_paths = runtime_python_paths_from_sources(&dir, &sources).unwrap_or_default();
    let check_python_paths = if source_python_paths.is_empty() {
        read_runtime_python_paths(&dir)
    } else {
        source_python_paths
    };
    let env = python_path_env_value(&check_python_paths).map(|value| {
        let mut env = HashMap::new();
        env.insert("PYTHONPATH".to_string(), value);
        env
    });

    for source in &sources {
        match runtime_source_path(&dir, source) {
            Ok(target) => {
                let revision_ok = source
                    .revision
                    .as_deref()
                    .map(|revision| source_revision_matches(&target, revision))
                    .unwrap_or(true);
                if !target.is_dir() || !revision_ok {
                    missing_sources.push(source.relative_path.clone());
                }
            }
            Err(err) => {
                error = Some(err);
            }
        }
    }

    if let Some(python_path) = python_path.as_deref() {
        if !packages.is_empty() {
            let script = import_check_script(&packages);
            let mut command = Command::new(python_path);
            command.arg("-c").arg(script);
            if let Some(env) = env.as_ref() {
                command.envs(env);
            }
            match command.output() {
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

    Ok(PythonEnvStatus {
        env_id,
        env_dir: dir.to_string_lossy().to_string(),
        python_path,
        uv_path,
        installed: missing_packages.is_empty()
            && missing_sources.is_empty()
            && error.is_none()
            && venv_python(&dir).is_file(),
        missing_packages,
        missing_sources,
        error,
        size_bytes: dir_size_bytes(&dir).ok(),
        lock: read_lock(&dir).ok().flatten(),
    })
}

pub fn prepare_env(
    app: AppHandle,
    env_root: String,
    env_id: String,
    requirements: Option<Vec<String>>,
    packages: Option<Vec<PythonEnvPackage>>,
    sources: Option<Vec<PythonEnvSource>>,
    python_requirement: Option<PythonRequirement>,
) -> Result<PythonEnvPrepareResult, String> {
    let dir = env_dir(&app, &env_root, &env_id)?;
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
                    "Failed to recreate incompatible Python environment at {}: {e}",
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

    let bootstrap_requirements = PYTHON_BOOTSTRAP_REQUIREMENTS
        .iter()
        .map(|requirement| requirement.to_string())
        .collect::<Vec<_>>();
    stdout.push_str("Preparing Python packaging tools.\n");
    let (out, err) = install_python_requirements(
        uv.as_deref(),
        &py,
        &dir,
        &bootstrap_requirements,
        true,
        false,
    )?;
    stdout.push_str(&out);
    stderr.push_str(&err);

    let packages = packages.unwrap_or_default();
    let requirements = requirements.unwrap_or_default();
    if !packages.is_empty() {
        stdout.push_str("Installing Python environment packages.\n");
        let (out, err) = install_runtime_packages(uv.as_deref(), &py, &dir, &packages)?;
        stdout.push_str(&out);
        stderr.push_str(&err);
    }

    if !requirements.is_empty() {
        stdout.push_str("Installing Python environment packages.\n");
        let (out, err) =
            install_python_requirements(uv.as_deref(), &py, &dir, &requirements, false, false)?;
        stdout.push_str(&out);
        stderr.push_str(&err);
    }

    let sources = sources.unwrap_or_default();
    let locked_sources = if !sources.is_empty() {
        let (out, err, _python_paths) = install_runtime_sources(&dir, &sources)?;
        stdout.push_str(&out);
        stderr.push_str(&err);
        locked_sources(&dir, &sources)
    } else {
        write_runtime_python_paths(&dir, &[])?;
        Vec::new()
    };

    let previous_lock = read_lock(&dir).ok().flatten();
    let now = now_ms();
    let lock = PythonEnvLock {
        schema_version: 1,
        env_root,
        env_id: env_id.clone(),
        python_version: command_stdout(&py.to_string_lossy(), &["--version"]),
        installer: installer.clone(),
        requirements: requirements.clone(),
        packages: locked_packages(&py, &packages),
        sources: locked_sources,
        created_at_ms: previous_lock
            .as_ref()
            .map(|lock| lock.created_at_ms)
            .unwrap_or(now),
        updated_at_ms: now,
    };
    write_lock(&dir, &lock)?;

    Ok(PythonEnvPrepareResult {
        env_id,
        env_dir: dir.to_string_lossy().to_string(),
        python_path: py.to_string_lossy().to_string(),
        installer,
        stdout,
        stderr,
        size_bytes: dir_size_bytes(&dir).ok(),
        lock: Some(lock),
    })
}

pub async fn spawn_in_env(
    app: AppHandle,
    env_root: String,
    env_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    workspace_id: Option<String>,
    extra_env: Option<HashMap<String, String>>,
    label: Option<String>,
    job_kind: String,
    metadata: Option<Value>,
) -> Result<Value, String> {
    let dir = env_dir(&app, &env_root, &env_id)?;
    let py = venv_python(&dir);
    if !py.is_file() {
        return Err(format!("Python environment is not installed: {env_id}"));
    }

    let run_dir = dir.join("runs").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;

    let script_path = run_dir.join("script.py");
    let input_path = run_dir.join("input.json");
    let runner_path = run_dir.join("_liatir_python_job_runner.py");
    std::fs::write(&script_path, script.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(
        &input_path,
        serde_json::to_vec(&input_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(&runner_path, PYTHON_JOB_RUNNER.as_bytes()).map_err(|e| e.to_string())?;

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
    metadata_map.insert("envRoot".to_string(), Value::String(env_root));
    metadata_map.insert("envId".to_string(), Value::String(env_id.clone()));

    let mut env = runtime_python_env(&dir).unwrap_or_default();
    if let Some(extra_env) = extra_env {
        env.extend(extra_env);
    }
    let env = if env.is_empty() { None } else { Some(env) };

    super::jobs::lia_jobs_spawn_with_cleanup(
        app,
        py.to_string_lossy().to_string(),
        job_args,
        Some(dir.to_string_lossy().to_string()),
        workspace_id,
        env,
        Some(label.unwrap_or_else(|| format!("Python environment: {env_id}"))),
        Some(job_kind),
        Some(Value::Object(metadata_map)),
        Some(run_dir.to_string_lossy().to_string()),
    )
    .await
}

pub fn run_in_env(
    app: AppHandle,
    env_root: String,
    env_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    timeout_seconds: Option<u64>,
) -> Result<PythonRunResult, String> {
    let dir = env_dir(&app, &env_root, &env_id)?;
    let py = venv_python(&dir);
    if !py.is_file() {
        return Err(format!("Python environment is not installed: {env_id}"));
    }

    let run_dir = dir.join("runs");
    std::fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
    let script_path = run_dir.join(format!("{}.py", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, script.as_bytes()).map_err(|e| e.to_string())?;

    let started = Instant::now();
    let mut command = Command::new(&py);
    command
        .arg(&script_path)
        .args(args)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(env) = runtime_python_env(&dir) {
        command.envs(env);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start Python environment: {e}"))?;

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
                    return Ok(PythonRunResult {
                        ok: false,
                        exit_code: None,
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: format!(
                            "{}\nPython environment timed out after {} seconds",
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
    Ok(PythonRunResult {
        ok: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: started.elapsed().as_millis(),
    })
}

pub fn remove_env(app: AppHandle, env_root: String, env_id: String) -> Result<bool, String> {
    let dir = env_dir(&app, &env_root, &env_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

fn validate_env_root(env_root: &str) -> Result<(), String> {
    if env_root.is_empty()
        || env_root.len() > 80
        || !env_root
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid Python environment root: {env_root:?}"));
    }
    Ok(())
}

fn validate_env_id(env_id: &str) -> Result<(), String> {
    if env_id.is_empty()
        || env_id.len() > 80
        || !env_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid Python environment id: {env_id:?}"));
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

fn python_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    for name in [
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        if let Some(path) = find_in_path(name) {
            if !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    }
    candidates
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

fn python_requirement_matches(version: &str, requirement: Option<&PythonRequirement>) -> bool {
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

fn preferred_python_matching(requirement: Option<&PythonRequirement>) -> Result<String, String> {
    let candidates = python_candidates();
    if candidates.is_empty() {
        return Err("Python 3 is required to prepare this environment".to_string());
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
        "This Python environment requires {required}, but Liatir found {found}. Install a compatible Python from Dependencies, then retry."
    ) + &reason)
}

fn python_requirement_label(requirement: &PythonRequirement) -> String {
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

/// pub(crate): plugin_dev startup cleanup locates orphan dev env roots
/// through this same function instead of re-deriving the layout.
pub(crate) fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(base.join(".liatir").join(".main").join("data"))
}

fn venv_dir(dir: &Path) -> PathBuf {
    dir.join("venv")
}

fn runtime_pythonpath_file(dir: &Path) -> PathBuf {
    dir.join("runtime-pythonpath.json")
}

fn runtime_lock_file(dir: &Path) -> PathBuf {
    dir.join("runtime-lock.json")
}

fn validate_runtime_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() {
        return Err("runtime source path cannot be empty".to_string());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("runtime source path must be relative: {value}"));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("unsafe runtime source path: {value}")),
        }
    }
    Ok(path.to_path_buf())
}

fn runtime_source_path(dir: &Path, source: &PythonEnvSource) -> Result<PathBuf, String> {
    Ok(dir.join(validate_runtime_relative_path(&source.relative_path)?))
}

fn source_revision_matches(target: &Path, revision: &str) -> bool {
    resolved_source_revision(target)
        .map(|resolved| resolved == revision)
        .unwrap_or(false)
}

fn resolved_source_revision(target: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", &target.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn runtime_python_paths_from_sources(
    dir: &Path,
    sources: &[PythonEnvSource],
) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for source in sources {
        if source.python_path.unwrap_or(false) {
            paths.push(runtime_source_path(dir, source)?);
        }
    }
    Ok(paths)
}

fn write_runtime_python_paths(dir: &Path, paths: &[PathBuf]) -> Result<(), String> {
    let values = paths
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    std::fs::write(
        runtime_pythonpath_file(dir),
        serde_json::to_vec_pretty(&values).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn read_runtime_python_paths(dir: &Path) -> Vec<PathBuf> {
    let Ok(raw) = std::fs::read(runtime_pythonpath_file(dir)) else {
        return Vec::new();
    };
    let Ok(values) = serde_json::from_slice::<Vec<String>>(&raw) else {
        return Vec::new();
    };
    values.into_iter().map(PathBuf::from).collect()
}

fn python_path_env_value(paths: &[PathBuf]) -> Option<String> {
    if paths.is_empty() {
        return None;
    }
    let separator = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    Some(
        paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(separator),
    )
}

fn runtime_python_env(dir: &Path) -> Option<HashMap<String, String>> {
    python_path_env_value(&read_runtime_python_paths(dir)).map(|value| {
        let mut env = HashMap::new();
        env.insert("PYTHONPATH".to_string(), value);
        env
    })
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

fn install_python_requirements(
    uv: Option<&str>,
    py: &Path,
    dir: &Path,
    requirements: &[String],
    upgrade: bool,
    no_build_isolation: bool,
) -> Result<(String, String), String> {
    if requirements.is_empty() {
        return Ok((String::new(), String::new()));
    }

    if let Some(uv_path) = uv {
        let mut args = vec![
            "pip".to_string(),
            "install".to_string(),
            "--python".to_string(),
            py.to_string_lossy().to_string(),
        ];
        if upgrade {
            args.push("--upgrade".to_string());
        }
        if no_build_isolation {
            args.push("--no-build-isolation".to_string());
        }
        args.extend(requirements.to_owned());
        return run_command(uv_path, &args, Some(dir));
    }

    let mut args = vec!["-m".to_string(), "pip".to_string(), "install".to_string()];
    if upgrade {
        args.push("--upgrade".to_string());
    }
    if no_build_isolation {
        args.push("--no-build-isolation".to_string());
    }
    args.extend(requirements.to_owned());
    let py_path = py.to_string_lossy().to_string();
    run_command(&py_path, &args, Some(dir))
}

fn runtime_package_requirement(package: &PythonEnvPackage) -> String {
    if let Some(specifier) = package.specifier.as_deref() {
        return specifier.to_string();
    }
    if let Some(version) = package.version.as_deref() {
        return format!("{}=={}", package.package, version);
    }
    package.package.clone()
}

fn install_runtime_package_group(
    uv: Option<&str>,
    py: &Path,
    dir: &Path,
    requirements: &mut Vec<String>,
    no_build_isolation: bool,
    stdout: &mut String,
    stderr: &mut String,
) -> Result<(), String> {
    if requirements.is_empty() {
        return Ok(());
    }

    let (out, err) =
        install_python_requirements(uv, py, dir, requirements, false, no_build_isolation)?;
    stdout.push_str(&out);
    stderr.push_str(&err);
    requirements.clear();
    Ok(())
}

fn install_runtime_packages(
    uv: Option<&str>,
    py: &Path,
    dir: &Path,
    packages: &[PythonEnvPackage],
) -> Result<(String, String), String> {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut current_no_build_isolation: Option<bool> = None;
    let mut current_requirements: Vec<String> = Vec::new();

    for package in packages {
        let no_build_isolation = package
            .install_options
            .as_ref()
            .and_then(|options| options.no_build_isolation)
            .unwrap_or(false);
        if let Some(current) = current_no_build_isolation {
            if current != no_build_isolation {
                install_runtime_package_group(
                    uv,
                    py,
                    dir,
                    &mut current_requirements,
                    current,
                    &mut stdout,
                    &mut stderr,
                )?;
            }
        }
        current_no_build_isolation = Some(no_build_isolation);
        current_requirements.push(runtime_package_requirement(package));
    }

    if let Some(no_build_isolation) = current_no_build_isolation {
        install_runtime_package_group(
            uv,
            py,
            dir,
            &mut current_requirements,
            no_build_isolation,
            &mut stdout,
            &mut stderr,
        )?;
    }

    Ok((stdout, stderr))
}

fn install_runtime_sources(
    dir: &Path,
    sources: &[PythonEnvSource],
) -> Result<(String, String, Vec<PathBuf>), String> {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut python_paths = Vec::new();

    if sources.is_empty() {
        let _ = write_runtime_python_paths(dir, &[]);
        return Ok((stdout, stderr, python_paths));
    }

    let git = first_available(&["git"])
        .ok_or_else(|| "Git is required to install this Python environment source.".to_string())?;

    for source in sources {
        let target = runtime_source_path(dir, source)?;
        let source_label = source.relative_path.clone();
        let needs_clone = if target.is_dir() {
            match source.revision.as_deref() {
                Some(revision) => !source_revision_matches(&target, revision),
                None => false,
            }
        } else {
            true
        };

        if needs_clone {
            if target.exists() {
                std::fs::remove_dir_all(&target).map_err(|e| {
                    format!(
                        "Failed to replace Python environment source at {}: {e}",
                        target.to_string_lossy()
                    )
                })?;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            stdout.push_str(&format!(
                "Installing Python environment source: {source_label}\n"
            ));
            let args = vec![
                "clone".to_string(),
                source.url.clone(),
                target.to_string_lossy().to_string(),
            ];
            let (out, err) = run_command(&git, &args, Some(dir))?;
            stdout.push_str(&out);
            stderr.push_str(&err);
        }

        if let Some(revision) = source.revision.as_deref() {
            if !source_revision_matches(&target, revision) {
                let args = vec![
                    "-C".to_string(),
                    target.to_string_lossy().to_string(),
                    "checkout".to_string(),
                    revision.to_string(),
                ];
                let (out, err) = run_command(&git, &args, Some(dir))?;
                stdout.push_str(&out);
                stderr.push_str(&err);
            }
        }

        if source.python_path.unwrap_or(false) {
            python_paths.push(target);
        }
    }

    write_runtime_python_paths(dir, &python_paths)?;
    Ok((stdout, stderr, python_paths))
}

fn import_check_script(packages: &[PythonEnvPackage]) -> String {
    let packages_json = serde_json::to_string(packages).unwrap_or_else(|_| "[]".to_string());
    let packages_json_literal =
        serde_json::to_string(&packages_json).unwrap_or_else(|_| "\"[]\"".to_string());
    format!(
        r#"
import importlib, importlib.metadata, json, re

packages = json.loads({packages_json_literal})
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

fn package_versions_script(packages: &[PythonEnvPackage]) -> String {
    let packages_json = serde_json::to_string(packages).unwrap_or_else(|_| "[]".to_string());
    let packages_json_literal =
        serde_json::to_string(&packages_json).unwrap_or_else(|_| "\"[]\"".to_string());
    format!(
        r#"
import importlib.metadata, json

packages = json.loads({packages_json_literal})
out = []
for pkg in packages:
    package = pkg.get("package") or ""
    version = None
    try:
        version = importlib.metadata.version(package)
    except Exception:
        pass
    out.append({{"package": package, "version": version}})
print(json.dumps(out))
"#
    )
}

fn installed_versions(py: &Path, packages: &[PythonEnvPackage]) -> HashMap<String, String> {
    if packages.is_empty() {
        return HashMap::new();
    }
    let output = Command::new(py)
        .arg("-c")
        .arg(package_versions_script(packages))
        .output();
    let Ok(output) = output else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }
    let Ok(values) = serde_json::from_slice::<Vec<HashMap<String, Option<String>>>>(&output.stdout)
    else {
        return HashMap::new();
    };
    values
        .into_iter()
        .filter_map(|mut item| {
            let package = item.remove("package").flatten()?;
            let version = item.remove("version").flatten()?;
            Some((package, version))
        })
        .collect()
}

fn locked_packages(py: &Path, packages: &[PythonEnvPackage]) -> Vec<PythonEnvLockedPackage> {
    let versions = installed_versions(py, packages);
    packages
        .iter()
        .map(|package| PythonEnvLockedPackage {
            package: package.package.clone(),
            import_name: package.import_name.clone(),
            specifier: package.specifier.clone(),
            requested: runtime_package_requirement(package),
            installed_version: versions.get(&package.package).cloned(),
        })
        .collect()
}

fn locked_sources(dir: &Path, sources: &[PythonEnvSource]) -> Vec<PythonEnvLockedSource> {
    sources
        .iter()
        .map(|source| {
            let target = runtime_source_path(dir, source).ok();
            PythonEnvLockedSource {
                url: source.url.clone(),
                revision: source.revision.clone(),
                relative_path: source.relative_path.clone(),
                python_path: source.python_path.unwrap_or(false),
                resolved_revision: target.as_deref().and_then(resolved_source_revision),
            }
        })
        .collect()
}

fn read_lock(dir: &Path) -> Result<Option<PythonEnvLock>, String> {
    let path = runtime_lock_file(dir);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice::<PythonEnvLock>(&raw)
        .map(Some)
        .map_err(|e| format!("Invalid Python environment lock: {e}"))
}

fn write_lock(dir: &Path, lock: &PythonEnvLock) -> Result<(), String> {
    std::fs::write(
        runtime_lock_file(dir),
        serde_json::to_vec_pretty(lock).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn dir_size_bytes(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    if path.is_file() {
        return Ok(std::fs::metadata(path).map_err(|e| e.to_string())?.len());
    }
    let mut total = 0u64;
    for entry in WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata().map_err(|e| e.to_string())?.len());
        }
    }
    Ok(total)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_check_script_embeds_runtime_packages_as_json_data() {
        let script = import_check_script(&[PythonEnvPackage {
            package: "example-package".to_string(),
            version: None,
            import_name: Some("math".to_string()),
            specifier: Some("example-package>=1,<2".to_string()),
            install_options: Some(PythonEnvPackageInstallOptions {
                no_build_isolation: Some(true),
            }),
        }]);

        assert!(script.contains("packages = json.loads("));
        assert!(!script.contains("packages = [{"));
        assert!(script.contains("\\\"version\\\":null"));
        assert!(script.contains("\\\"noBuildIsolation\\\":true"));
    }

    #[test]
    fn import_check_script_runs_with_json_null_and_bool_when_python_is_available() {
        let Some(python) = first_available(&["python3", "python"]) else {
            return;
        };
        let script = import_check_script(&[PythonEnvPackage {
            package: "json".to_string(),
            version: None,
            import_name: Some("json".to_string()),
            specifier: None,
            install_options: Some(PythonEnvPackageInstallOptions {
                no_build_isolation: Some(true),
            }),
        }]);

        let output = Command::new(python)
            .arg("-c")
            .arg(script)
            .output()
            .expect("python status check script should run");

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            r#"{"missing": []}"#
        );
    }

    #[test]
    fn python_requirement_matching_enforces_min_and_exclusive_max() {
        let requirement = PythonRequirement {
            min_version: Some("3.10".to_string()),
            max_version_exclusive: Some("3.13".to_string()),
            label: None,
            reason: None,
        };

        assert!(python_requirement_matches("Python 3.10.13", Some(&requirement)));
        assert!(python_requirement_matches("Python 3.12.9", Some(&requirement)));
        assert!(!python_requirement_matches("Python 3.9.18", Some(&requirement)));
        assert!(!python_requirement_matches("Python 3.13.0", Some(&requirement)));
    }

    #[test]
    fn runtime_relative_paths_reject_escape_attempts() {
        assert!(validate_runtime_relative_path("repo/subdir").is_ok());
        assert!(validate_runtime_relative_path("../outside").is_err());
        assert!(validate_runtime_relative_path("repo/../outside").is_err());
        assert!(validate_runtime_relative_path("").is_err());
        assert!(validate_runtime_relative_path("/absolute/path").is_err());
    }

    #[test]
    fn runtime_package_requirement_prefers_explicit_specifier() {
        let package = PythonEnvPackage {
            package: "example".to_string(),
            version: Some("1.2.3".to_string()),
            import_name: Some("example".to_string()),
            specifier: Some("example>=1,<2".to_string()),
            install_options: None,
        };
        assert_eq!(runtime_package_requirement(&package), "example>=1,<2");

        let package = PythonEnvPackage {
            package: "example".to_string(),
            version: Some("1.2.3".to_string()),
            import_name: None,
            specifier: None,
            install_options: None,
        };
        assert_eq!(runtime_package_requirement(&package), "example==1.2.3");
    }
}
