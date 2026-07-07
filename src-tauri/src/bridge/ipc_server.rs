use std::{env, path::PathBuf, sync::Arc};

use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

const DEV_CONTEXT_PAYLOAD_KEY: &str = "__liatirDevContext";

/// Commands a plugin-dev session may never execute: they mutate global app
/// state (whole data/cache stores, trash, log files, the real plugin module
/// library, app lifecycle) and have no sandbox-scoped meaning. Everything
/// else is either already rewritten into the sandbox workspace or harmless.
const DEV_BLOCKED_COMMANDS: &[&str] = &[
    "lia_app_exit",
    "lia_fs_clear_data",
    "lia_fs_clear_cache",
    "lia_fs_data_clear_trash",
    "lia_fs_data_recover_trash",
    "lia_fs_diagnostics_clear",
    "lia_fs_diagnostics_rm",
    "lia_plugin_storage_clear",
];

#[derive(Debug, Clone)]
struct IpcDevContext {
    session_id: String,
}

/// Extract the dev context, if any. A present-but-malformed context is an
/// error (never fall back to executing the command unscoped), an absent one
/// simply means a normal non-dev invocation.
fn dev_context_from_payload(payload: &Value) -> Result<Option<IpcDevContext>, String> {
    let Some(raw) = payload.get(DEV_CONTEXT_PAYLOAD_KEY) else {
        return Ok(None);
    };
    let ctx = raw
        .as_object()
        .ok_or_else(|| "invalid liatir dev context".to_string())?;
    let scope = ctx.get("scope").and_then(Value::as_str).unwrap_or_default();
    if scope != "plugin-dev" {
        return Err(format!("unknown liatir dev context scope: {scope:?}"));
    }
    let session_id = ctx
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    crate::bridge::plugin_dev::validate_session_id(session_id)?;
    Ok(Some(IpcDevContext {
        session_id: session_id.to_string(),
    }))
}

/// In dev sessions, per-job commands may only touch jobs that live in the
/// sandbox workspace — the only workspace a dev plugin can spawn into.
fn ensure_dev_job_access(
    app: &AppHandle,
    ctx: Option<&IpcDevContext>,
    job_id: &str,
) -> anyhow::Result<()> {
    if ctx.is_none() {
        return Ok(());
    }
    let entry = crate::bridge::jobs::lia_jobs_status(app.clone(), job_id.to_string())
        .map_err(|e| anyhow::anyhow!(e))?;
    if entry.workspace_id.as_deref() != Some(crate::bridge::jobs::SANDBOX_WORKSPACE_ID) {
        return Err(anyhow::anyhow!(
            "job {job_id} is outside the sandbox workspace and cannot be accessed from a liatir dev session"
        ));
    }
    Ok(())
}

/// Namespace a global-variable key into the session's private space. Dev
/// plugins read/write global vars normally, but against their own volatile
/// namespace (removed at session end), never the app's real variables.
fn dev_global_var_key(ctx: &IpcDevContext, key: &str) -> String {
    format!(
        "{}{}",
        crate::bridge::plugin_dev::session_global_vars_prefix(&ctx.session_id),
        key
    )
}

fn merge_dev_job_metadata(metadata: Option<Value>, ctx: &IpcDevContext) -> Value {
    let mut map = match metadata {
        Some(Value::Object(map)) => map,
        Some(value) => {
            let mut map = Map::new();
            map.insert("value".to_string(), value);
            map
        }
        None => Map::new(),
    };
    map.insert("pluginDev".to_string(), Value::Bool(true));
    map.insert("pluginDevSessionId".to_string(), Value::String(ctx.session_id.clone()));
    Value::Object(map)
}

fn scoped_dev_rel(ctx: &IpcDevContext, value: &str) -> String {
    let clean = value.trim_matches('/');
    let base = crate::bridge::plugin_dev::session_sandbox_rel(&ctx.session_id);
    if clean == base || clean.starts_with(&format!("{base}/")) {
        return clean.to_string();
    }
    if clean.is_empty() {
        base
    } else {
        format!("{base}/{clean}")
    }
}

