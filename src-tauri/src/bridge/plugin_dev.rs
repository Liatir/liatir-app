use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use super::lia_plugins::{
    python_env_id_for_manifest, read_manifest_from_bundle, run_lia_plugin_bundle,
    LiaPluginRunOptions, PYTHON_PLUGIN_DEV_ENV_ROOT,
};
use super::python_env::env_dir;

const PLUGIN_DEV_SCOPE: &str = "plugin-dev";

/// Prefix namespace for global variables written by plugin-dev sessions.
/// Session-scoped keys are `plugin-dev:<sessionId>:<key>`; everything under
/// the bare prefix is volatile and removed at session end / app startup.
pub(crate) const PLUGIN_DEV_GLOBAL_VARS_PREFIX: &str = "plugin-dev:";

pub(crate) fn session_global_vars_prefix(session_id: &str) -> String {
    format!("{PLUGIN_DEV_GLOBAL_VARS_PREFIX}{session_id}:")
}

/// Root (relative to the fs data/cache base) of ALL plugin-dev sandbox areas.
pub(crate) fn plugin_dev_sandbox_root_rel() -> String {
    format!("workspaces/{}/plugin-dev", super::jobs::SANDBOX_WORKSPACE_ID)
}

/// Per-session sandbox area (relative to the fs data/cache base). Single
/// source of truth for the IPC fs scoping and the end-of-session cleanup.
pub(crate) fn session_sandbox_rel(session_id: &str) -> String {
    format!("{}/{}", plugin_dev_sandbox_root_rel(), session_id)
}

