use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard,
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

fn is_safe_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 128
        && job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
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
    Done {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    Failed {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
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
    /// Cooperative cancellation for in-process jobs such as WASM plugins.
    pub(crate) cancelled: Option<Arc<AtomicBool>>,
    /// Optional backend-specific cancellation invoked before the launcher is killed.
    pub(crate) kill_command: Option<JobKillCommand>,
}

#[derive(Debug, Clone)]
pub(crate) struct JobKillCommand {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    /// Written first so a run that has not published its Linux PID yet still observes cancellation.
    pub(crate) cancel_marker: Option<String>,
}

// ---------------------------------
// Registry (managed Tauri state)
// ---------------------------------

pub struct JobRegistry {
    pub(crate) jobs: Mutex<HashMap<String, JobState>>,
    job_start_gate: RwLock<()>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            job_start_gate: RwLock::new(()),
        }
    }

    /// Hold while a new Job is being registered. Application replacement takes
    /// the exclusive side of the same gate, closing the race between its final
    /// running-Job check and the native updater install call.
    pub(crate) fn allow_job_start(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        self.job_start_gate
            .read()
            .map_err(|_| "Job start gate is unavailable".to_string())
    }

    pub(crate) fn block_new_jobs_for_update(
        &self,
    ) -> Result<RwLockWriteGuard<'_, ()>, String> {
        self.job_start_gate
            .write()
            .map_err(|_| "Job start gate is unavailable".to_string())
    }

    /// Number of live Jobs owned by this app process. Application replacement
    /// must never interrupt them; the updater checks this both before download
    /// and immediately before installing the verified artifact.
    pub(crate) fn running_count(&self) -> Result<usize, String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "Job registry lock poisoned".to_string())?;
        Ok(jobs
            .values()
            .filter(|job| job.entry.status == JobStatus::Running)
            .count())
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
    stdout_path: Option<String>,
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
        stdout_path,
        None,
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
    stdout_path: Option<String>,
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
        stdout_path,
        cleanup_dir,
        None,
    )
    .await
}

pub(crate) async fn lia_jobs_spawn_with_kill_command(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    workspace_id: Option<String>,
    env: Option<HashMap<String, String>>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
    stdout_path: Option<String>,
    kill_command: JobKillCommand,
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
        stdout_path,
        None,
        Some(kill_command),
    )
    .await
}

