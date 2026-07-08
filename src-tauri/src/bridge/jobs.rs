use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

use super::plugin_progress::JobProgress;

pub(crate) const SANDBOX_WORKSPACE_ID: &str = "__test__";

static JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

fn gen_job_id() -> String {
    let n = JOB_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("job_{:x}", n)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------
// Types
// ---------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum JobStatus {
    Running,
    Done { exit_code: Option<i32> },
    Failed { exit_code: Option<i32> },
    Killed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEntry {
    pub id: String,
    pub cmd: String,
    pub args: Vec<String>,
    pub label: Option<String>,
    pub kind: Option<String>,
    pub metadata: Option<Value>,
    pub status: JobStatus,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    /// Workspace this job was spawned in. `None` for global/untagged jobs.
    pub workspace_id: Option<String>,
    /// Progress tracking for plugin jobs. Updated via `lia_plugin_progress`.
    pub progress: Option<JobProgress>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOutput {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub stdout_total: usize,
    pub stderr_total: usize,
}

pub(crate) struct JobState {
    pub(crate) entry: JobEntry,
    pub(crate) child: Option<tauri_plugin_shell::process::CommandChild>,
    pub(crate) stdout: Arc<Mutex<Vec<String>>>,
    pub(crate) stderr: Arc<Mutex<Vec<String>>>,
}

// ---------------------------------
// Registry (managed Tauri state)
// ---------------------------------

pub struct JobRegistry(pub(crate) Mutex<HashMap<String, JobState>>);

impl JobRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn is_dev_job(entry: &JobEntry) -> bool {
    if entry
        .kind
        .as_deref()
        .map(|kind| kind.starts_with("lia-plugin-dev"))
        .unwrap_or(false)
    {
        return true;
    }

    let Some(Value::Object(metadata)) = entry.metadata.as_ref() else {
        return false;
    };

    metadata
        .get("pluginDev")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || metadata
            .get("devSession")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        || metadata.get("pluginDevSessionId").and_then(Value::as_str).is_some()
}

// ---------------------------------
// Public Tauri commands
// ---------------------------------

#[tauri::command]
pub async fn lia_jobs_spawn(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    workspace_id: Option<String>,
    env: Option<HashMap<String, String>>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
) -> Result<serde_json::Value, String> {
    spawn_job(
        app,
        cmd,
        args,
        cwd,
        workspace_id,
        env,
        label,
        kind,
        metadata,
        None,
    )
    .await
}

pub(crate) async fn lia_jobs_spawn_with_cleanup(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    workspace_id: Option<String>,
    env: Option<HashMap<String, String>>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
    cleanup_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    spawn_job(
        app,
        cmd,
        args,
        cwd,
        workspace_id,
        env,
        label,
        kind,
        metadata,
        cleanup_dir,
    )
    .await
}

/// Resolve a spawn target to an executable path — the single source of truth
/// for native-tool resolution, shared by the app's own `runNativeTool` and by
/// out-of-process plugins calling `jobs.spawn(tools.X, ...)`:
/// - an explicit path (contains a separator) is used verbatim;
/// - a bare name listed in the managed-bins registry
///   (`<data>/managed-bins/index.json`, written by the installer) resolves to
///   that installed binary, so the app and plugins run the SAME managed build;
/// - otherwise the bare name is returned unchanged and resolved via PATH
///   (tools installed through brew/conda).
fn resolve_spawn_cmd(app: &AppHandle, cmd: &str) -> String {
    if cmd.contains('/') || cmd.contains(std::path::MAIN_SEPARATOR) {
        return cmd.to_string();
    }
    managed_bin_path(app, cmd).unwrap_or_else(|| cmd.to_string())
}

/// Look up a bare tool name in the managed-bins registry, returning its
/// absolute path only if the registry lists it AND the file still exists.
fn managed_bin_path(app: &AppHandle, name: &str) -> Option<String> {
    let index_path = super::fs::base_dir(app, true).join("managed-bins/index.json");
    let raw = std::fs::read_to_string(index_path).ok()?;
    let index: Value = serde_json::from_str(&raw).ok()?;
    let path = index.get("bins")?.get(name)?.get("path")?.as_str()?;
    std::path::Path::new(path)
        .exists()
        .then(|| path.to_string())
}

async fn spawn_job(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    workspace_id: Option<String>,
    env: Option<HashMap<String, String>>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
    cleanup_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    if cmd.is_empty() || cmd.contains("..") {
        return Err(format!("invalid command: {cmd:?}"));
    }

    let job_id = gen_job_id();
    let started_at_ms = now_ms();

    // Resolve managed native tools to their installed binary; bare names fall
    // through to PATH. The JobEntry keeps the original `cmd` for display.
    let resolved = resolve_spawn_cmd(&app, &cmd);
    let mut command = app.shell().command(&resolved).args(&args);

    if let Some(dir) = cwd {
        command = command.current_dir(dir);
    }

    if let Some(env) = env {
        command = command.envs(env);
    }

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn '{resolved}': {e}"))?;

    let entry = JobEntry {
        id: job_id.clone(),
        cmd: cmd.clone(),
        args: args.clone(),
        label,
        kind,
        metadata,
        status: JobStatus::Running,
        started_at_ms,
        ended_at_ms: None,
        workspace_id,
        progress: None,
    };

    let stdout_buf = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::<String>::new()));

    {
        let registry = app.state::<JobRegistry>();
        let mut jobs = registry.0.lock().unwrap();
        jobs.insert(
            job_id.clone(),
            JobState {
                entry,
                child: Some(child),
                stdout: stdout_buf.clone(),
                stderr: stderr_buf.clone(),
            },
        );
    }

    // Stream stdout/stderr and update status on exit.
    let handle = app.clone();
    let jid = job_id.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    stdout_buf.lock().unwrap().push(text.clone());
                    let _ = handle.emit(&format!("jobs:stdout:{jid}"), text);
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    stderr_buf.lock().unwrap().push(text.clone());
                    let _ = handle.emit(&format!("jobs:stderr:{jid}"), text);
                }
                CommandEvent::Terminated(payload) => {
                    let exit_code = payload.code;
                    // Some Tauri shell backends report a normal completion with
                    // a missing exit code. Treat that as success unless the job
                    // was explicitly marked killed.
                    let ok = exit_code.map(|c| c == 0).unwrap_or(true);
                    let mut status = if ok {
                        JobStatus::Done { exit_code }
                    } else {
                        JobStatus::Failed { exit_code }
                    };
                    let mut event_ok = ok;

                    let ended_at_ms = now_ms();

                    {
                        let registry = handle.state::<JobRegistry>();
                        let mut jobs = registry.0.lock().unwrap();
                        if let Some(state) = jobs.get_mut(&jid) {
                            if state.entry.status == JobStatus::Killed {
                                status = JobStatus::Killed;
                                event_ok = false;
                            }
                            state.entry.status = status.clone();
                            state.entry.ended_at_ms = Some(ended_at_ms);
                            state.child = None;
                        }
                    }

                    let _ = handle.emit(
                        &format!("jobs:exit:{jid}"),
                        serde_json::json!({ "jobId": jid, "exitCode": exit_code, "ok": event_ok }),
                    );

                    if let Some(dir) = cleanup_dir.as_deref() {
                        let _ = std::fs::remove_dir_all(dir);
                    }
                }
                _ => {}
            }
        }
    });

    Ok(serde_json::json!({ "jobId": job_id }))
}