/// Session ids come from the CLI over IPC and end up in filesystem paths
/// (sandbox dirs, python env cleanup), so only accept a safe charset.
pub(crate) fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("invalid plugin dev session id".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDevSession {
    pub session_id: String,
    pub project_dir: String,
    pub bundle_path: Option<String>,
    pub manifest: Option<Value>,
    pub runtime: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub build_id: Option<String>,
    pub initial_inputs: Option<Value>,
    pub updated_at_ms: u64,
    pub window_label: String,
}

#[derive(Debug, Clone)]
struct PluginDevSessionRecord {
    session: PluginDevSession,
    python_env_ids: HashSet<String>,
    job_ids: HashSet<String>,
}

pub struct PluginDevRegistry(Mutex<HashMap<String, PluginDevSessionRecord>>);

impl PluginDevRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

pub(crate) fn track_dev_job(app: &AppHandle, session_id: &str, job_id: &str) {
    let registry = app.state::<PluginDevRegistry>();
    let mut sessions = registry.0.lock().unwrap();
    if let Some(record) = sessions.get_mut(session_id) {
        record.job_ids.insert(job_id.to_string());
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn safe_label_part(value: &str) -> String {
    let mut clean = value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    while clean.contains("--") {
        clean = clean.replace("--", "-");
    }
    clean = clean.trim_matches('-').to_string();
    if clean.is_empty() {
        clean = "session".to_string();
    }
    clean.chars().take(48).collect()
}

fn session_window_label(session_id: &str) -> String {
    format!("plugin-dev-{}", safe_label_part(session_id))
}

fn manifest_runtime(manifest: &Value) -> String {
    manifest
        .get("runtime")
        .and_then(|value| value.as_str())
        .unwrap_or("node")
        .to_string()
}

fn manifest_name(manifest: Option<&Value>) -> String {
    manifest
        .and_then(|value| value.get("name"))
        .and_then(|value| value.as_str())
        .unwrap_or("Plugin dev session")
        .to_string()
}

fn dev_url(path_and_query: &str) -> Result<WebviewUrl, String> {
    let main_window_url = env!("MAIN_WINDOW_URL");
    if main_window_url.is_empty() {
        return Ok(WebviewUrl::App(path_and_query.into()));
    }

    let base = main_window_url.trim_end_matches('/');
    let url = format!("{base}{path_and_query}");
    Ok(WebviewUrl::External(
        url.parse::<Url>().map_err(|e| e.to_string())?,
    ))
}

fn upsert_record(
    registry: &PluginDevRegistry,
    session_id: String,
    project_dir: String,
    bundle_path: Option<String>,
    manifest: Option<Value>,
    status: String,
    error: Option<String>,
    build_id: Option<String>,
    initial_inputs: Option<Value>,
    python_env_id: Option<String>,
) -> PluginDevSession {
    let mut sessions = registry.0.lock().unwrap();
    let mut python_env_ids = sessions
        .get(&session_id)
        .map(|record| record.python_env_ids.clone())
        .unwrap_or_default();
    let job_ids = sessions
        .get(&session_id)
        .map(|record| record.job_ids.clone())
        .unwrap_or_default();

    if let Some(env_id) = python_env_id {
        python_env_ids.insert(env_id);
    }

    let previous = sessions.get(&session_id).map(|record| record.session.clone());
    let manifest = manifest.or_else(|| previous.as_ref().and_then(|session| session.manifest.clone()));
    let bundle_path = bundle_path.or_else(|| previous.as_ref().and_then(|session| session.bundle_path.clone()));
    let initial_inputs = initial_inputs.or_else(|| previous.as_ref().and_then(|session| session.initial_inputs.clone()));
    let runtime = manifest.as_ref().map(manifest_runtime);
    let session = PluginDevSession {
        session_id: session_id.clone(),
        project_dir,
        bundle_path,
        manifest,
        runtime,
        status,
        error,
        build_id,
        initial_inputs,
        updated_at_ms: now_ms(),
        window_label: session_window_label(&session_id),
    };

    sessions.insert(
        session_id,
        PluginDevSessionRecord {
            session: session.clone(),
            python_env_ids,
            job_ids,
        },
    );

    session
}

#[tauri::command]
pub async fn lia_plugin_dev_update_session(
    app: AppHandle,
    session_id: String,
    project_dir: String,
    bundle_path: String,
    build_id: Option<String>,
    initial_inputs: Option<Value>,
) -> Result<PluginDevSession, String> {
    validate_session_id(&session_id)?;
    let manifest = read_manifest_from_bundle(&bundle_path)?;
    let runtime = manifest_runtime(&manifest);
    let python_env_id = if runtime == "python" {
        Some(python_env_id_for_manifest(&manifest)?)
    } else {
        None
    };
    let registry = app.state::<PluginDevRegistry>();
    Ok(upsert_record(
        &registry,
        session_id,
        project_dir,
        Some(bundle_path),
        Some(manifest),
        "ready".to_string(),
        None,
        build_id,
        initial_inputs,
        python_env_id,
    ))
}

#[tauri::command]
pub fn lia_plugin_dev_set_error(
    app: AppHandle,
    session_id: String,
    project_dir: String,
    error: String,
    build_id: Option<String>,
    initial_inputs: Option<Value>,
) -> Result<PluginDevSession, String> {
    validate_session_id(&session_id)?;
    let registry = app.state::<PluginDevRegistry>();
    Ok(upsert_record(
        &registry,
        session_id,
        project_dir,
        None,
        None,
        "error".to_string(),
        Some(error),
        build_id,
        initial_inputs,
        None,
    ))
}

#[tauri::command]
pub fn lia_plugin_dev_get_session(
    app: AppHandle,
    session_id: String,
) -> Result<Option<PluginDevSession>, String> {
    let registry = app.state::<PluginDevRegistry>();
    let sessions = registry.0.lock().unwrap();
    Ok(sessions.get(&session_id).map(|record| record.session.clone()))
}

#[tauri::command]
pub fn lia_plugin_dev_list_jobs(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<super::jobs::JobEntry>, String> {
    let job_ids = {
        let registry = app.state::<PluginDevRegistry>();
        let sessions = registry.0.lock().unwrap();
        sessions
            .get(&session_id)
            .map(|record| record.job_ids.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    };

    let mut jobs = Vec::new();
    for job_id in job_ids {
        if let Ok(job) = super::jobs::lia_jobs_status(app.clone(), job_id) {
            jobs.push(job);
        }
    }
    jobs.sort_by_key(|job| job.started_at_ms);
    Ok(jobs)
}

#[tauri::command]
pub async fn lia_plugin_dev_open_session(
    app: AppHandle,
    session_id: String,
) -> Result<PluginDevSession, String> {
    let session = {
        let registry = app.state::<PluginDevRegistry>();
        let sessions = registry.0.lock().unwrap();
        sessions
            .get(&session_id)
            .map(|record| record.session.clone())
            .ok_or_else(|| "Plugin dev session not found.".to_string())?
    };

    if let Some(window) = app.get_webview_window(&session.window_label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(session);
    }

    let url = dev_url(&format!("/plugin-dev?session={}", session.session_id))?;
    let title = format!("Liatir Dev - {}", manifest_name(session.manifest.as_ref()));
    WebviewWindowBuilder::new(&app, &session.window_label, url)
        .title(title)
        .inner_size(980.0, 720.0)
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to open plugin dev window: {e}"))?;

    Ok(session)
}

#[tauri::command]
pub async fn lia_plugin_dev_run(
    app: AppHandle,
    session_id: String,
    inputs: Value,
) -> Result<Value, String> {
    let session = {
        let registry = app.state::<PluginDevRegistry>();
        let sessions = registry.0.lock().unwrap();
        sessions
            .get(&session_id)
            .map(|record| record.session.clone())
            .ok_or_else(|| "Plugin dev session not found.".to_string())?
    };

    if session.status != "ready" {
        return Err(session.error.unwrap_or_else(|| "Plugin dev session is not ready.".to_string()));
    }

    let bundle_path = session
        .bundle_path
        .clone()
        .ok_or_else(|| "Plugin dev session has no bundle.".to_string())?;

    let name = manifest_name(session.manifest.as_ref());
    let metadata = json!({
        "pluginDev": true,
        "pluginDevSessionId": session.session_id,
        "pluginDevProjectDir": session.project_dir,
        "pluginDevBuildId": session.build_id,
        "pluginDevRuntime": session.runtime,
        "devSession": true,
    });
    let mut env = HashMap::new();
    env.insert("LIATIR_RUN_SCOPE".to_string(), PLUGIN_DEV_SCOPE.to_string());
    env.insert("LIATIR_DEV_SESSION_ID".to_string(), session.session_id.clone());
    env.insert(
        "LIATIR_WORKSPACE_ID".to_string(),
        super::jobs::SANDBOX_WORKSPACE_ID.to_string(),
    );

    let run_result = run_lia_plugin_bundle(
        app.clone(),
        bundle_path,
        inputs,
        LiaPluginRunOptions {
            python_env_root: PYTHON_PLUGIN_DEV_ENV_ROOT.to_string(),
            workspace_id: Some(super::jobs::SANDBOX_WORKSPACE_ID.to_string()),
            env: Some(env),
            job_label: Some(format!("Liatir dev plugin: {name}")),
            job_kind: "lia-plugin-dev".to_string(),
            metadata: Some(metadata),
            wasm_storage_name: Some(format!("dev-{}.wasm", safe_label_part(&session.session_id))),
        },
    )
    .await?;

    if let Some(job_id) = run_result.get("jobId").and_then(|value| value.as_str()) {
        track_dev_job(&app, &session_id, job_id);
    }

    Ok(run_result)
}

#[tauri::command]
pub fn lia_plugin_dev_end_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let record = {
        let registry = app.state::<PluginDevRegistry>();
        let mut sessions = registry.0.lock().unwrap();
        sessions.remove(&session_id)
    };

    if let Some(record) = record {
        cleanup_record(&app, record, true)?;
    }

    Ok(())
}

/// Tear down everything a dev session created. Dev sessions are volatile by
/// design, so every step is best-effort: one failing removal must not keep
/// the rest of the session's residues alive.
fn cleanup_record(
    app: &AppHandle,
    record: PluginDevSessionRecord,
    close_window: bool,
) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();

    for job_id in &record.job_ids {
        let _ = super::jobs::lia_jobs_kill(app.clone(), job_id.clone());
    }

    for env_id in record.python_env_ids {
        match env_dir(app, PYTHON_PLUGIN_DEV_ENV_ROOT, &env_id) {
            Ok(dir) => {
                if dir.exists() {
                    if let Err(e) = std::fs::remove_dir_all(&dir) {
                        errors.push(format!("python env {env_id}: {e}"));
                    }
                }
            }
            Err(e) => errors.push(format!("python env {env_id}: {e}")),
        }
    }

    // Remove the session's sandbox fs area (data + cache).
    let sandbox_rel = session_sandbox_rel(&record.session.session_id);
    for permanent in [true, false] {
        let dir: PathBuf = super::fs::base_dir(app, permanent).join(&sandbox_rel);
        if dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                errors.push(format!("sandbox dir {}: {e}", dir.to_string_lossy()));
            }
        }
    }

    // Drop the session's namespaced global variables.
    if let Some(state) = app.try_state::<super::global_vars::EnvState>() {
        let prefix = session_global_vars_prefix(&record.session.session_id);
        if let Err(e) = super::global_vars::remove_vars_with_prefix(&state, &prefix) {
            errors.push(format!("global vars: {e}"));
        }
    }

    if close_window {
        if let Some(window) = app.get_webview_window(&record.session.window_label) {
            let _ = window.close();
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "plugin dev session cleanup left residues: {}",
            errors.join("; ")
        ))
    }
}