/// Resolve a spawn target to what will actually be executed — the single source
/// of truth for native-tool resolution, shared by the app's own `runNativeTool`
/// and by out-of-process plugins calling `jobs.spawn(tools.X, ...)`:
/// - an explicit path (contains a separator) is used verbatim;
/// - a tool the application bundles resolves to the bundled environment, which
///   on Windows means running it inside WSL2 with its file arguments translated;
/// - a bare name listed in the managed-bins registry
///   (`<data>/managed-bins/index.json`, written by the installer) resolves to
///   that installed binary, so the app and plugins run the SAME managed build;
/// - otherwise the bare name is returned unchanged and resolved via PATH.
///
/// The bundle comes first deliberately: it is the build this release was tested
/// against, and preferring anything on the host would reintroduce the version
/// drift that bundling exists to remove.
pub(crate) fn resolve_spawn(
    app: &AppHandle,
    cmd: &str,
    args: &[String],
) -> Result<super::native_tools::ResolvedCommand, String> {
    if cmd.contains('/') || cmd.contains(std::path::MAIN_SEPARATOR) {
        return Ok(super::native_tools::ResolvedCommand {
            program: cmd.to_string(),
            args: args.to_vec(),
        });
    }
    if let Some(bundled) = super::native_tools::resolve(app, cmd, args)? {
        return Ok(bundled);
    }
    Ok(super::native_tools::ResolvedCommand {
        program: managed_bin_path(app, cmd).unwrap_or_else(|| cmd.to_string()),
        args: args.to_vec(),
    })
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
    stdout_path: Option<String>,
    cleanup_dir: Option<String>,
    kill_command: Option<JobKillCommand>,
) -> Result<serde_json::Value, String> {
    if cmd.is_empty() || cmd.contains("..") {
        return Err(format!("invalid command: {cmd:?}"));
    }

    let job_id = gen_job_id();
    let started_at_ms = now_ms();
    let stdout_file = if let Some(path) = stdout_path.as_deref() {
        let path = std::path::Path::new(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create stdout directory: {e}"))?;
        }
        Some(Arc::new(Mutex::new(
            std::fs::File::create(path)
                .map_err(|e| format!("cannot create stdout file: {e}"))?,
        )))
    } else {
        None
    };

    // Resolve to the bundled environment, then to a managed binary; bare names
    // fall through to PATH. The JobEntry keeps the original `cmd` and `args` for
    // display, so a Windows user still sees `samtools sort <their path>` rather
    // than the `wsl.exe` line that carries it.
    let resolved = resolve_spawn(&app, &cmd, &args)?;
    let mut command = app
        .shell()
        .command(&resolved.program)
        .args(&resolved.args);

    if let Some(dir) = cwd {
        command = command.current_dir(dir);
    }

    // Every spawned process learns its own job id, so the Liatir SDK's
    // log/progress calls (which read LIATIR_JOB_ID) target THIS job instead of
    // falling back to "unknown" — the previous behaviour that made
    // Liatir.progress fail with "job not found" and Liatir.log fail in dev.
    let mut env = env.unwrap_or_default();
    env.insert("LIATIR_JOB_ID".to_string(), job_id.clone());
    command = command.envs(env);

    let registry = app.state::<JobRegistry>();
    let _job_start = registry.allow_job_start()?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn '{}': {e}", resolved.program))?;

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
        let mut jobs = registry.jobs.lock().unwrap();
        jobs.insert(
            job_id.clone(),
            JobState {
                entry,
                child: Some(child),
                stdout: stdout_buf.clone(),
                stderr: stderr_buf.clone(),
                cancelled: None,
                kill_command,
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
                    if let Some(file) = stdout_file.as_ref() {
                        use std::io::Write;
                        let mut file = file.lock().unwrap();
                        let _ = file.write_all(&line);
                        if !line.ends_with(b"\n") {
                            let _ = file.write_all(b"\n");
                        }
                    } else {
                        stdout_buf.lock().unwrap().push(text.clone());
                    }
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
                        let mut jobs = registry.jobs.lock().unwrap();
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

/// Register work executed inside the app so it has the same Jobs lifecycle as
/// a child process. The returned cancellation flag is checked by the runner.
pub(crate) fn create_in_process_job(
    app: &AppHandle,
    cmd: String,
    args: Vec<String>,
    workspace_id: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
) -> (String, Arc<AtomicBool>) {
    loop {
        let job_id = gen_job_id();
        match create_in_process_job_with_id(
            app,
            job_id,
            cmd.clone(),
            args.clone(),
            workspace_id.clone(),
            label.clone(),
            kind.clone(),
            metadata.clone(),
        ) {
            Ok(job) => return job,
            Err(error) if error.starts_with("job ID already exists:") => continue,
            Err(error) => panic!("generated an invalid in-process Job ID: {error}"),
        }
    }
}

/// Register a caller-allocated stable Job ID. This is used when the frontend
/// must know the identity before an in-process WASM invocation starts so it can
/// attach cancellation and ownership immediately.
pub(crate) fn create_in_process_job_with_id(
    app: &AppHandle,
    job_id: String,
    cmd: String,
    args: Vec<String>,
    workspace_id: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
) -> Result<(String, Arc<AtomicBool>), String> {
    if !is_safe_job_id(&job_id) {
        return Err("job ID must contain only ASCII letters, numbers, '-' or '_'".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let entry = JobEntry {
        id: job_id.clone(),
        cmd,
        args,
        label,
        kind,
        metadata,
        status: JobStatus::Running,
        started_at_ms: now_ms(),
        ended_at_ms: None,
        workspace_id,
        progress: None,
    };
    let registry = app.state::<JobRegistry>();
    let _job_start = registry.allow_job_start()?;
    let mut jobs = registry.jobs.lock().unwrap();
    if jobs.contains_key(&job_id) {
        return Err(format!("job ID already exists: {job_id}"));
    }
    jobs.insert(
        job_id.clone(),
        JobState {
            entry,
            child: None,
            stdout: Arc::new(Mutex::new(Vec::new())),
            stderr: Arc::new(Mutex::new(Vec::new())),
            cancelled: Some(cancelled.clone()),
            kill_command: None,
        },
    );
    Ok((job_id, cancelled))
}

pub(crate) fn append_in_process_output(
    app: &AppHandle,
    job_id: &str,
    stream: &str,
    line: String,
) {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.jobs.lock().unwrap();
    let Some(state) = jobs.get(job_id) else { return };
    if stream == "stderr" {
        state.stderr.lock().unwrap().push(line.clone());
    } else {
        state.stdout.lock().unwrap().push(line.clone());
    }
    drop(jobs);
    let _ = app.emit(&format!("jobs:{stream}:{job_id}"), line);
}

pub(crate) fn finish_in_process_job(app: &AppHandle, job_id: &str, ok: bool) {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.jobs.lock().unwrap();
    let Some(state) = jobs.get_mut(job_id) else { return };
    if state.entry.status == JobStatus::Killed {
        return;
    }
    let exit_code = Some(if ok { 0 } else { 1 });
    state.entry.status = if ok {
        JobStatus::Done { exit_code }
    } else {
        JobStatus::Failed { exit_code }
    };
    state.entry.ended_at_ms = Some(now_ms());
    state.cancelled = None;
    drop(jobs);
    let _ = app.emit(
        &format!("jobs:exit:{job_id}"),
        serde_json::json!({ "jobId": job_id, "exitCode": exit_code, "ok": ok }),
    );
}

#[tauri::command]
pub fn lia_jobs_begin_logical(
    app: AppHandle,
    name: String,
    workspace_id: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("logical job name must not be empty".to_string());
    }
    let (job_id, _) = create_in_process_job(
        &app,
        name,
        Vec::new(),
        workspace_id,
        label,
        kind,
        metadata,
    );
    Ok(serde_json::json!({ "jobId": job_id }))
}

#[tauri::command]
pub fn lia_jobs_append_logical_output(
    app: AppHandle,
    job_id: String,
    stream: String,
    line: String,
) -> Result<(), String> {
    if stream != "stdout" && stream != "stderr" {
        return Err("stream must be stdout or stderr".to_string());
    }
    {
        let registry = app.state::<JobRegistry>();
        let jobs = registry.jobs.lock().unwrap();
        let state = jobs
            .get(&job_id)
            .ok_or_else(|| format!("job not found: {job_id}"))?;
        if state.child.is_some() || state.cancelled.is_none() {
            return Err("job is not an in-process logical job".to_string());
        }
        if state.entry.status != JobStatus::Running {
            return Err("logical job is already terminal".to_string());
        }
    }
    append_in_process_output(&app, &job_id, &stream, line);
    Ok(())
}

#[tauri::command]
pub fn lia_jobs_finish_logical(app: AppHandle, job_id: String, ok: bool) -> Result<(), String> {
    {
        let registry = app.state::<JobRegistry>();
        let jobs = registry.jobs.lock().unwrap();
        let state = jobs
            .get(&job_id)
            .ok_or_else(|| format!("job not found: {job_id}"))?;
        if state.child.is_some() || state.cancelled.is_none() {
            return Err("job is not an in-process logical job".to_string());
        }
    }
    finish_in_process_job(&app, &job_id, ok);
    Ok(())
}

fn kill_job_blocking(app: AppHandle, job_id: String) -> Result<bool, String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.jobs.lock().unwrap();

    let state = jobs
        .get_mut(&job_id)
        .ok_or_else(|| format!("job not found: {job_id}"))?;

    if state.entry.status != JobStatus::Running {
        return Ok(true);
    }
    if let Some(cancelled) = state.cancelled.as_ref() {
        cancelled.store(true, Ordering::SeqCst);
    }
    let child = state.child.take();
    let kill_command = state.kill_command.clone();
    let stderr = state.stderr.clone();
    state.entry.status = JobStatus::Killed;
    state.entry.ended_at_ms = Some(now_ms());
    let ended_at_ms = state.entry.ended_at_ms;
    drop(jobs);

    let mut cancellation_errors = Vec::new();
    if let Some(command) = kill_command {
        if let Some(marker) = command.cancel_marker.as_deref() {
            if let Err(error) = std::fs::write(marker, b"cancelled\n") {
                cancellation_errors.push(format!("could not write cancellation marker: {error}"));
            }
        }
        match std::process::Command::new(&command.program)
            .args(&command.args)
            .output()
        {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
                cancellation_errors.push(if detail.is_empty() {
                    format!("backend cancellation exited with {}", output.status)
                } else {
                    format!("backend cancellation failed: {detail}")
                });
            }
            Err(error) => cancellation_errors.push(format!("backend cancellation failed: {error}")),
        }
    }
    if let Some(child) = child {
        if let Err(error) = child.kill() {
            cancellation_errors.push(format!("launcher kill failed: {error}"));
        }
    }
    for error in &cancellation_errors {
        stderr.lock().unwrap().push(error.clone());
        let _ = app.emit(&format!("jobs:stderr:{job_id}"), error);
    }
    let _ = app.emit(
        &format!("jobs:exit:{job_id}"),
        serde_json::json!({ "jobId": job_id, "exitCode": null, "ok": false, "endedAtMs": ended_at_ms }),
    );

    Ok(cancellation_errors.is_empty())
}

pub(crate) fn lia_jobs_kill_blocking(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    kill_job_blocking(app, job_id)
}

#[tauri::command]
pub async fn lia_jobs_kill(app: AppHandle, job_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || kill_job_blocking(app, job_id))
        .await
        .map_err(|error| format!("Job cancellation task failed: {error}"))?
}

#[tauri::command]
pub fn lia_jobs_status(app: AppHandle, job_id: String) -> Result<JobEntry, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.jobs.lock().unwrap();

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
    let jobs = registry.jobs.lock().unwrap();
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
    let mut jobs = registry.jobs.lock().unwrap();

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
    let jobs = registry.jobs.lock().unwrap();

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

#[cfg(test)]
mod tests {
    use super::{is_safe_job_id, JobStatus};

    #[test]
    fn caller_allocated_job_ids_are_path_safe() {
        assert!(is_safe_job_id("fastqc-550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_safe_job_id("job_1"));
        assert!(!is_safe_job_id("../escape"));
        assert!(!is_safe_job_id("nested/job"));
        assert!(!is_safe_job_id(""));
        assert!(!is_safe_job_id(&"a".repeat(129)));
    }

    #[test]
    fn terminal_status_uses_the_shared_camel_case_exit_code_contract() {
        assert_eq!(
            serde_json::to_value(JobStatus::Done { exit_code: Some(0) }).unwrap(),
            serde_json::json!({ "type": "done", "exitCode": 0 })
        );
        assert_eq!(
            serde_json::to_value(JobStatus::Failed { exit_code: Some(17) }).unwrap(),
            serde_json::json!({ "type": "failed", "exitCode": 17 })
        );
    }
}