fn scope_dev_fs_payload(cmd: &str, payload: Value, ctx: Option<&IpcDevContext>) -> Value {
    let Some(ctx) = ctx else {
        return payload;
    };
    if !cmd.starts_with("lia_fs_") {
        return payload;
    }
    if matches!(
        cmd,
        "lia_fs_paths"
            | "lia_fs_clear_data"
            | "lia_fs_clear_cache"
            | "lia_fs_data_clear_trash"
            | "lia_fs_data_recover_trash"
    ) || cmd.contains("_diagnostics_")
        || cmd.contains("_trash_")
    {
        return payload;
    }

    let Value::Object(mut map) = payload else {
        return payload;
    };
    if map
        .get("pluginStoragePlugin")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Value::Object(map);
    }

    for key in ["rel", "src", "dest"] {
        if let Some(Value::String(value)) = map.get(key).cloned() {
            map.insert(key.to_string(), Value::String(scoped_dev_rel(ctx, &value)));
        }
    }
    Value::Object(map)
}

/// Generates IPC dispatch match-arms that forward a JSON payload to a
/// *synchronous* bridge command. Each entry maps a command name to its Rust
/// function plus the ordered `field: Type` list that follows the implicit
/// `AppHandle`. serde deserializes the payload (camelCase JSON → snake_case
/// fields) into a throwaway struct; the function's return value is serialized
/// back to JSON. A `null` payload (commands that take no extra args) is
/// normalized to `{}`.
///
/// This lets every non-GUI bridge area be exposed to .lia plugins with ONE
/// line per command instead of hand-written extraction boilerplate — calling
/// the SAME native commands the browser SDK uses, only over the IPC transport.
macro_rules! ipc_sync_dispatch {
    (
        $app:expr, $cmd:expr, $payload:expr;
        $( $name:literal => $func:path [ $( $field:ident : $ty:ty ),* $(,)? ] ),* $(,)?
    ) => {
        match $cmd {
            $(
                $name => {
                    #[derive(::serde::Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    #[allow(dead_code)]
                    struct Args { $( $field : $ty ),* }
                    // Commands with no arguments arrive with a null payload.
                    let raw = if $payload.is_null() {
                        ::serde_json::Value::Object(::serde_json::Map::new())
                    } else {
                        $payload
                    };
                    let a: Args = ::serde_json::from_value(raw)
                        .map_err(|e| anyhow::anyhow!("bad payload for {}: {}", $name, e))?;
                    let out = $func($app.clone(), $( a.$field ),*)
                        .map_err(|e| anyhow::anyhow!(e))?;
                    return Ok(::serde_json::to_value(out).unwrap_or(::serde_json::Value::Null));
                }
            )*
            _ => {}
        }
    };
}

/// Async variant of `ipc_sync_dispatch!` — for bridge commands declared
/// `pub async fn`. Identical mechanics, with `.await` on the call.
macro_rules! ipc_async_dispatch {
    (
        $app:expr, $cmd:expr, $payload:expr;
        $( $name:literal => $func:path [ $( $field:ident : $ty:ty ),* $(,)? ] ),* $(,)?
    ) => {
        match $cmd {
            $(
                $name => {
                    #[derive(::serde::Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    #[allow(dead_code)]
                    struct Args { $( $field : $ty ),* }
                    let raw = if $payload.is_null() {
                        ::serde_json::Value::Object(::serde_json::Map::new())
                    } else {
                        $payload
                    };
                    let a: Args = ::serde_json::from_value(raw)
                        .map_err(|e| anyhow::anyhow!("bad payload for {}: {}", $name, e))?;
                    let out = $func($app.clone(), $( a.$field ),*).await
                        .map_err(|e| anyhow::anyhow!(e))?;
                    return Ok(::serde_json::to_value(out).unwrap_or(::serde_json::Value::Null));
                }
            )*
            _ => {}
        }
    };
}

#[derive(Deserialize)]
struct InvokeRequest {
    cmd: String,
    payload: Option<Value>,
}

#[derive(Serialize)]
struct InvokeResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct ServerState {
    app: AppHandle,
    token: String,
}