fn active_session_ids(app: &AppHandle) -> HashSet<String> {
    app.try_state::<PluginDevRegistry>()
        .map(|registry| registry.0.lock().unwrap().keys().cloned().collect())
        .unwrap_or_default()
}

fn active_python_env_ids(app: &AppHandle) -> HashSet<String> {
    app.try_state::<PluginDevRegistry>()
        .map(|registry| {
            registry
                .0
                .lock()
                .unwrap()
                .values()
                .flat_map(|record| record.python_env_ids.iter().cloned())
                .collect()
        })
        .unwrap_or_default()
}

/// Remove direct children of `dir` whose name is not in `keep`.
fn remove_orphan_children(dir: &Path, keep: &HashSet<String>, errors: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return; // A missing dir means there is nothing to clean.
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if keep.contains(&name) {
            continue;
        }
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(e) = removed {
            errors.push(format!("{}: {e}", path.to_string_lossy()));
        }
    }
}

/// Remove residues of dev sessions that are no longer active: python dev
/// envs, sandbox fs areas and namespaced global variables. The session
/// registry is in-memory, so after a crash everything found here is an
/// orphan. Safe to run while sessions are open — active ids are skipped.
/// Returns the list of (non-fatal) errors.
pub fn cleanup_orphan_dev_residues(app: &AppHandle) -> Vec<String> {
    let mut errors = Vec::new();
    let active_sessions = active_session_ids(app);
    let active_envs = active_python_env_ids(app);

    match super::python_env::data_root(app) {
        Ok(root) => remove_orphan_children(
            &root.join(PYTHON_PLUGIN_DEV_ENV_ROOT),
            &active_envs,
            &mut errors,
        ),
        Err(e) => errors.push(e),
    }

    for permanent in [true, false] {
        let root = super::fs::base_dir(app, permanent).join(plugin_dev_sandbox_root_rel());
        remove_orphan_children(&root, &active_sessions, &mut errors);
    }

    if let Some(state) = app.try_state::<super::global_vars::EnvState>() {
        let removed = super::global_vars::remove_vars_matching(&state, |key| {
            key.strip_prefix(PLUGIN_DEV_GLOBAL_VARS_PREFIX)
                .map(|rest| {
                    let session = rest.split(':').next().unwrap_or("");
                    !active_sessions.contains(session)
                })
                .unwrap_or(false)
        });
        if let Err(e) = removed {
            errors.push(format!("global vars: {e}"));
        }
    }

    errors
}

pub fn cleanup_dev_session_for_window(app: &AppHandle, label: &str) {
    if !label.starts_with("plugin-dev-") {
        return;
    }

    let session_id = {
        let registry = app.state::<PluginDevRegistry>();
        let sessions = registry.0.lock().unwrap();
        sessions
            .iter()
            .find(|(_, record)| record.session.window_label == label)
            .map(|(session_id, _)| session_id.clone())
    };

    if let Some(session_id) = session_id {
        let record = {
            let registry = app.state::<PluginDevRegistry>();
            let mut sessions = registry.0.lock().unwrap();
            sessions.remove(&session_id)
        };
        if let Some(record) = record {
            let _ = cleanup_record(app, record, false);
        }
    }
}
