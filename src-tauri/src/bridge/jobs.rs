use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

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
    pub status: JobStatus,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
}

struct JobState {
    entry: JobEntry,
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

// ---------------------------------
// Registry (managed Tauri state)
// ---------------------------------

pub struct JobRegistry(pub Mutex<HashMap<String, JobState>>);

impl JobRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------
// Public Tauri commands
// ---------------------------------

#[tauri::command]
pub async fn dtr_jobs_spawn(
    app: AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    if cmd.is_empty() || cmd.contains("..") {
        return Err(format!("invalid command: {cmd:?}"));
    }

    let job_id = gen_job_id();
    let started_at_ms = now_ms();

    let mut command = app
        .shell()
        .command(&cmd)
        .args(&args);

    if let Some(dir) = cwd {
        command = command.current_dir(dir);
    }

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn '{cmd}': {e}"))?;

    let entry = JobEntry {
        id: job_id.clone(),
        cmd: cmd.clone(),
        args: args.clone(),
        status: JobStatus::Running,
        started_at_ms,
        ended_at_ms: None,
    };

    {
        let registry = app.state::<JobRegistry>();
        let mut jobs = registry.0.lock().unwrap();
        jobs.insert(job_id.clone(), JobState { entry, child: Some(child) });
    }

    // Stream stdout/stderr and update status on exit.
    let handle = app.clone();
    let jid = job_id.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = handle.emit(
                        &format!("jobs:stdout:{jid}"),
                        String::from_utf8_lossy(&line).trim_end().to_string(),
                    );
                }
                CommandEvent::Stderr(line) => {
                    let _ = handle.emit(
                        &format!("jobs:stderr:{jid}"),
                        String::from_utf8_lossy(&line).trim_end().to_string(),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let exit_code = payload.code;
                    let ok = exit_code.map(|c| c == 0).unwrap_or(false);
                    let status = if ok {
                        JobStatus::Done { exit_code }
                    } else {
                        JobStatus::Failed { exit_code }
                    };

                    let ended_at_ms = now_ms();

                    {
                        let registry = handle.state::<JobRegistry>();
                        let mut jobs = registry.0.lock().unwrap();
                        if let Some(state) = jobs.get_mut(&jid) {
                            state.entry.status = status.clone();
                            state.entry.ended_at_ms = Some(ended_at_ms);
                            state.child = None;
                        }
                    }

                    let _ = handle.emit(
                        &format!("jobs:exit:{jid}"),
                        serde_json::json!({ "jobId": jid, "exitCode": exit_code, "ok": ok }),
                    );
                }
                _ => {}
            }
        }
    });

    Ok(serde_json::json!({ "jobId": job_id }))
}

#[tauri::command]
pub fn dtr_jobs_kill(app: AppHandle, job_id: String) -> Result<bool, String> {
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
pub fn dtr_jobs_status(app: AppHandle, job_id: String) -> Result<JobEntry, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.0.lock().unwrap();

    jobs.get(&job_id)
        .map(|s| s.entry.clone())
        .ok_or_else(|| format!("job not found: {job_id}"))
}

#[tauri::command]
pub fn dtr_jobs_list(app: AppHandle) -> Result<Vec<JobEntry>, String> {
    let registry = app.state::<JobRegistry>();
    let jobs = registry.0.lock().unwrap();

    let mut list: Vec<JobEntry> = jobs.values().map(|s| s.entry.clone()).collect();
    list.sort_by_key(|e| e.started_at_ms);

    Ok(list)
}

#[tauri::command]
pub fn dtr_jobs_clear_done(app: AppHandle) -> Result<usize, String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.0.lock().unwrap();

    let before = jobs.len();
    jobs.retain(|_, s| s.entry.status == JobStatus::Running);

    Ok(before - jobs.len())
}