fn legacy_ipc_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        let app_support = PathBuf::from(home).join("Library").join("Application Support");
        dirs.push(app_support.join("liatir"));
        dirs.push(app_support.join("app.liatir.app"));
        dirs.push(app_support.join("Liatir"));
    }

    #[cfg(target_os = "windows")]
    {
        let app_data = env::var_os("APPDATA").or_else(|| env::var_os("USERPROFILE"));
        if let Some(app_data) = app_data {
            let app_data = PathBuf::from(app_data);
            dirs.push(app_data.join("liatir"));
            dirs.push(app_data.join("app.liatir.app"));
            dirs.push(app_data.join("Liatir"));
        }
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let data_home = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")));
        if let Some(data_home) = data_home {
            dirs.push(data_home.join("liatir"));
            dirs.push(data_home.join("app.liatir.app"));
            dirs.push(data_home.join("Liatir"));
        }
    }

    dirs
}

async fn write_ipc_file(dir: PathBuf, content: &str) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(&dir).await?;
    tokio::fs::write(dir.join(".ipc"), content).await?;
    Ok(())
}

/// Start the local IPC HTTP server. Writes port + auth token to
/// `{app_data_dir}/.ipc` so the Node.js adapter can find it.
pub async fn start(app: AppHandle) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let token = uuid::Uuid::new_v4().to_string();

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("no app data dir: {e}"))?;
    let ipc_content = serde_json::to_string(&serde_json::json!({ "port": port, "token": token }))?;
    write_ipc_file(data_dir.clone(), &ipc_content).await?;

    for dir in legacy_ipc_dirs() {
        if dir != data_dir {
            if let Err(err) = write_ipc_file(dir.clone(), &ipc_content).await {
                eprintln!("[ipc_server] failed to write compatibility IPC file at {}: {err}", dir.display());
            }
        }
    }

    let state = Arc::new(ServerState { app, token });

    let router = Router::new()
        .route("/invoke", post(handle_invoke))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });

    Ok(())
}