#[tauri::command]
pub fn lia_jobs_kill(app: AppHandle, job_id: String) -> Result<bool, String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.0.lock().unwrap();

    let state = jobs
        .get_mut(&job_id)
        .ok_or_else(|| format!("job not found: {job_id}"))?;

    if let Some(child) = state.child.take() {
        child.kill().map_err(|e| format!("kill failed: {e}"))?;
        state.entry.status = JobStatus::Killed;
        state.entry.ended_at_ms = Some(now_ms());
    }

    Ok(true)
}

#[tauri::command]
pub fn lia_jobs_status(app: AppHandle, job_id: String) -> Result<JobEntry, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.0.lock().unwrap();

    jobs.get(&job_id)
        .map(|s| s.entry.clone())
        .ok_or_else(|| format!("job not found: {job_id}"))
}

#[tauri::command]
pub fn lia_jobs_list(
    app: AppHandle,
    workspace_id: Option<String>,
    include_dev: Option<bool>,
) -> Result<Vec<JobEntry>, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.0.lock().unwrap();
    let include_dev = include_dev.unwrap_or(false);

    let mut list: Vec<JobEntry> = jobs
        .values()
        .map(|s| s.entry.clone())
        // When a workspace filter is given, only return jobs spawned in it.
        // When None, return everything (global view).
        .filter(|e| match &workspace_id {
            Some(ws) => e.workspace_id.as_deref() == Some(ws.as_str()),
            None => true,
        })
        .filter(|e| include_dev || !is_dev_job(e))
        .collect();
    list.sort_by_key(|e| e.started_at_ms);

    Ok(list)
}

#[tauri::command]
pub fn lia_jobs_clear_done(app: AppHandle, workspace_id: Option<String>) -> Result<usize, String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.0.lock().unwrap();

    let before = jobs.len();
    // Keep running jobs; also keep finished jobs that belong to *other*
    // workspaces when a workspace filter is provided.
    jobs.retain(|_, s| {
        if s.entry.status == JobStatus::Running {
            return true;
        }
        match &workspace_id {
            Some(ws) => s.entry.workspace_id.as_deref() != Some(ws.as_str()),
            None => false,
        }
    });

    Ok(before - jobs.len())
}

/// Returns buffered stdout/stderr lines for a job, optionally from a given offset.
/// `since` is the index of the first line to return (allows incremental polling).
#[tauri::command]
pub fn lia_jobs_get_output(
    app: AppHandle,
    job_id: String,
    since: Option<usize>,
) -> Result<JobOutput, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.0.lock().unwrap();

    let state = jobs
        .get(&job_id)
        .ok_or_else(|| format!("job not found: {job_id}"))?;

    let from = since.unwrap_or(0);
    let stdout_buffer = state.stdout.lock().unwrap();
    let stderr_buffer = state.stderr.lock().unwrap();
    Ok(JobOutput {
        stdout: stdout_buffer.iter().skip(from).cloned().collect(),
        stderr: stderr_buffer.iter().skip(from).cloned().collect(),
        stdout_total: stdout_buffer.len(),
        stderr_total: stderr_buffer.len(),
    })
}