async fn handle_invoke(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(req): Json<InvokeRequest>,
) -> (StatusCode, Json<InvokeResponse>) {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    if auth != Some(state.token.as_str()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(InvokeResponse {
                ok: false,
                result: None,
                error: Some("unauthorized".into()),
            }),
        );
    }

    match dispatch(&state.app, &req.cmd, req.payload.unwrap_or(Value::Null)).await {
        Ok(result) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: false,
                result: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch(app: &AppHandle, cmd: &str, payload: Value) -> anyhow::Result<Value> {
    let dev_context = dev_context_from_payload(&payload).map_err(|e| anyhow::anyhow!(e))?;
    if dev_context.is_some() && DEV_BLOCKED_COMMANDS.contains(&cmd) {
        return Err(anyhow::anyhow!(
            "{cmd} is not available in liatir dev sessions: it would change global Liatir state."
        ));
    }
    let payload = scope_dev_fs_payload(cmd, payload, dev_context.as_ref());
    // ── Filesystem bridge (scoped storage: data/cache, trash, diagnostics) ──
    // Same native commands window.Liatir.desktop.fs calls — exposed to .lia plugins.
    ipc_sync_dispatch!(app, cmd, payload;
        "lia_fs_list_dir" => crate::bridge::fs::lia_fs_list_dir[rel: String, permanent: bool, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_mkdir" => crate::bridge::fs::lia_fs_mkdir[rel: String, permanent: bool, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_rm" => crate::bridge::fs::lia_fs_rm[rel: String, permanent: bool, recursive: bool, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_stat" => crate::bridge::fs::lia_fs_stat[rel: String, permanent: bool, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_write_text" => crate::bridge::fs::lia_fs_write_text[rel: String, permanent: Option<bool>, contents: String, create_dirs: Option<bool>, append: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_read_text" => crate::bridge::fs::lia_fs_read_text[rel: String, permanent: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_write_bytes" => crate::bridge::fs::lia_fs_write_bytes[rel: String, permanent: Option<bool>, data_base64: String, create_dirs: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_read_bytes" => crate::bridge::fs::lia_fs_read_bytes[rel: String, permanent: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_exists" => crate::bridge::fs::lia_fs_exists[rel: String, permanent: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_move" => crate::bridge::fs::lia_fs_move[src: String, dest: String, permanent: Option<bool>, create_dirs: Option<bool>, overwrite: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_copy" => crate::bridge::fs::lia_fs_copy[src: String, dest: String, permanent: Option<bool>, recursive: Option<bool>, create_dirs: Option<bool>, overwrite: Option<bool>, window_label: Option<String>, plugin_storage_plugin: Option<String>],
        "lia_fs_clear_cache" => crate::bridge::fs::lia_fs_clear_cache[],
        "lia_fs_clear_data" => crate::bridge::fs::lia_fs_clear_data[],
        "lia_fs_data_clear_trash" => crate::bridge::fs::lia_fs_data_clear_trash[],
        "lia_fs_data_recover_trash" => crate::bridge::fs::lia_fs_data_recover_trash[trash_rel_path: String],
        "lia_fs_trash_list_dir" => crate::bridge::fs::lia_fs_trash_list_dir[rel: String],
        "lia_fs_trash_stat" => crate::bridge::fs::lia_fs_trash_stat[rel: String],
        "lia_fs_trash_exists" => crate::bridge::fs::lia_fs_trash_exists[rel: String],
        "lia_fs_trash_read_text" => crate::bridge::fs::lia_fs_trash_read_text[rel: String],
        "lia_fs_trash_read_bytes" => crate::bridge::fs::lia_fs_trash_read_bytes[rel: String],
        "lia_fs_diagnostics_clear" => crate::bridge::fs::lia_fs_diagnostics_clear[],
        "lia_fs_diagnostics_rm" => crate::bridge::fs::lia_fs_diagnostics_rm[rel: String, recursive: bool],
        "lia_fs_diagnostics_list_dir" => crate::bridge::fs::lia_fs_diagnostics_list_dir[rel: String],
        "lia_fs_diagnostics_stat" => crate::bridge::fs::lia_fs_diagnostics_stat[rel: String],
        "lia_fs_diagnostics_exists" => crate::bridge::fs::lia_fs_diagnostics_exists[rel: String],
        "lia_fs_diagnostics_read_text" => crate::bridge::fs::lia_fs_diagnostics_read_text[rel: String],
        "lia_fs_diagnostics_read_bytes" => crate::bridge::fs::lia_fs_diagnostics_read_bytes[rel: String],
        "lia_plugin_storage_clear" => crate::bridge::plugins::lia_plugin_storage_clear[plugin: Option<String>, module: Option<String>],
        // ── App / clipboard / events / notifications / plugins / diagnostics (sync) ──
        "lia_app_info" => crate::bridge::app::lia_app_info[],
        "lia_app_exit" => crate::bridge::app::lia_app_exit[code: i32],
        "lia_clipboard_write" => crate::bridge::clipboard::lia_clipboard_write[text: String],
        "lia_clipboard_read" => crate::bridge::clipboard::lia_clipboard_read[],
        "lia_event_emit" => crate::bridge::events::lia_event_emit[event: String, payload: Option<::serde_json::Value>],
        "lia_event_emit_to" => crate::bridge::events::lia_event_emit_to[window_label: String, event: String, payload: Option<::serde_json::Value>],
        "lia_notification_state" => crate::bridge::notifications::lia_notification_state[],
        "lia_request_permission" => crate::bridge::notifications::lia_request_permission[],
        "lia_notify" => crate::bridge::notifications::lia_notify[title: String, body: String],
        "lia_logs_list_files" => crate::bridge::diagnostics::lia_logs_list_files[area: String],
        "lia_logs_read_file" => crate::bridge::diagnostics::lia_logs_read_file[rel_path: String],
        "lia_logs_get_privacy" => crate::bridge::diagnostics::lia_logs_get_privacy[],
        "lia_logs_run_retention" => crate::bridge::diagnostics::lia_logs_run_retention[],
        "lia_logs_record_error" => crate::bridge::diagnostics::lia_logs_record_error[payload: crate::bridge::diagnostics::ErrorPayload, env: String, app_version: String],
        "lia_logs_record_js_error" => crate::bridge::diagnostics::lia_logs_record_js_error[payload: crate::bridge::diagnostics::ErrorPayload, app_version: String],
        "lia_logs_record_native_error" => crate::bridge::diagnostics::lia_logs_record_native_error[payload: crate::bridge::diagnostics::ErrorPayload, app_version: String],
        "lia_logs_new_record" => crate::bridge::diagnostics::lia_logs_new_record[record_type: String, payload: crate::bridge::diagnostics::AnalyticsRecord, env: String, app_version: String],
    );

    // ── Files / network / plugin-pick / export-zip (async) ──
    ipc_async_dispatch!(app, cmd, payload;
        "lia_file_open" => crate::bridge::files::lia_file_open[multi: bool, allowed_extensions: Option<Vec<String>>, max_bytes: Option<u64>],
        "lia_file_open_with_bytes" => crate::bridge::files::lia_file_open_with_bytes[multi: bool, allowed_extensions: Option<Vec<String>>, max_bytes: Option<u64>],
        "lia_file_save" => crate::bridge::files::lia_file_save[default_name: Option<String>],
        "lia_network_get_status" => crate::bridge::network::lia_network_get_status[],
        "lia_network_ping" => crate::bridge::network::lia_network_ping[url: Option<String>, timeout_ms: Option<u64>],
        "lia_network_bandwidth_estimate" => crate::bridge::network::lia_network_bandwidth_estimate[url: Option<String>, size_hint_bytes: Option<u64>, timeout_ms: Option<u64>],
        "lia_network_set_monitor" => crate::bridge::network::lia_network_set_monitor[interval_ms: u64, targets: Option<Vec<String>>],
        "lia_logs_export_zip" => crate::bridge::diagnostics::lia_logs_export_zip[],
    );

    match cmd {
        // ── Cases the macros can't express ───────────────────────────────
        // Global variables use a managed State, not AppHandle.
        // Global vars: dev sessions read/write a private per-session namespace
        // (prefixed keys, stripped on list) instead of the real app variables.
        "lia_global_vars_get" => {
            let mut key = payload["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?.to_string();
            if let Some(ctx) = dev_context.as_ref() {
                key = dev_global_var_key(ctx, &key);
            }
            return crate::bridge::global_vars::lia_global_vars_get(key, app.state::<crate::bridge::global_vars::EnvState>())
                .map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
                .map_err(|e| anyhow::anyhow!(e));
        }
        "lia_global_vars_set" => {
            let mut key = payload["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?.to_string();
            let value = payload["value"].as_str().ok_or_else(|| anyhow::anyhow!("value required"))?.to_string();
            if let Some(ctx) = dev_context.as_ref() {
                key = dev_global_var_key(ctx, &key);
            }
            return crate::bridge::global_vars::lia_global_vars_set(key, value, app.state::<crate::bridge::global_vars::EnvState>())
                .map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
                .map_err(|e| anyhow::anyhow!(e));
        }
        "lia_global_vars_remove" => {
            let mut key = payload["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?.to_string();
            if let Some(ctx) = dev_context.as_ref() {
                key = dev_global_var_key(ctx, &key);
            }
            return crate::bridge::global_vars::lia_global_vars_remove(key, app.state::<crate::bridge::global_vars::EnvState>())
                .map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
                .map_err(|e| anyhow::anyhow!(e));
        }
        "lia_global_vars_list" => {
            let vars = crate::bridge::global_vars::lia_global_vars_list(app.state::<crate::bridge::global_vars::EnvState>())
                .map_err(|e| anyhow::anyhow!(e))?;
            let vars = match dev_context.as_ref() {
                Some(ctx) => {
                    let prefix = crate::bridge::plugin_dev::session_global_vars_prefix(&ctx.session_id);
                    vars.into_iter()
                        .filter_map(|(key, value)| {
                            key.strip_prefix(&prefix).map(|bare| (bare.to_string(), value))
                        })
                        .collect()
                }
                None => vars,
            };
            return Ok(serde_json::to_value(vars).unwrap_or(Value::Null));
        }
        // Network commands that take no AppHandle.
        "lia_network_resolve" => {
            let host = payload["host"].as_str().ok_or_else(|| anyhow::anyhow!("host required"))?.to_string();
            return crate::bridge::network::lia_network_resolve(host).await
                .map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
                .map_err(|e| anyhow::anyhow!(e));
        }
        "lia_network_stop_monitor" => {
            return crate::bridge::network::lia_network_stop_monitor().await
                .map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
                .map_err(|e| anyhow::anyhow!(e));
        }
        "lia_jobs_spawn" => {
            let cmd_str = payload["cmd"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("cmd required"))?
                .to_string();
            let args: Vec<String> = payload["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let cwd = payload["cwd"].as_str().map(String::from);
            let workspace_id = dev_context
                .as_ref()
                .map(|_| crate::bridge::jobs::SANDBOX_WORKSPACE_ID.to_string())
                .or_else(|| payload["workspaceId"].as_str().map(String::from));
            let env: Option<std::collections::HashMap<String, String>> = payload["env"]
                .as_object()
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(key, value)| value.as_str().map(|s| (key.clone(), s.to_string())))
                        .collect()
                });
            let label = payload["label"].as_str().map(String::from);
            let kind = match dev_context.as_ref() {
                Some(_) => Some(
                    payload["kind"]
                        .as_str()
                        .filter(|kind| kind.starts_with("lia-plugin-dev"))
                        .unwrap_or("lia-plugin-dev-child")
                        .to_string(),
                ),
                None => payload["kind"].as_str().map(String::from),
            };
            let metadata = payload.get("metadata").filter(|value| !value.is_null()).cloned();
            let metadata = match dev_context.as_ref() {
                Some(ctx) => Some(merge_dev_job_metadata(metadata, ctx)),
                None => metadata,
            };

            let result = crate::bridge::jobs::lia_jobs_spawn(
                app.clone(),
                cmd_str,
                args,
                cwd,
                workspace_id,
                env,
                label,
                kind,
                metadata,
            )
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            if let Some(ctx) = dev_context.as_ref() {
                if let Some(job_id) = result.get("jobId").and_then(Value::as_str) {
                    crate::bridge::plugin_dev::track_dev_job(app, &ctx.session_id, job_id);
                }
            }
            Ok(result)
        }

        "lia_jobs_kill" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            ensure_dev_job_access(app, dev_context.as_ref(), &job_id)?;
            let ok = crate::bridge::jobs::lia_jobs_kill(app.clone(), job_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::json!(ok))
        }

        "lia_jobs_status" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            ensure_dev_job_access(app, dev_context.as_ref(), &job_id)?;
            let entry = crate::bridge::jobs::lia_jobs_status(app.clone(), job_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(entry)?)
        }

        "lia_jobs_list" => {
            let workspace_id = payload["workspaceId"].as_str().map(String::from);
            let include_dev = payload["includeDev"].as_bool();
            let list = crate::bridge::jobs::lia_jobs_list(app.clone(), workspace_id, include_dev)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(list)?)
        }

        "lia_jobs_get_output" => {
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            ensure_dev_job_access(app, dev_context.as_ref(), &job_id)?;
            let since = payload["since"].as_u64().map(|n| n as usize);
            let output = crate::bridge::jobs::lia_jobs_get_output(app.clone(), job_id, since)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(output)?)
        }

        "lia_deps_check" => {
            let name = payload["name"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("name required"))?
                .to_string();
            let result = crate::bridge::deps::lia_deps_check(name)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(result)
        }

        "lia_deps_check_many" => {
            let names: Vec<String> = payload["names"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .ok_or_else(|| anyhow::anyhow!("names required"))?;
            let result = crate::bridge::deps::lia_deps_check_many(names)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_fs_paths" => {
            let result = crate::bridge::fs::lia_fs_paths(app.clone())
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_liatir_read_manifest" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            crate::bridge::lia_plugins::lia_liatir_read_manifest(path)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        "lia_liatir_python_runtime_status" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let result =
                crate::bridge::lia_plugins::lia_liatir_python_runtime_status(app.clone(), path)
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_liatir_python_runtime_prepare" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let result =
                crate::bridge::lia_plugins::lia_liatir_python_runtime_prepare(app.clone(), path)
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(result)?)
        }

        "lia_liatir_run" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let inputs = payload["inputs"].clone();
            match dev_context.as_ref() {
                // Plugin-to-plugin runs started from a dev session stay in the
                // sandbox workspace and are tracked (and killed) with the session.
                Some(ctx) => {
                    let mut env = std::collections::HashMap::new();
                    env.insert("LIATIR_RUN_SCOPE".to_string(), "plugin-dev".to_string());
                    env.insert("LIATIR_DEV_SESSION_ID".to_string(), ctx.session_id.clone());
                    env.insert(
                        "LIATIR_WORKSPACE_ID".to_string(),
                        crate::bridge::jobs::SANDBOX_WORKSPACE_ID.to_string(),
                    );
                    let result = crate::bridge::lia_plugins::run_lia_plugin_bundle(
                        app.clone(),
                        path,
                        inputs,
                        crate::bridge::lia_plugins::LiaPluginRunOptions {
                            workspace_id: Some(crate::bridge::jobs::SANDBOX_WORKSPACE_ID.to_string()),
                            env: Some(env),
                            job_kind: "lia-plugin-dev-child".to_string(),
                            metadata: Some(merge_dev_job_metadata(None, ctx)),
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
                    if let Some(job_id) = result.get("jobId").and_then(Value::as_str) {
                        crate::bridge::plugin_dev::track_dev_job(app, &ctx.session_id, job_id);
                    }
                    Ok(result)
                }
                None => crate::bridge::lia_plugins::lia_liatir_run(app.clone(), path, inputs)
                    .await
                    .map_err(|e| anyhow::anyhow!(e)),
            }
        }

        "lia_plugin_dev_update_session" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let project_dir = payload["projectDir"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("projectDir required"))?
                .to_string();
            let bundle_path = payload["bundlePath"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("bundlePath required"))?
                .to_string();
            let build_id = payload["buildId"].as_str().map(String::from);
            let initial_inputs = payload.get("initialInputs").filter(|value| !value.is_null()).cloned();
            let session = crate::bridge::plugin_dev::lia_plugin_dev_update_session(
                app.clone(),
                session_id,
                project_dir,
                bundle_path,
                build_id,
                initial_inputs,
            )
            .await
            .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(session)?)
        }

        "lia_plugin_dev_set_error" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let project_dir = payload["projectDir"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("projectDir required"))?
                .to_string();
            let error = payload["error"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("error required"))?
                .to_string();
            let build_id = payload["buildId"].as_str().map(String::from);
            let initial_inputs = payload.get("initialInputs").filter(|value| !value.is_null()).cloned();
            let session = crate::bridge::plugin_dev::lia_plugin_dev_set_error(
                app.clone(),
                session_id,
                project_dir,
                error,
                build_id,
                initial_inputs,
            )
            .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(session)?)
        }

        "lia_plugin_dev_get_session" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let session = crate::bridge::plugin_dev::lia_plugin_dev_get_session(app.clone(), session_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(session)?)
        }

        "lia_plugin_dev_list_jobs" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let jobs = crate::bridge::plugin_dev::lia_plugin_dev_list_jobs(app.clone(), session_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(jobs)?)
        }

        "lia_plugin_dev_open_session" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let session = crate::bridge::plugin_dev::lia_plugin_dev_open_session(app.clone(), session_id)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(serde_json::to_value(session)?)
        }

        "lia_plugin_dev_run" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            let inputs = payload["inputs"].clone();
            crate::bridge::plugin_dev::lia_plugin_dev_run(app.clone(), session_id, inputs)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        "lia_plugin_dev_end_session" => {
            let session_id = payload["sessionId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("sessionId required"))?
                .to_string();
            crate::bridge::plugin_dev::lia_plugin_dev_end_session(app.clone(), session_id)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(Value::Null)
        }

        "lia_read_file_text" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let text = crate::bridge::managed_bins::lia_read_file_text(path)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(Value::String(text))
        }

        "lia_preview_file" => {
            let path = payload["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("path required"))?
                .to_string();
            let lines = payload["lines"].as_u64().unwrap_or(50) as usize;
            let text = crate::bridge::managed_bins::lia_preview_file(path, lines)
                .map_err(|e| anyhow::anyhow!(e))?;
            Ok(Value::String(text))
        }

        // WASM custom-tool runtime — lets .lia plugins invoke a compiled plugin
        // (e.g. fastqc) by name with a JSON payload, optionally exposing host
        // directories read-only (needed to read FASTQ/BAM files from disk).
        "lia_plugin_call" => {
            let plugin = payload["plugin"]
                .as_str()
                .or_else(|| payload["module"].as_str())
                .ok_or_else(|| anyhow::anyhow!("plugin required"))?
                .to_string();
            let plugin_payload = payload["payload"].clone();
            let timeout_ms = payload["timeoutMs"].as_u64();
            let host_read_paths = payload["hostReadPaths"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect());
            crate::bridge::plugins::lia_plugin_call(app.clone(), Some(plugin), None, plugin_payload, timeout_ms, host_read_paths)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        // ── Native bio tools ─────────────────────────────────────────────
        // Exposed to .lia plugins so the typed bio wrappers in `@liatir/api`
        // (Liatir.align.*, Liatir.variants.*, …) can call the SAME native
        // commands the desktop UI uses — reusing reference auto-indexing,
        // output redirection and stat parsing instead of re-implementing them.

        // BWA-MEM — short-read alignment → SAM. Auto-indexes the reference on first use.
        "lia_bwa_mem" => {
            let reference = payload["reference"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("reference required"))?
                .to_string();
            let reads_r1 = payload["readsR1"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("readsR1 required"))?
                .to_string();
            // Optional second mate for paired-end reads.
            let reads_r2 = payload["readsR2"].as_str().map(String::from);
            let output_sam = payload["outputSam"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputSam required"))?
                .to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            let threads = payload["threads"].as_u64().map(|value| value as usize);
            crate::bridge::bwa::lia_bwa_mem(app.clone(), reference, reads_r1, reads_r2, output_sam, job_id, threads)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        // minimap2 — long/short-read alignment → SAM. `preset` picks the mode (sr, lr, map-ont, …).
        "lia_minimap2" => {
            let preset = payload["preset"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("preset required"))?
                .to_string();
            let reference = payload["reference"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("reference required"))?
                .to_string();
            let reads_r1 = payload["readsR1"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("readsR1 required"))?
                .to_string();
            let reads_r2 = payload["readsR2"].as_str().map(String::from);
            let output_sam = payload["outputSam"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputSam required"))?
                .to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            let threads = payload["threads"].as_u64().map(|value| value as usize);
            crate::bridge::minimap2::lia_minimap2(app.clone(), preset, reference, reads_r1, reads_r2, output_sam, job_id, threads)
                .await
                .map_err(|e| anyhow::anyhow!(e))
        }

        // SnpEff — functional variant annotation (VCF → annotated VCF + stats). Needs a configured JAR.
        "lia_snpeff_annotate" => {
            let jar_path = payload["jarPath"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jarPath required"))?
                .to_string();
            let genome = payload["genome"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("genome required"))?
                .to_string();
            let data_dir = payload["dataDir"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("dataDir required"))?
                .to_string();
            let input_vcf = payload["inputVcf"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("inputVcf required"))?
                .to_string();
            let output_vcf = payload["outputVcf"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("outputVcf required"))?
                .to_string();
            // JVM heap (e.g. "4g"); falls back to a sane default if omitted.
            let heap = payload["heap"].as_str().unwrap_or("4g").to_string();
            let job_id = payload["jobId"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("jobId required"))?
                .to_string();
            // Optional explicit java binary; None lets the command resolve it.
            let java_path = payload["javaPath"].as_str().map(String::from);
            crate::bridge::snpeff::lia_snpeff_annotate(
                app.clone(), jar_path, genome, data_dir, input_vcf, output_vcf, heap, job_id, java_path,
            )
            .await
            .map_err(|e| anyhow::anyhow!(e))
        }

        _ => Err(anyhow::anyhow!("unknown command: {cmd}")),
    }
}
