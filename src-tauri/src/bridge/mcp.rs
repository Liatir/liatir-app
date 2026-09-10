//! Controlled, local-only MCP surface.
//!
//! The protocol endpoint deliberately does not reuse the broad plugin IPC
//! token or dispatcher. It can read only the active workspace and MCP-owned
//! run evidence, and it can request only three mutations: run one exact saved
//! pipeline revision, cancel one MCP-owned run, or cancel a Job owned by one.

use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{
        atomic::{AtomicU16, Ordering},
        Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{DefaultBodyLimit, Request},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rmcp::{
    model::{
        CacheScope, CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock,
        Implementation, JsonObject, ListResourceTemplatesResult, ListResourcesResult, ListToolsResult,
        PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse,
        ReadResourceResult, Resource, ResourceContents, ResourceTemplate, ServerCapabilities,
        ServerInfo, Tool, ToolAnnotations,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpService,
        StreamableHttpServerConfig,
    },
    ErrorData as McpError, RoleServer, ServerHandler,
};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use uuid::Uuid;

use super::app_storage::{resolve_app_path, write_text_atomic};

const SCHEMA_VERSION: u64 = 1;
const CONFIG_PATH: &str = "mcp/config.json";
const REQUESTS_PATH: &str = "mcp/requests.json";
const AUDIT_PATH: &str = "mcp/audit.json";
const MAX_REQUESTS: usize = 500;
const MAX_AUDIT_RECORDS: usize = 1_000;
const MAX_RESOURCE_RUNS: usize = 100;
const MAX_RESOURCE_RESULTS: usize = 200;
const MAX_ARTIFACT_CHUNK_BYTES: usize = 64 * 1024;
const MAX_MCP_REQUEST_BYTES: usize = 1024 * 1024;

const START_SAVED_PIPELINE: &str = "start_saved_pipeline";
const CANCEL_PIPELINE_RUN: &str = "cancel_pipeline_run";
const CANCEL_JOB: &str = "cancel_job";

const ACTIVE_WORKSPACE_URI: &str = "liatir://workspace/active";
const ALLOWED_PIPELINES_URI: &str = "liatir://workspace/active/pipelines";
const RUNS_URI: &str = "liatir://runs";
const JOBS_URI: &str = "liatir://jobs";
const RESULTS_URI: &str = "liatir://results";
const ARTIFACTS_URI: &str = "liatir://artifacts";
const RUN_STATUS_PREFIX: &str = "liatir://runs/";
const JOB_PREFIX: &str = "liatir://jobs/";
const RESULT_PREFIX: &str = "liatir://results/";
const ARTIFACT_PREFIX: &str = "liatir://artifacts/";

const EVENT_AUTHORIZATION_REQUESTED: &str = "mcp:authorization-requested";
const EVENT_CANCEL_REQUESTED: &str = "mcp:cancel-requested";
const EVENT_STATE_CHANGED: &str = "mcp:state-changed";

/// Runtime-only state. Durable policy and audit data remain in app storage.
pub struct McpRuntimeState {
    port: AtomicU16,
    storage: Mutex<()>,
}

impl McpRuntimeState {
    pub fn new() -> Self {
        Self {
            port: AtomicU16::new(0),
            storage: Mutex::new(()),
        }
    }

    fn endpoint(&self) -> Option<String> {
        let port = self.port.load(Ordering::Acquire);
        (port != 0).then(|| format!("http://127.0.0.1:{port}/mcp"))
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.storage
            .lock()
            .map_err(|_| "MCP storage lock is poisoned".to_string())
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn valid_bearer_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn default_config() -> Value {
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "enabled": false,
        "bearerToken": new_token(),
        "allowlist": [],
        "resultWorkspaces": [],
        "dataAllowlist": [],
        "dataFolderAllowlist": [],
        "updatedAt": now_ms(),
    })
}

fn ensure_mcp_dir(app: &AppHandle) -> Result<(), String> {
    let path = resolve_app_path(app, "mcp")?;
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn read_json(app: &AppHandle, rel: &str, missing: Value) -> Result<Value, String> {
    let path = resolve_app_path(app, rel)?;
    if !path.exists() {
        return Ok(missing);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("Invalid {rel}: {error}"))
}

/// `read_json`, resolved against the data root rather than app storage.
fn read_run_json(app: &AppHandle, rel: &str, missing: Value) -> Result<Value, String> {
    let path = resolve_run_path(app, rel)?;
    if !path.exists() {
        return Ok(missing);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("Invalid {rel}: {error}"))
}

/// Resolve a path inside a run directory.
///
/// Run directories live in the **data** root, not app storage: they hold files the user produced,
/// which native tools write by absolute path and the Data library points at. App storage is a
/// subdirectory of that same root reserved for Liatir's own state — the history index lives there,
/// but the runs it indexes do not.
fn resolve_run_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    crate::bridge::fs::lia_fs_safe_join_data(app, rel)
}

/// A run's transcript, one JSON object per line.
///
/// Lines, not one array, because a transcript is appended to while a run is in progress. A line
/// that will not parse is skipped rather than failing the read: one corrupted entry must not cost
/// the caller the rest of the log, which is usually the part explaining what went wrong.
fn read_run_log(app: &AppHandle, rel: &str) -> Result<Value, String> {
    let path = resolve_run_path(app, rel)?;
    if !path.exists() {
        return Ok(json!([]));
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let entries: Vec<Value> = raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();
    Ok(Value::Array(entries))
}

fn write_json(app: &AppHandle, rel: &str, value: &Value, private: bool) -> Result<(), String> {
    ensure_mcp_dir(app)?;
    let path = resolve_app_path(app, rel)?;
    let serialized = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    write_text_atomic(&path, &serialized)?;

    #[cfg(unix)]
    if private {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn load_config(app: &AppHandle) -> Result<Value, String> {
    let path = resolve_app_path(app, CONFIG_PATH)?;
    if path.exists() {
        let mut config = read_json(app, CONFIG_PATH, Value::Null)?;
        let mut migrated = false;
        if config.get("schemaVersion").and_then(Value::as_u64) == Some(SCHEMA_VERSION) {
            if config.get("resultWorkspaces").is_none() {
                config["resultWorkspaces"] = json!([]);
                migrated = true;
            }
            if config.get("dataAllowlist").is_none() {
                config["dataAllowlist"] = json!([]);
                migrated = true;
            }
            if config.get("dataFolderAllowlist").is_none() {
                config["dataFolderAllowlist"] = json!([]);
                migrated = true;
            }
            if let Some(grants) = config.get_mut("allowlist").and_then(Value::as_array_mut) {
                let previous_len = grants.len();
                grants.retain(|grant| {
                    grant
                        .get("inputs")
                        .and_then(Value::as_array)
                        .is_some_and(|inputs| validate_input_descriptors(inputs).is_ok())
                });
                migrated |= grants.len() != previous_len;
            }
        }
        validate_config(&config)?;
        if migrated {
            write_json(app, CONFIG_PATH, &config, true)?;
        }
        return Ok(config);
    }

    let config = default_config();
    write_json(app, CONFIG_PATH, &config, true)?;
    Ok(config)
}

fn validate_config(config: &Value) -> Result<(), String> {
    if config.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        return Err("Unsupported MCP configuration schema version".to_string());
    }
    let Some(token) = config.get("bearerToken").and_then(Value::as_str) else {
        return Err("Invalid MCP configuration".to_string());
    };
    if config.get("enabled").and_then(Value::as_bool).is_none()
        || !valid_bearer_token(token)
        || config.get("allowlist").and_then(Value::as_array).is_none()
        || config.get("resultWorkspaces").and_then(Value::as_array).is_none()
        || config.get("dataAllowlist").and_then(Value::as_array).is_none()
        || config
            .get("dataFolderAllowlist")
            .and_then(Value::as_array)
            .is_none()
    {
        return Err("Invalid MCP configuration".to_string());
    }
    Ok(())
}

fn load_requests(app: &AppHandle) -> Result<Vec<Value>, String> {
    let value = read_json(app, REQUESTS_PATH, json!([]))?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| "Invalid MCP request index".to_string())
}

fn save_requests(app: &AppHandle, mut requests: Vec<Value>) -> Result<(), String> {
    requests.sort_by_key(|request| {
        std::cmp::Reverse(request.get("requestedAt").and_then(Value::as_u64).unwrap_or(0))
    });
    requests.truncate(MAX_REQUESTS);
    write_json(app, REQUESTS_PATH, &Value::Array(requests), false)
}

fn audit_record(
    action: &str,
    outcome: &str,
    client: Option<&Value>,
    workspace_id: Option<&str>,
    pipeline_id: Option<&str>,
    run_id: Option<&str>,
    detail: Option<&str>,
) -> Value {
    let mut record = Map::from_iter([
        ("schemaVersion".to_string(), json!(SCHEMA_VERSION)),
        ("id".to_string(), json!(Uuid::new_v4().to_string())),
        ("timestamp".to_string(), json!(now_ms())),
        ("action".to_string(), json!(action)),
        ("outcome".to_string(), json!(outcome)),
    ]);
    if let Some(value) = client {
        record.insert("client".to_string(), value.clone());
    }
    if let Some(value) = workspace_id {
        record.insert("workspaceId".to_string(), json!(value));
    }
    if let Some(value) = pipeline_id {
        record.insert("pipelineId".to_string(), json!(value));
    }
    if let Some(value) = run_id {
        record.insert("runId".to_string(), json!(value));
    }
    if let Some(value) = detail {
        record.insert("detail".to_string(), json!(value));
    }
    Value::Object(record)
}

fn append_audit(app: &AppHandle, record: Value) -> Result<(), String> {
    let mut records = read_json(app, AUDIT_PATH, json!([]))?
        .as_array()
        .cloned()
        .ok_or_else(|| "Invalid MCP audit index".to_string())?;
    records.insert(0, record);
    records.truncate(MAX_AUDIT_RECORDS);
    write_json(app, AUDIT_PATH, &Value::Array(records), false)
}

fn active_workspace(app: &AppHandle) -> Result<Value, String> {
    let active = read_json(app, "active-workspace.json", json!({ "id": null }))?;
    let id = active
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "No active workspace".to_string())?;
    let workspaces = read_json(app, "workspaces.json", json!({ "workspaces": [] }))?;
    let workspace = workspaces
        .get("workspaces")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        })
        .ok_or_else(|| "The active workspace is missing from the workspace index".to_string())?;
    Ok(json!({
        "id": id,
        "name": workspace.get("name").and_then(Value::as_str).unwrap_or("Workspace"),
    }))
}

fn saved_pipelines(app: &AppHandle, workspace_id: &str) -> Result<Vec<Value>, String> {
    let rel = format!("workspaces/{workspace_id}/pipeline-workspace.json");
    let state = read_json(
        app,
        &rel,
        json!({ "current": { "nodes": [], "edges": [], "name": "Untitled Pipeline", "id": null }, "saved": [] }),
    )?;
    state
        .get("saved")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "Invalid saved pipeline index".to_string())
}

fn saved_pipeline(app: &AppHandle, workspace_id: &str, pipeline_id: &str) -> Result<Value, String> {
    saved_pipelines(app, workspace_id)?
        .into_iter()
        .find(|pipeline| pipeline.get("id").and_then(Value::as_str) == Some(pipeline_id))
        .ok_or_else(|| format!("Saved pipeline not found: {pipeline_id}"))
}

fn pipeline_revision(pipeline: &Value) -> Result<String, String> {
    pipeline
        .get("updatedAt")
        .and_then(Value::as_u64)
        .map(|value| value.to_string())
        .ok_or_else(|| "Saved pipeline has no valid revision".to_string())
}

fn grant_matches(grant: &Value, workspace_id: &str, pipeline_id: &str, revision: &str) -> bool {
    grant.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
        && grant.get("pipelineId").and_then(Value::as_str) == Some(pipeline_id)
        && grant.get("pipelineRevision").and_then(Value::as_str) == Some(revision)
}

fn valid_grants(app: &AppHandle, config: &Value, workspace_id: &str) -> Result<Vec<Value>, String> {
    let pipelines = saved_pipelines(app, workspace_id)?;
    let grants = config
        .get("allowlist")
        .and_then(Value::as_array)
        .ok_or_else(|| "Invalid MCP allowlist".to_string())?;
    Ok(grants
        .iter()
        .filter(|grant| grant.get("workspaceId").and_then(Value::as_str) == Some(workspace_id))
        .filter(|grant| {
            if grant
                .get("inputs")
                .and_then(Value::as_array)
                .is_none_or(|inputs| validate_input_descriptors(inputs).is_err())
            {
                return false;
            }
            let Some(id) = grant.get("pipelineId").and_then(Value::as_str) else {
                return false;
            };
            pipelines.iter().any(|pipeline| {
                pipeline.get("id").and_then(Value::as_str) == Some(id)
                    && pipeline_revision(pipeline).ok().as_deref()
                        == grant.get("pipelineRevision").and_then(Value::as_str)
            })
        })
        .cloned()
        .collect())
}

fn data_files(app: &AppHandle, workspace_id: &str) -> Result<Vec<Value>, String> {
    let rel = format!("workspaces/{workspace_id}/data-files.json");
    let value = read_json(app, &rel, json!({ "files": [] }))?;
    if let Some(files) = value.as_array() {
        return Ok(files.clone());
    }
    value
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "Invalid workspace Data index".to_string())
}

fn data_file(app: &AppHandle, workspace_id: &str, artifact_id: &str) -> Result<Value, String> {
    data_files(app, workspace_id)?
        .into_iter()
        .find(|file| file.get("id").and_then(Value::as_str) == Some(artifact_id))
        .ok_or_else(|| format!("Workspace artifact not found: {artifact_id}"))
}

/// The reserved Data folder holding Results. Mirrors `LIATIR_MCP_RESULTS_FOLDER`.
const RESULTS_FOLDER: &str = "Results";

fn normalize_folder(folder: &str) -> &str {
    folder.trim().trim_matches('/')
}

/// A source folder is any Data folder outside the reserved Results tree.
///
/// Results readability is the separate workspace Result grant, so a Data folder grant must never
/// reach into it. This is enforced here rather than only in the Settings list, because the list is
/// a view and this is authority.
fn is_source_folder(folder: &str) -> bool {
    let normalized = normalize_folder(folder);
    normalized != RESULTS_FOLDER && !normalized.starts_with(&format!("{RESULTS_FOLDER}/"))
}

/// Whether a folder may carry a standing grant. Mirrors `liatirMcpGrantableFolder`.
///
/// The Data root is excluded: a grant covers nested folders, so granting the root would mean every
/// present and future file in the workspace — the unbounded default-allow this grant exists to
/// avoid.
fn is_grantable_folder(folder: &str) -> bool {
    let normalized = normalize_folder(folder);
    !normalized.is_empty() && is_source_folder(normalized)
}

/// A folder grant covers the folder itself and everything nested under it.
/// Mirrors `liatirMcpDataFolderCovers`.
fn data_folder_covers(grant_folder: &str, file_folder: &str) -> bool {
    if !is_grantable_folder(grant_folder) || !is_source_folder(file_folder) {
        return false;
    }
    let granted = normalize_folder(grant_folder);
    let file = normalize_folder(file_folder);
    file == granted || file.starts_with(&format!("{granted}/"))
}

/// Whether a standing folder grant of the workspace covers this registered file.
fn folder_grant_allows(config: &Value, workspace_id: &str, file: &Value) -> bool {
    let file_folder = file.get("folder").and_then(Value::as_str).unwrap_or_default();
    config
        .get("dataFolderAllowlist")
        .and_then(Value::as_array)
        .is_some_and(|grants| {
            grants.iter().any(|grant| {
                grant.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
                    && grant
                        .get("folder")
                        .and_then(Value::as_str)
                        .is_some_and(|granted| data_folder_covers(granted, file_folder))
            })
        })
}

fn analysis_results(app: &AppHandle, workspace_id: &str) -> Result<Vec<Value>, String> {
    let rel = format!("workspaces/{workspace_id}/analysis-runs/index.json");
    read_json(app, &rel, json!([]))?
        .as_array()
        .cloned()
        .ok_or_else(|| "Invalid Result index".to_string())
}

fn results_read_allowed(config: &Value, workspace_id: &str) -> bool {
    config
        .get("resultWorkspaces")
        .and_then(Value::as_array)
        .is_some_and(|workspaces| {
            workspaces.iter().any(|entry| {
                entry.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
            })
        })
}

fn result_output_paths(result: &Value) -> impl Iterator<Item = &str> {
    result
        .get("outputFiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|file| file.get("path").and_then(Value::as_str))
}

fn mcp_result_ids<'a>(requests: &'a [Value], workspace_id: &str) -> Vec<&'a str> {
    requests
        .iter()
        .filter(|request| {
            request.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
        })
        .filter_map(|request| {
            request
                .get("resultId")
                .and_then(Value::as_str)
                .or_else(|| request.get("runId").and_then(Value::as_str))
        })
        .collect()
}

fn artifact_access(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    file: &Value,
) -> Result<Option<(&'static str, Vec<String>)>, String> {
    let Some(artifact_id) = file.get("id").and_then(Value::as_str) else {
        return Ok(None);
    };
    let path = file.get("path").and_then(Value::as_str);
    let results = analysis_results(app, workspace_id)?;
    let linked_results = path.map_or_else(Vec::new, |path| {
        results
            .iter()
            .filter(|result| result_output_paths(result).any(|candidate| candidate == path))
            .filter_map(|result| result.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>()
    });
    let owned_result_ids = mcp_result_ids(requests, workspace_id);
    if linked_results
        .iter()
        .any(|result_id| owned_result_ids.contains(&result_id.as_str()))
    {
        return Ok(Some(("mcp-result", linked_results)));
    }
    if results_read_allowed(config, workspace_id) && !linked_results.is_empty() {
        return Ok(Some(("workspace-results", linked_results)));
    }
    let file_allowed = config
        .get("dataAllowlist")
        .and_then(Value::as_array)
        .is_some_and(|grants| {
            grants.iter().any(|grant| {
                grant.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
                    && grant.get("artifactId").and_then(Value::as_str) == Some(artifact_id)
            })
        });
    // A folder grant and a per-file grant carry the same authority, so both report `data-grant`:
    // how the user granted access is Liatir's business, not the client's.
    let explicitly_allowed = file_allowed || folder_grant_allows(config, workspace_id, file);
    Ok(explicitly_allowed.then_some(("data-grant", linked_results)))
}

fn artifact_media_type(file: &Value) -> String {
    if let Some(media_type) = file
        .get("scientific")
        .and_then(|scientific| scientific.get("physical"))
        .and_then(|physical| physical.get("mediaType"))
        .and_then(Value::as_str)
    {
        return media_type.to_string();
    }
    match file.get("ext").and_then(Value::as_str).unwrap_or_default() {
        "json" => "application/json",
        "csv" => "text/csv",
        "tsv" | "txt" | "fasta" | "fa" | "fna" | "fastq" | "fq" | "vcf" | "bed" => {
            "text/plain"
        }
        "html" | "htm" => "text/html",
        "md" => "text/markdown",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn artifact_descriptor(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    file: &Value,
) -> Result<Option<Value>, String> {
    let Some((access, result_ids)) = artifact_access(app, config, requests, workspace_id, file)? else {
        return Ok(None);
    };
    let Some(artifact_id) = file.get("id").and_then(Value::as_str) else {
        return Ok(None);
    };
    let scientific_artifact_id = file
        .get("scientific")
        .and_then(|scientific| scientific.get("physical"))
        .and_then(|physical| physical.get("artifactId"))
        .and_then(Value::as_str);
    Ok(Some(json!({
        "schemaVersion": SCHEMA_VERSION,
        "artifactId": artifact_id,
        "name": file.get("name").and_then(Value::as_str).unwrap_or("Artifact"),
        "extension": file.get("ext").and_then(Value::as_str).unwrap_or_default(),
        "size": file.get("size").and_then(Value::as_u64),
        "folder": file.get("folder").and_then(Value::as_str).unwrap_or_default(),
        "mediaType": artifact_media_type(file),
        "scientificArtifactId": scientific_artifact_id,
        "scientific": file.get("scientific").cloned(),
        "access": access,
        "resultIds": result_ids,
        "metadataUri": format!("{ARTIFACT_PREFIX}{artifact_id}"),
        "contentTemplate": format!("{ARTIFACT_PREFIX}{artifact_id}/content/{{offset}}/{{length}}"),
    })))
}

fn readable_artifacts(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
) -> Result<Vec<Value>, String> {
    data_files(app, workspace_id)?
        .iter()
        .filter_map(|file| artifact_descriptor(app, config, requests, workspace_id, file).transpose())
        .collect()
}

fn execution_records(app: &AppHandle, workspace_id: &str) -> Result<Vec<Value>, String> {
    let rel = format!("workspaces/{workspace_id}/execution-runs/index.json");
    read_json(app, &rel, json!([]))?
        .as_array()
        .cloned()
        .ok_or_else(|| "Invalid execution run index".to_string())
}

fn job_root_run_id(job: &Value, executions: &[Value]) -> Option<String> {
    if let Some(root_run_id) = job
        .get("metadata")
        .and_then(|metadata| metadata.get("execution"))
        .and_then(|execution| execution.get("rootRunId"))
        .and_then(Value::as_str)
    {
        return Some(root_run_id.to_string());
    }
    let job_id = job.get("id").and_then(Value::as_str)?;
    executions.iter().find_map(|execution| {
        execution
            .get("jobIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(job_id)))
            .then(|| {
                execution
                    .get("identity")
                    .and_then(|identity| identity.get("rootRunId"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .flatten()
    })
}

fn mcp_job(
    app: &AppHandle,
    requests: &[Value],
    executions: &[Value],
    workspace_id: &str,
    job_id: &str,
) -> Result<(Value, Value), String> {
    let job = serde_json::to_value(super::jobs::lia_jobs_status(
        app.clone(),
        job_id.to_string(),
    )?)
    .map_err(|error| error.to_string())?;
    if job.get("workspaceId").and_then(Value::as_str) != Some(workspace_id) {
        return Err("This Job is not in the active workspace".to_string());
    }
    let root_run_id = job_root_run_id(&job, executions)
        .ok_or_else(|| "This Job has no MCP-owned execution identity".to_string())?;
    let request = requests
        .iter()
        .find(|request| request.get("runId").and_then(Value::as_str) == Some(&root_run_id))
        .cloned()
        .ok_or_else(|| "This Job did not originate through Liatir MCP".to_string())?;
    Ok((job, request))
}

fn public_job(job: &Value, request: &Value, output: Option<Value>) -> Value {
    json!({
        "id": job.get("id"),
        "runId": request.get("runId"),
        "pipelineId": request.get("pipelineId"),
        "label": job.get("label"),
        "kind": job.get("kind"),
        "status": job.get("status"),
        "startedAtMs": job.get("startedAtMs"),
        "endedAtMs": job.get("endedAtMs"),
        "progress": job.get("progress"),
        "resourceUri": format!("{JOB_PREFIX}{}", job.get("id").and_then(Value::as_str).unwrap_or_default()),
        "output": output,
    })
}

fn public_execution(execution: &Value, replacements: &[(String, String)]) -> Value {
    json!({
        "identity": execution.get("identity"),
        "label": execution.get("label"),
        "status": execution.get("status"),
        "resultPolicy": execution.get("resultPolicy"),
        "resultId": execution.get("resultId"),
        "jobIds": execution.get("jobIds").cloned().unwrap_or_else(|| json!([])),
        "logs": execution.get("logs")
            .and_then(|logs| sanitize_value(logs, replacements))
            .unwrap_or_else(|| json!([])),
        "progress": execution.get("progress"),
        "startedAt": execution.get("startedAt"),
        "updatedAt": execution.get("updatedAt"),
        "endedAt": execution.get("endedAt"),
        "error": execution.get("error")
            .and_then(|error| sanitize_value(error, replacements))
            .unwrap_or(Value::Null),
        "finalizedAt": execution.get("finalizedAt"),
    })
}

fn path_replacements(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut replacements = Vec::new();
    for file in data_files(app, workspace_id)? {
        let Some(path) = file.get("path").and_then(Value::as_str) else {
            continue;
        };
        let replacement = artifact_descriptor(app, config, requests, workspace_id, &file)?
            .and_then(|descriptor| descriptor.get("metadataUri").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| "[workspace-file]".to_string());
        replacements.push((path.to_string(), replacement));
    }
    if let Ok(root) = resolve_app_path(app, "") {
        replacements.push((root.to_string_lossy().to_string(), "[LIATIR_APP_DATA]".to_string()));
    }
    replacements.sort_by_key(|(path, _)| std::cmp::Reverse(path.len()));
    Ok(replacements)
}

fn sanitize_text(text: &str, replacements: &[(String, String)]) -> String {
    replacements.iter().fold(text.to_string(), |value, (path, replacement)| {
        if path.is_empty() {
            value
        } else {
            value.replace(path, replacement)
        }
    })
}

fn looks_like_absolute_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("\\\\")
        || value.as_bytes().get(1) == Some(&b':')
}

fn sanitize_value(value: &Value, replacements: &[(String, String)]) -> Option<Value> {
    match value {
        Value::String(text) => {
            let sanitized = sanitize_text(text, replacements);
            if sanitized == *text && looks_like_absolute_path(text.trim_start()) {
                Some(Value::String("[absolute path redacted]".to_string()))
            } else {
                Some(Value::String(sanitized))
            }
        }
        Value::Array(items) => Some(Value::Array(
            items
                .iter()
                .filter_map(|item| sanitize_value(item, replacements))
                .collect(),
        )),
        Value::Object(object) => {
            if object.get("raw").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let mut sanitized = Map::new();
            for (key, item) in object {
                if let Value::String(text) = item {
                    let normalized_key = key.to_ascii_lowercase();
                    if normalized_key.ends_with("path") {
                        let replacement = sanitize_text(text, replacements);
                        if replacement == *text && looks_like_absolute_path(text) {
                            continue;
                        }
                        sanitized.insert(key.clone(), Value::String(replacement));
                        continue;
                    }
                }
                if let Some(item) = sanitize_value(item, replacements) {
                    sanitized.insert(key.clone(), item);
                }
            }
            Some(Value::Object(sanitized))
        }
        other => Some(other.clone()),
    }
}

fn result_artifacts(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    result: &Value,
) -> Result<Vec<Value>, String> {
    let files = data_files(app, workspace_id)?;
    result_output_paths(result)
        .filter_map(|path| files.iter().find(|file| file.get("path").and_then(Value::as_str) == Some(path)))
        .filter_map(|file| artifact_descriptor(app, config, requests, workspace_id, file).transpose())
        .collect()
}

fn public_result_summary(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    result: &Value,
) -> Result<Value, String> {
    let result_id = result
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Result has no identity".to_string())?;
    Ok(json!({
        "id": result_id,
        "tool": result.get("tool"),
        "label": result.get("label"),
        "status": result.get("status"),
        "startedAt": result.get("startedAt"),
        "endedAt": result.get("endedAt"),
        "durationMs": result.get("durationMs"),
        "error": result.get("error"),
        "execution": result.get("execution"),
        "jobIds": result.get("jobIds").cloned().unwrap_or_else(|| json!([])),
        "artifacts": result_artifacts(app, config, requests, workspace_id, result)?,
        "resourceUri": format!("{RESULT_PREFIX}{result_id}"),
    }))
}

fn public_result(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    result: &Value,
) -> Result<Value, String> {
    let result_id = result
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Result has no identity".to_string())?;
    let output_rel = format!("workspaces/{workspace_id}/runs/{result_id}/result.json");
    let output = read_run_json(app, &output_rel, Value::Null)?;
    let replacements = path_replacements(app, config, requests, workspace_id)?;
    Ok(json!({
        "result": public_result_summary(app, config, requests, workspace_id, result)?,
        "output": sanitize_value(&output, &replacements).unwrap_or(Value::Null),
    }))
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().next().is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn parse_single_resource_uri<'a>(uri: &'a str, prefix: &str) -> Option<&'a str> {
    let id = uri.strip_prefix(prefix)?;
    (valid_resource_id(id) && !id.contains('/')).then_some(id)
}

fn parse_artifact_content_uri(uri: &str) -> Option<(&str, u64, usize)> {
    let rest = uri.strip_prefix(ARTIFACT_PREFIX)?;
    let mut parts = rest.split('/');
    let artifact_id = parts.next()?;
    if !valid_resource_id(artifact_id) || parts.next()? != "content" {
        return None;
    }
    let offset = parts.next()?.parse::<u64>().ok()?;
    let length = parts.next()?.parse::<usize>().ok()?;
    if parts.next().is_some() || length == 0 || length > MAX_ARTIFACT_CHUNK_BYTES {
        return None;
    }
    Some((artifact_id, offset, length))
}

fn text_media_type(media_type: &str) -> bool {
    media_type.starts_with("text/")
        || matches!(
            media_type,
            "application/json" | "application/xml" | "application/javascript" | "image/svg+xml"
        )
}

fn artifact_content(
    app: &AppHandle,
    uri: &str,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
) -> Result<ResourceContents, String> {
    let (artifact_id, offset, length) = parse_artifact_content_uri(uri)
        .ok_or_else(|| "Invalid artifact content resource URI".to_string())?;
    let file = data_file(app, workspace_id, artifact_id)?;
    if artifact_access(app, config, requests, workspace_id, &file)?.is_none() {
        return Err("This artifact is not allowed for MCP".to_string());
    }
    let path = file
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "This artifact has no readable file".to_string())?;
    let link_metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err("MCP artifacts must be regular, non-symlink files".to_string());
    }
    let mut reader = fs::File::open(path).map_err(|error| error.to_string())?;
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0_u8; length];
    let read = reader.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(read);
    let media_type = artifact_media_type(&file);
    if text_media_type(&media_type) {
        if let Ok(text) = String::from_utf8(bytes.clone()) {
            return Ok(ResourceContents::text(text, uri).with_mime_type(media_type));
        }
    }
    Ok(ResourceContents::blob(BASE64.encode(bytes), uri).with_mime_type(media_type))
}

fn is_terminal_status(status: &str) -> bool {
    matches!(
        status,
        "denied" | "done" | "error" | "cancelled" | "interrupted"
    )
}

fn request_client(request: &Value) -> Option<&Value> {
    request.get("client")
}

fn status_value(app: &AppHandle, config: &Value, requests: &[Value]) -> Value {
    let enabled = config.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    let endpoint = enabled
        .then(|| app.state::<McpRuntimeState>().endpoint())
        .flatten();
    let workspace_id = active_workspace(app)
        .ok()
        .and_then(|workspace| workspace.get("id").and_then(Value::as_str).map(str::to_string));
    let read_results = workspace_id.as_deref().is_some_and(|id| {
        config
            .get("resultWorkspaces")
            .and_then(Value::as_array)
            .is_some_and(|workspaces| workspaces.iter().any(|entry| {
                entry.get("workspaceId").and_then(Value::as_str) == Some(id)
            }))
    });
    let workspace_grants = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_array)
            .map(|grants| {
                grants
                    .iter()
                    .filter(|grant| {
                        grant.get("workspaceId").and_then(Value::as_str) == workspace_id.as_deref()
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let data_allowlist = workspace_grants("dataAllowlist");
    let data_folder_allowlist = workspace_grants("dataFolderAllowlist");
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "enabled": enabled,
        "endpoint": endpoint,
        "bearerToken": config.get("bearerToken").and_then(Value::as_str).unwrap_or_default(),
        "allowlist": config.get("allowlist").cloned().unwrap_or_else(|| json!([])),
        "readResults": read_results,
        "dataAllowlist": data_allowlist,
        "dataFolderAllowlist": data_folder_allowlist,
        "pendingCount": requests.iter().filter(|request| {
            request.get("status").and_then(Value::as_str) == Some("awaiting-authorization")
        }).count(),
    })
}

fn emit_state_changed(app: &AppHandle) {
    let _ = app.emit_to("main", EVENT_STATE_CHANGED, ());
}

fn is_main_window_label(label: &str) -> bool {
    label == "main"
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if !is_main_window_label(window.label()) {
        return Err("Local MCP can only be managed from Liatir's main window".to_string());
    }
    Ok(())
}

fn non_empty_string(value: &Value, key: &str) -> Result<(), String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty() && text.len() <= 512)
        .map(|_| ())
        .ok_or_else(|| format!("Invalid MCP pipeline input descriptor field: {key}"))
}

fn validate_input_descriptors(inputs: &[Value]) -> Result<(), String> {
    if inputs.len() > 256 {
        return Err("An MCP pipeline cannot expose more than 256 inputs".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    for input in inputs {
        for key in ["id", "nodeId", "nodeLabel", "fieldKey", "label"] {
            non_empty_string(input, key)?;
        }
        let id = input.get("id").and_then(Value::as_str).unwrap_or_default();
        if !ids.insert(id) {
            return Err(format!("Duplicate MCP pipeline input: {id}"));
        }
        if !matches!(
            input.get("type").and_then(Value::as_str),
            Some("string" | "number" | "boolean" | "file")
        ) || input.get("required").and_then(Value::as_bool).is_none()
            || !matches!(
                input.get("source").and_then(Value::as_str),
                Some("node-input" | "variable" | "api-parameter")
            )
        {
            return Err(format!("Invalid MCP pipeline input descriptor: {id}"));
        }
    }
    Ok(())
}

fn validate_pipeline_inputs(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    workspace_id: &str,
    descriptors: &[Value],
    supplied: &Map<String, Value>,
) -> Result<(), String> {
    if supplied.len() > descriptors.len() || supplied.len() > 256 {
        return Err("Too many MCP pipeline inputs".to_string());
    }
    let encoded = serde_json::to_vec(supplied).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_MCP_REQUEST_BYTES / 2 {
        return Err("MCP pipeline inputs are too large".to_string());
    }

    for (id, value) in supplied {
        let descriptor = descriptors
            .iter()
            .find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| format!("Unknown pipeline input: {id}"))?;
        let input_type = descriptor.get("type").and_then(Value::as_str).unwrap_or_default();
        match input_type {
            "string" => {
                let text = value
                    .as_str()
                    .ok_or_else(|| format!("Pipeline input {id} must be a string"))?;
                if text.len() > 64 * 1024 {
                    return Err(format!("Pipeline input {id} is too large"));
                }
                if text.starts_with("@pipe:") {
                    return Err(format!(
                        "Pipeline input {id} cannot create a new pipeline connection"
                    ));
                }
            }
            "number" if !value.is_number() => {
                return Err(format!("Pipeline input {id} must be a number"));
            }
            "boolean" if !value.is_boolean() => {
                return Err(format!("Pipeline input {id} must be true or false"));
            }
            "file" => {
                let artifact = value
                    .as_object()
                    .filter(|object| object.len() == 1)
                    .and_then(|object| object.get("artifactId"))
                    .and_then(Value::as_str)
                    .filter(|artifact_id| !artifact_id.trim().is_empty())
                    .ok_or_else(|| {
                        format!("Pipeline input {id} must contain one allowed artifactId")
                    })?;
                let file = data_file(app, workspace_id, artifact)?;
                if artifact_access(app, config, requests, workspace_id, &file)?.is_none() {
                    return Err(format!("Artifact {artifact} is not allowed for MCP"));
                }
                if let Some(accepted) = descriptor.get("accept").and_then(Value::as_array) {
                    let extension = file
                        .get("ext")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim_start_matches('.')
                        .to_ascii_lowercase();
                    if !accepted.iter().any(|value| {
                        value
                            .as_str()
                            .is_some_and(|value| value.trim_start_matches('.').eq_ignore_ascii_case(&extension))
                    }) {
                        return Err(format!("Artifact {artifact} is not an accepted file type for {id}"));
                    }
                }
            }
            "number" | "boolean" => {}
            _ => return Err(format!("Invalid pipeline input type for {id}")),
        }
        if let Some(options) = descriptor.get("options").and_then(Value::as_array) {
            let Some(text) = value.as_str() else {
                return Err(format!("Pipeline input {id} must use a listed value"));
            };
            if !options
                .iter()
                .any(|option| option.get("value").and_then(Value::as_str) == Some(text))
            {
                return Err(format!("Pipeline input {id} must use a listed value"));
            }
        }
    }
    Ok(())
}

fn validate_request_inputs(
    app: &AppHandle,
    config: &Value,
    requests: &[Value],
    request: &Value,
) -> Result<(), String> {
    let workspace_id = request
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or_else(|| "MCP request has no workspace identity".to_string())?;
    let descriptors = request
        .get("inputSchema")
        .and_then(Value::as_array)
        .ok_or_else(|| "MCP request has no input schema".to_string())?;
    let inputs = request
        .get("inputs")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP request has no pipeline inputs".to_string())?;
    validate_pipeline_inputs(app, config, requests, workspace_id, descriptors, inputs)
}

fn deny_waiting_requests(
    app: &AppHandle,
    requests: &mut [Value],
    predicate: impl Fn(&Value) -> bool,
    detail: &str,
) -> Result<(), String> {
    for request in requests.iter_mut().filter(|request| {
        request.get("status").and_then(Value::as_str) == Some("awaiting-authorization")
            && predicate(request)
    }) {
        let timestamp = now_ms();
        request["status"] = json!("denied");
        request["deniedAt"] = json!(timestamp);
        request["endedAt"] = json!(timestamp);
        request["error"] = json!(detail);
        append_audit(
            app,
            audit_record(
                "run-denied",
                "denied",
                request_client(request),
                request.get("workspaceId").and_then(Value::as_str),
                request.get("pipelineId").and_then(Value::as_str),
                request.get("runId").and_then(Value::as_str),
                Some(detail),
            ),
        )?;
    }
    Ok(())
}

fn deny_waiting_requests_with_invalid_inputs(
    app: &AppHandle,
    config: &Value,
    requests: &mut [Value],
    detail: &str,
) -> Result<(), String> {
    let snapshot = requests.to_vec();
    let invalid_ids = snapshot
        .iter()
        .filter(|request| {
            request.get("status").and_then(Value::as_str) == Some("awaiting-authorization")
        })
        .filter(|request| validate_request_inputs(app, config, &snapshot, request).is_err())
        .filter_map(|request| request.get("runId").and_then(Value::as_str))
        .collect::<std::collections::HashSet<_>>();
    deny_waiting_requests(
        app,
        requests,
        |request| {
            request
                .get("runId")
                .and_then(Value::as_str)
                .is_some_and(|run_id| invalid_ids.contains(run_id))
        },
        detail,
    )
}

#[tauri::command]
pub fn lia_mcp_status(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let config = load_config(&app)?;
    let requests = load_requests(&app)?;
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_set_enabled(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut config = load_config(&app)?;
    let previous = config.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    if previous != enabled {
        config["enabled"] = json!(enabled);
        config["updatedAt"] = json!(now_ms());
        write_json(&app, CONFIG_PATH, &config, true)?;
        append_audit(
            &app,
            audit_record(
                if enabled { "server-enabled" } else { "server-disabled" },
                "completed",
                None,
                None,
                None,
                None,
                None,
            ),
        )?;
    }

    let mut requests = load_requests(&app)?;
    if !enabled {
        deny_waiting_requests(
            &app,
            &mut requests,
            |_| true,
            "MCP server was disabled before authorization.",
        )?;
        save_requests(&app, requests.clone())?;
    }
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_rotate_token(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut config = load_config(&app)?;
    config["bearerToken"] = json!(new_token());
    config["updatedAt"] = json!(now_ms());
    write_json(&app, CONFIG_PATH, &config, true)?;
    append_audit(
        &app,
        audit_record("token-rotated", "completed", None, None, None, None, None),
    )?;
    let requests = load_requests(&app)?;
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_allow_pipeline(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    pipeline_id: String,
    inputs: Vec<Value>,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let workspace = active_workspace(&app)?;
    if workspace.get("id").and_then(Value::as_str) != Some(workspace_id.as_str()) {
        return Err("Only a pipeline in the active workspace can be allowed".to_string());
    }
    let pipeline = saved_pipeline(&app, &workspace_id, &pipeline_id)?;
    let revision = pipeline_revision(&pipeline)?;
    validate_input_descriptors(&inputs)?;
    let grant = json!({
        "schemaVersion": SCHEMA_VERSION,
        "workspaceId": workspace_id,
        "pipelineId": pipeline_id,
        "pipelineName": pipeline.get("name").and_then(Value::as_str).unwrap_or("Pipeline"),
        "pipelineRevision": revision,
        "inputs": inputs,
        "allowedAt": now_ms(),
    });

    let mut config = load_config(&app)?;
    let grants = config
        .get_mut("allowlist")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Invalid MCP allowlist".to_string())?;
    grants.retain(|existing| {
        existing.get("workspaceId").and_then(Value::as_str) != Some(workspace_id.as_str())
            || existing.get("pipelineId").and_then(Value::as_str) != Some(pipeline_id.as_str())
    });
    grants.push(grant.clone());
    config["updatedAt"] = json!(now_ms());
    write_json(&app, CONFIG_PATH, &config, true)?;
    append_audit(
        &app,
        audit_record(
            "pipeline-allowed",
            "completed",
            None,
            Some(&workspace_id),
            Some(&pipeline_id),
            None,
            Some(&format!("Allowed saved revision {revision}")),
        ),
    )?;
    let requests = load_requests(&app)?;
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_revoke_pipeline(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    pipeline_id: String,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut config = load_config(&app)?;
    let grants = config
        .get_mut("allowlist")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Invalid MCP allowlist".to_string())?;
    let previous_len = grants.len();
    grants.retain(|existing| {
        existing.get("workspaceId").and_then(Value::as_str) != Some(workspace_id.as_str())
            || existing.get("pipelineId").and_then(Value::as_str) != Some(pipeline_id.as_str())
    });
    if grants.len() != previous_len {
        config["updatedAt"] = json!(now_ms());
        write_json(&app, CONFIG_PATH, &config, true)?;
        append_audit(
            &app,
            audit_record(
                "pipeline-revoked",
                "completed",
                None,
                Some(&workspace_id),
                Some(&pipeline_id),
                None,
                None,
            ),
        )?;
    }

    let mut requests = load_requests(&app)?;
    deny_waiting_requests(
        &app,
        &mut requests,
        |request| {
            request.get("workspaceId").and_then(Value::as_str) == Some(workspace_id.as_str())
                && request.get("pipelineId").and_then(Value::as_str)
                    == Some(pipeline_id.as_str())
        },
        "Pipeline authorization was revoked before this run was approved.",
    )?;
    save_requests(&app, requests.clone())?;
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_set_read_results(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let workspace = active_workspace(&app)?;
    let workspace_id = workspace
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Active workspace has no identity".to_string())?;
    let mut config = load_config(&app)?;
    let workspaces = config
        .get_mut("resultWorkspaces")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Invalid MCP Result permission index".to_string())?;
    let previously_enabled = workspaces.iter().any(|entry| {
        entry.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
    });
    if previously_enabled != enabled {
        workspaces.retain(|entry| {
            entry.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
        });
        if enabled {
            workspaces.push(json!({
                "schemaVersion": SCHEMA_VERSION,
                "workspaceId": workspace_id,
                "allowedAt": now_ms(),
            }));
        }
        config["updatedAt"] = json!(now_ms());
        write_json(&app, CONFIG_PATH, &config, true)?;
        append_audit(
            &app,
            audit_record(
                if enabled { "results-read-enabled" } else { "results-read-disabled" },
                "completed",
                None,
                Some(workspace_id),
                None,
                None,
                None,
            ),
        )?;
    }
    let mut requests = load_requests(&app)?;
    if !enabled {
        deny_waiting_requests_with_invalid_inputs(
            &app,
            &config,
            &mut requests,
            "Result access was revoked before this run was approved.",
        )?;
        save_requests(&app, requests.clone())?;
    }
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

/// How many artifact identities a bulk audit record spells out before it reports only a count.
const BULK_AUDIT_DETAIL_IDS: usize = 10;

/// The audit detail for one file permission change.
///
/// A bulk action is one ledger entry, not one per file: the audit index is capped at
/// `MAX_AUDIT_RECORDS`, and a single click that allows hundreds of files must not erase the
/// history it belongs to. Identities stay spelled out while the list is short enough to read.
fn bulk_detail(artifact_ids: &[String]) -> String {
    match artifact_ids.len() {
        1 => artifact_ids[0].clone(),
        count if count <= BULK_AUDIT_DETAIL_IDS => {
            format!("{count} files: {}", artifact_ids.join(", "))
        }
        count => format!("{count} files"),
    }
}

/// Allow or revoke a set of registered files in one atomic configuration write.
///
/// Bulk is a single operation rather than a loop over the single-file one because a partially
/// applied "allow everything shown" leaves a permission state nobody chose. Callers must already
/// hold the MCP storage lock.
fn set_data_files_allowed(
    app: &AppHandle,
    workspace_id: &str,
    artifact_ids: &[String],
    allowed: bool,
) -> Result<Value, String> {
    let mut config = load_config(app)?;
    let mut additions: Vec<Value> = Vec::new();
    let mut changed: Vec<String> = Vec::new();

    if allowed {
        let workspace = active_workspace(app)?;
        if workspace.get("id").and_then(Value::as_str) != Some(workspace_id) {
            return Err("Only a file in the active workspace can be allowed".to_string());
        }
        // Read the Data index once: the caller may be allowing every file in the workspace.
        let files = data_files(app, workspace_id)?;
        for artifact_id in artifact_ids {
            if changed.contains(artifact_id) {
                continue;
            }
            let file = files
                .iter()
                .find(|file| file.get("id").and_then(Value::as_str) == Some(artifact_id.as_str()))
                .ok_or_else(|| format!("Workspace artifact not found: {artifact_id}"))?;
            if file.get("missing").and_then(Value::as_bool) == Some(true)
                || file.get("path").and_then(Value::as_str).is_none()
            {
                return Err("This workspace artifact is unavailable".to_string());
            }
            changed.push(artifact_id.clone());
            additions.push(json!({
                "schemaVersion": SCHEMA_VERSION,
                "workspaceId": workspace_id,
                "artifactId": artifact_id,
                "name": file.get("name").and_then(Value::as_str).unwrap_or("Artifact"),
                "allowedAt": now_ms(),
            }));
        }
    }

    let grants = config
        .get_mut("dataAllowlist")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Invalid MCP Data allowlist".to_string())?;
    if !allowed {
        for artifact_id in artifact_ids {
            let previous_len = grants.len();
            grants.retain(|grant| {
                grant.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
                    || grant.get("artifactId").and_then(Value::as_str) != Some(artifact_id.as_str())
            });
            if grants.len() != previous_len {
                changed.push(artifact_id.clone());
            }
        }
    } else {
        // Re-allowing a file refreshes its grant rather than duplicating it.
        grants.retain(|grant| {
            grant.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
                || !grant
                    .get("artifactId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| changed.iter().any(|allowed_id| allowed_id == id))
        });
        grants.append(&mut additions);
    }

    if !changed.is_empty() {
        config["updatedAt"] = json!(now_ms());
        write_json(app, CONFIG_PATH, &config, true)?;
        append_audit(
            app,
            audit_record(
                if allowed { "data-file-allowed" } else { "data-file-revoked" },
                "completed",
                None,
                Some(workspace_id),
                None,
                None,
                Some(&bulk_detail(&changed)),
            ),
        )?;
    }

    let mut requests = load_requests(app)?;
    if !allowed {
        deny_waiting_requests_with_invalid_inputs(
            app,
            &config,
            &mut requests,
            "A requested Data artifact was revoked before this run was approved.",
        )?;
        save_requests(app, requests.clone())?;
    }
    emit_state_changed(app);
    Ok(status_value(app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_allow_data_file(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    artifact_id: String,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    set_data_files_allowed(&app, &workspace_id, std::slice::from_ref(&artifact_id), true)
}

#[tauri::command]
pub fn lia_mcp_revoke_data_file(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    artifact_id: String,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    set_data_files_allowed(&app, &workspace_id, std::slice::from_ref(&artifact_id), false)
}

/// Allow or revoke a list of registered files in one write, one audit record and one outcome.
#[tauri::command]
pub fn lia_mcp_set_data_files_allowed(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    artifact_ids: Vec<String>,
    allowed: bool,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    set_data_files_allowed(&app, &workspace_id, &artifact_ids, allowed)
}

/// Grant or withdraw standing access to one named Data folder, including files added to it later.
#[tauri::command]
pub fn lia_mcp_set_data_folder_allowed(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    folder: String,
    allowed: bool,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let folder = normalize_folder(&folder).to_string();
    if allowed {
        let workspace = active_workspace(&app)?;
        if workspace.get("id").and_then(Value::as_str) != Some(workspace_id.as_str()) {
            return Err("Only a folder in the active workspace can be allowed".to_string());
        }
        if !is_grantable_folder(&folder) {
            return Err(
                "Only a named Data folder outside Results can be allowed as a whole".to_string(),
            );
        }
    }
    let mut config = load_config(&app)?;
    let grants = config
        .get_mut("dataFolderAllowlist")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Invalid MCP Data folder allowlist".to_string())?;
    let previous_len = grants.len();
    grants.retain(|grant| {
        grant.get("workspaceId").and_then(Value::as_str) != Some(workspace_id.as_str())
            || grant.get("folder").and_then(Value::as_str) != Some(folder.as_str())
    });
    let removed = grants.len() != previous_len;
    if allowed {
        grants.push(json!({
            "schemaVersion": SCHEMA_VERSION,
            "workspaceId": workspace_id,
            "folder": folder,
            "allowedAt": now_ms(),
        }));
    }
    if allowed || removed {
        config["updatedAt"] = json!(now_ms());
        write_json(&app, CONFIG_PATH, &config, true)?;
        append_audit(
            &app,
            audit_record(
                if allowed { "data-folder-allowed" } else { "data-folder-revoked" },
                "completed",
                None,
                Some(&workspace_id),
                None,
                None,
                Some(&folder),
            ),
        )?;
    }
    let mut requests = load_requests(&app)?;
    if !allowed {
        deny_waiting_requests_with_invalid_inputs(
            &app,
            &config,
            &mut requests,
            "A requested Data artifact was revoked before this run was approved.",
        )?;
        save_requests(&app, requests.clone())?;
    }
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

/// Withdraw every Data file and folder grant in one workspace.
///
/// Distinct from revoking the listed files: it also clears folder grants and grants left behind by
/// files that are no longer registered, so "revoke everything" cannot leave residue the Settings
/// list never showed. The workspace Result permission is separate and deliberately untouched.
#[tauri::command]
pub fn lia_mcp_revoke_all_data_access(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut config = load_config(&app)?;
    let mut cleared: Vec<(&'static str, usize)> = Vec::new();
    for (key, action) in [
        ("dataAllowlist", "data-file-revoked"),
        ("dataFolderAllowlist", "data-folder-revoked"),
    ] {
        let grants = config
            .get_mut(key)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "Invalid MCP Data allowlist".to_string())?;
        let previous_len = grants.len();
        grants.retain(|grant| {
            grant.get("workspaceId").and_then(Value::as_str) != Some(workspace_id.as_str())
        });
        let removed = previous_len - grants.len();
        if removed > 0 {
            cleared.push((action, removed));
        }
    }
    if !cleared.is_empty() {
        config["updatedAt"] = json!(now_ms());
        write_json(&app, CONFIG_PATH, &config, true)?;
        for (action, removed) in cleared {
            let unit = if action == "data-file-revoked" { "files" } else { "folders" };
            append_audit(
                &app,
                audit_record(
                    action,
                    "completed",
                    None,
                    Some(&workspace_id),
                    None,
                    None,
                    Some(&format!("{removed} {unit}")),
                ),
            )?;
        }
    }
    let mut requests = load_requests(&app)?;
    deny_waiting_requests_with_invalid_inputs(
        &app,
        &config,
        &mut requests,
        "A requested Data artifact was revoked before this run was approved.",
    )?;
    save_requests(&app, requests.clone())?;
    emit_state_changed(&app);
    Ok(status_value(&app, &config, &requests))
}

#[tauri::command]
pub fn lia_mcp_pending_requests(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<Value>, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let workspace_id = active_workspace(&app)
        .ok()
        .and_then(|workspace| workspace.get("id").and_then(Value::as_str).map(str::to_string));
    Ok(load_requests(&app)?
        .into_iter()
        .filter(|request| {
            request.get("status").and_then(Value::as_str) == Some("awaiting-authorization")
                && request.get("workspaceId").and_then(Value::as_str) == workspace_id.as_deref()
        })
        .collect())
}

#[tauri::command]
pub fn lia_mcp_requests(app: AppHandle, window: WebviewWindow) -> Result<Vec<Value>, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let workspace_id = active_workspace(&app)
        .ok()
        .and_then(|workspace| workspace.get("id").and_then(Value::as_str).map(str::to_string));
    Ok(load_requests(&app)?
        .into_iter()
        .filter(|request| {
            request.get("workspaceId").and_then(Value::as_str) == workspace_id.as_deref()
        })
        .collect())
}

#[tauri::command]
pub fn lia_mcp_resolve_authorization(
    app: AppHandle,
    window: WebviewWindow,
    run_id: String,
    approved: bool,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let config = load_config(&app)?;
    let mut requests = load_requests(&app)?;
    let index = requests
        .iter()
        .position(|request| request.get("runId").and_then(Value::as_str) == Some(run_id.as_str()))
        .ok_or_else(|| format!("MCP run request not found: {run_id}"))?;
    if requests[index].get("status").and_then(Value::as_str)
        != Some("awaiting-authorization")
    {
        return Err("This MCP run request is no longer awaiting authorization".to_string());
    }

    let timestamp = now_ms();
    if approved {
        if config.get("enabled").and_then(Value::as_bool) != Some(true) {
            return Err("The MCP server is disabled".to_string());
        }
        let workspace = active_workspace(&app)?;
        let workspace_id = requests[index]
            .get("workspaceId")
            .and_then(Value::as_str)
            .ok_or_else(|| "MCP request has no workspace identity".to_string())?
            .to_string();
        if workspace.get("id").and_then(Value::as_str) != Some(workspace_id.as_str()) {
            return Err("The requested pipeline is not in the active workspace".to_string());
        }
        let pipeline_id = requests[index]
            .get("pipelineId")
            .and_then(Value::as_str)
            .ok_or_else(|| "MCP request has no pipeline identity".to_string())?
            .to_string();
        let pipeline = saved_pipeline(&app, &workspace_id, &pipeline_id)?;
        let revision = pipeline_revision(&pipeline)?;
        if requests[index]
            .get("pipelineRevision")
            .and_then(Value::as_str)
            != Some(revision.as_str())
        {
            return Err("The saved pipeline changed after the MCP request was created".to_string());
        }
        let current_grant = config
            .get("allowlist")
            .and_then(Value::as_array)
            .and_then(|grants| {
                grants
                    .iter()
                    .find(|grant| grant_matches(grant, &workspace_id, &pipeline_id, &revision))
            })
            .ok_or_else(|| "This saved pipeline revision is not allowed for MCP".to_string())?;
        if current_grant.get("inputs") != requests[index].get("inputSchema") {
            return Err("The pipeline input contract changed after this MCP request was created".to_string());
        }
        validate_request_inputs(&app, &config, &requests, &requests[index])?;

        requests[index]["status"] = json!("queued");
        requests[index]["authorizedAt"] = json!(timestamp);
        append_audit(
            &app,
            audit_record(
                "run-authorized",
                "allowed",
                request_client(&requests[index]),
                Some(&workspace_id),
                Some(&pipeline_id),
                Some(&run_id),
                None,
            ),
        )?;
    } else {
        requests[index]["status"] = json!("denied");
        requests[index]["deniedAt"] = json!(timestamp);
        requests[index]["endedAt"] = json!(timestamp);
        requests[index]["error"] = json!("The user denied this run in Liatir.");
        append_audit(
            &app,
            audit_record(
                "run-denied",
                "denied",
                request_client(&requests[index]),
                requests[index].get("workspaceId").and_then(Value::as_str),
                requests[index].get("pipelineId").and_then(Value::as_str),
                Some(&run_id),
                Some("Denied by the user in Liatir"),
            ),
        )?;
    }
    let resolved = requests[index].clone();
    save_requests(&app, requests)?;
    emit_state_changed(&app);
    Ok(resolved)
}

#[tauri::command]
pub fn lia_mcp_mark_started(
    app: AppHandle,
    window: WebviewWindow,
    run_id: String,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut requests = load_requests(&app)?;
    let request = requests
        .iter_mut()
        .find(|request| request.get("runId").and_then(Value::as_str) == Some(run_id.as_str()))
        .ok_or_else(|| format!("MCP run request not found: {run_id}"))?;
    if request.get("status").and_then(Value::as_str) != Some("queued") {
        return Err("Only an authorized queued MCP run can start".to_string());
    }
    request["status"] = json!("running");
    request["startedAt"] = json!(now_ms());
    append_audit(
        &app,
        audit_record(
            "run-started",
            "allowed",
            request_client(request),
            request.get("workspaceId").and_then(Value::as_str),
            request.get("pipelineId").and_then(Value::as_str),
            Some(&run_id),
            None,
        ),
    )?;
    let started = request.clone();
    save_requests(&app, requests)?;
    emit_state_changed(&app);
    Ok(started)
}

#[tauri::command]
pub fn lia_mcp_finish_run(
    app: AppHandle,
    window: WebviewWindow,
    run_id: String,
    status: String,
    result_id: Option<String>,
    error: Option<String>,
) -> Result<Value, String> {
    ensure_main_window(&window)?;
    if !matches!(status.as_str(), "done" | "error" | "cancelled" | "interrupted") {
        return Err("MCP runs can only be finished with a terminal execution status".to_string());
    }
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    let mut requests = load_requests(&app)?;
    let request = requests
        .iter_mut()
        .find(|request| request.get("runId").and_then(Value::as_str) == Some(run_id.as_str()))
        .ok_or_else(|| format!("MCP run request not found: {run_id}"))?;
    let previous = request.get("status").and_then(Value::as_str).unwrap_or_default();
    if is_terminal_status(previous) {
        return Ok(request.clone());
    }
    if !matches!(previous, "running" | "cancel-requested" | "queued") {
        return Err("This MCP run cannot be finalized from its current state".to_string());
    }
    request["status"] = json!(status);
    request["endedAt"] = json!(now_ms());
    if let Some(value) = result_id.as_deref() {
        request["resultId"] = json!(value);
    }
    request["error"] = error.as_deref().map_or(Value::Null, |value| json!(value));
    append_audit(
        &app,
        audit_record(
            "run-finished",
            if status == "done" { "completed" } else { "failed" },
            request_client(request),
            request.get("workspaceId").and_then(Value::as_str),
            request.get("pipelineId").and_then(Value::as_str),
            Some(&run_id),
            Some(&status),
        ),
    )?;
    let finished = request.clone();
    save_requests(&app, requests)?;
    emit_state_changed(&app);
    Ok(finished)
}

#[tauri::command]
pub fn lia_mcp_audit_records(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<Value>, String> {
    ensure_main_window(&window)?;
    let state = app.state::<McpRuntimeState>();
    let _guard = state.lock()?;
    read_json(&app, AUDIT_PATH, json!([]))?
        .as_array()
        .cloned()
        .ok_or_else(|| "Invalid MCP audit index".to_string())
}

#[derive(Clone)]
struct LiatirMcpServer {
    app: AppHandle,
}

impl LiatirMcpServer {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn client(context: &RequestContext<RoleServer>) -> Value {
        context.client_info().map_or_else(
            || json!({ "name": "unknown-mcp-client" }),
            |info| {
                json!({
                    "name": info.name,
                    "version": info.version,
                })
            },
        )
    }

    fn exact_string_argument<'a>(
        request: &'a CallToolRequestParams,
        name: &str,
    ) -> Result<&'a str, String> {
        let arguments = request
            .arguments
            .as_ref()
            .ok_or_else(|| format!("{name} is required"))?;
        if arguments.len() != 1 || !arguments.contains_key(name) {
            return Err(format!("This MCP tool accepts only {name}"));
        }
        arguments
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("{name} is required"))
    }

    fn start_arguments(
        request: &CallToolRequestParams,
    ) -> Result<(&str, &Map<String, Value>), String> {
        let arguments = request
            .arguments
            .as_ref()
            .ok_or_else(|| "pipeline_id and inputs are required".to_string())?;
        if arguments.len() != 2
            || !arguments.contains_key("pipeline_id")
            || !arguments.contains_key("inputs")
        {
            return Err("This MCP tool accepts only pipeline_id and inputs".to_string());
        }
        let pipeline_id = arguments
            .get("pipeline_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "pipeline_id is required".to_string())?;
        let inputs = arguments
            .get("inputs")
            .and_then(Value::as_object)
            .ok_or_else(|| "inputs must be an object".to_string())?;
        Ok((pipeline_id, inputs))
    }

    fn start_tool() -> Tool {
        let schema: JsonObject = serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "pipeline_id": {
                    "type": "string",
                    "minLength": 1,
                    "description": "ID of an allowed saved pipeline in Liatir's active workspace."
                },
                "inputs": {
                    "type": "object",
                    "description": "Run-time values keyed by the input IDs advertised with the allowed pipeline. File values use {artifactId}. Omitted values keep the saved pipeline value or field default."
                }
            },
            "required": ["pipeline_id", "inputs"],
            "additionalProperties": false
        }))
        .expect("static MCP start schema must be an object");
        Tool::new(
            START_SAVED_PIPELINE,
            "Request one exact saved pipeline revision with any advertised run-time inputs. Liatir shows the supplied values and asks the user for approval before execution.",
            schema,
        )
        .with_title("Run saved Liatir pipeline")
        .with_annotations(
            ToolAnnotations::new()
                .read_only(false)
                .destructive(false)
                .idempotent(false)
                // A saved pipeline can contain an explicitly configured API
                // Connector even though MCP cannot alter that configuration.
                .open_world(true),
        )
    }

    fn cancel_tool() -> Tool {
        let schema: JsonObject = serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Stable ID returned by start_saved_pipeline."
                }
            },
            "required": ["run_id"],
            "additionalProperties": false
        }))
        .expect("static MCP cancel schema must be an object");
        Tool::new(
            CANCEL_PIPELINE_RUN,
            "Request cancellation of one pipeline run that originated through this MCP server.",
            schema,
        )
        .with_title("Cancel Liatir pipeline run")
        .with_annotations(
            ToolAnnotations::new()
                .read_only(false)
                .destructive(false)
                .idempotent(true)
                .open_world(false),
        )
    }

    fn cancel_job_tool() -> Tool {
        let schema: JsonObject = serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "job_id": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Job ID advertised by liatir://jobs for a pipeline run started through MCP."
                }
            },
            "required": ["job_id"],
            "additionalProperties": false
        }))
        .expect("static MCP Job cancellation schema must be an object");
        Tool::new(
            CANCEL_JOB,
            "Request owner-aware cancellation of the MCP pipeline run that owns one advertised Job.",
            schema,
        )
        .with_title("Cancel Liatir Job")
        .with_annotations(
            ToolAnnotations::new()
                .read_only(false)
                .destructive(false)
                .idempotent(true)
                .open_world(false),
        )
    }

    fn call_start(&self, request: &CallToolRequestParams, client: Value) -> Result<Value, String> {
        let (pipeline_id, inputs) = Self::start_arguments(request)?;
        let state = self.app.state::<McpRuntimeState>();
        let _guard = state.lock()?;
        let config = load_config(&self.app)?;
        if config.get("enabled").and_then(Value::as_bool) != Some(true) {
            return Err("The Liatir MCP server is disabled".to_string());
        }
        let workspace = active_workspace(&self.app)?;
        let workspace_id = workspace
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Active workspace has no identity".to_string())?;
        let pipeline = saved_pipeline(&self.app, workspace_id, pipeline_id)?;
        let revision = pipeline_revision(&pipeline)?;
        let grant = config
            .get("allowlist")
            .and_then(Value::as_array)
            .and_then(|grants| {
                grants
                    .iter()
                    .find(|grant| grant_matches(grant, workspace_id, pipeline_id, &revision))
            })
            .ok_or_else(|| "This saved pipeline revision is not allowed for MCP".to_string())?;
        let input_schema = grant
            .get("inputs")
            .and_then(Value::as_array)
            .ok_or_else(|| "This pipeline grant has no valid input contract".to_string())?
            .clone();

        let mut requests = load_requests(&self.app)?;
        validate_pipeline_inputs(
            &self.app,
            &config,
            &requests,
            workspace_id,
            &input_schema,
            inputs,
        )?;
        let already_active = requests.iter().any(|existing| {
            existing.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
                && existing.get("pipelineId").and_then(Value::as_str) == Some(pipeline_id)
                && existing
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|status| !is_terminal_status(status))
        });
        if already_active {
            return Err("This saved pipeline already has an active MCP run".to_string());
        }

        let run_id = Uuid::new_v4().to_string();
        let pipeline_name = pipeline
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Pipeline");
        let run_request = json!({
            "schemaVersion": SCHEMA_VERSION,
            "runId": run_id,
            "workspaceId": workspace_id,
            "workspaceName": workspace.get("name").and_then(Value::as_str).unwrap_or("Workspace"),
            "pipelineId": pipeline_id,
            "pipelineName": pipeline_name,
            "pipelineRevision": revision,
            "inputSchema": input_schema,
            "inputs": inputs,
            "client": client,
            "status": "awaiting-authorization",
            "requestedAt": now_ms(),
            "error": null,
        });
        requests.insert(0, run_request.clone());
        save_requests(&self.app, requests)?;
        append_audit(
            &self.app,
            audit_record(
                "run-requested",
                "allowed",
                request_client(&run_request),
                Some(workspace_id),
                Some(pipeline_id),
                Some(&run_id),
                Some("Awaiting explicit authorization in Liatir"),
            ),
        )?;

        let _ = self
            .app
            .emit_to("main", EVENT_AUTHORIZATION_REQUESTED, run_request.clone());
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        emit_state_changed(&self.app);
        Ok(run_request)
    }

    fn call_cancel(&self, request: &CallToolRequestParams, client: Value) -> Result<Value, String> {
        let run_id = Self::exact_string_argument(request, "run_id")?;
        let state = self.app.state::<McpRuntimeState>();
        let _guard = state.lock()?;
        let mut requests = load_requests(&self.app)?;
        let run_request = requests
            .iter_mut()
            .find(|candidate| candidate.get("runId").and_then(Value::as_str) == Some(run_id))
            .ok_or_else(|| "This run did not originate through Liatir MCP".to_string())?;
        let workspace = active_workspace(&self.app)?;
        if run_request.get("workspaceId").and_then(Value::as_str)
            != workspace.get("id").and_then(Value::as_str)
        {
            return Err("This MCP run is not in the active workspace".to_string());
        }
        let status = run_request
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if is_terminal_status(status) {
            append_audit(
                &self.app,
                audit_record(
                    "run-cancel-requested",
                    "allowed",
                    Some(&client),
                    run_request.get("workspaceId").and_then(Value::as_str),
                    run_request.get("pipelineId").and_then(Value::as_str),
                    Some(run_id),
                    Some("Run was already terminal"),
                ),
            )?;
            return Ok(run_request.clone());
        }
        if !matches!(status, "queued" | "running" | "cancel-requested") {
            return Err("This run is not authorized or running".to_string());
        }
        let cancellation_already_requested = status == "cancel-requested";
        if !cancellation_already_requested {
            run_request["status"] = json!("cancel-requested");
            run_request["cancelRequestedAt"] = json!(now_ms());
        }
        append_audit(
            &self.app,
            audit_record(
                "run-cancel-requested",
                "allowed",
                Some(&client),
                run_request.get("workspaceId").and_then(Value::as_str),
                run_request.get("pipelineId").and_then(Value::as_str),
                Some(run_id),
                cancellation_already_requested.then_some("Cancellation was already requested"),
            ),
        )?;
        let cancelled = run_request.clone();
        save_requests(&self.app, requests)?;
        let _ = self
            .app
            .emit_to("main", EVENT_CANCEL_REQUESTED, cancelled.clone());
        emit_state_changed(&self.app);
        Ok(cancelled)
    }

    fn call_cancel_job(
        &self,
        request: &CallToolRequestParams,
        client: Value,
    ) -> Result<Value, String> {
        let job_id = Self::exact_string_argument(request, "job_id")?;
        let state = self.app.state::<McpRuntimeState>();
        let _guard = state.lock()?;
        let workspace = active_workspace(&self.app)?;
        let workspace_id = workspace
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Active workspace has no identity".to_string())?;
        let mut requests = load_requests(&self.app)?;
        let executions = execution_records(&self.app, workspace_id)?;
        let (job, owned_request) =
            mcp_job(&self.app, &requests, &executions, workspace_id, job_id)?;
        let run_id = owned_request
            .get("runId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The owning MCP run has no identity".to_string())?
            .to_string();
        let run_request = requests
            .iter_mut()
            .find(|candidate| candidate.get("runId").and_then(Value::as_str) == Some(&run_id))
            .ok_or_else(|| "The owning MCP run no longer exists".to_string())?;
        let status = run_request
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !is_terminal_status(status) && !matches!(status, "queued" | "running" | "cancel-requested") {
            return Err("This Job's pipeline run is not authorized or running".to_string());
        }
        if !is_terminal_status(status) && status != "cancel-requested" {
            run_request["status"] = json!("cancel-requested");
            run_request["cancelRequestedAt"] = json!(now_ms());
            append_audit(
                &self.app,
                audit_record(
                    "job-cancel-requested",
                    "allowed",
                    Some(&client),
                    Some(workspace_id),
                    run_request.get("pipelineId").and_then(Value::as_str),
                    Some(&run_id),
                    Some(job_id),
                ),
            )?;
        }
        let cancelled = run_request.clone();
        save_requests(&self.app, requests)?;
        if !is_terminal_status(cancelled.get("status").and_then(Value::as_str).unwrap_or_default()) {
            let _ = self
                .app
                .emit_to("main", EVENT_CANCEL_REQUESTED, cancelled.clone());
        }
        emit_state_changed(&self.app);
        Ok(json!({
            "job": public_job(&job, &cancelled, None),
            "run": cancelled,
        }))
    }

    fn resource_json(&self, uri: &str) -> Result<Value, String> {
        let state = self.app.state::<McpRuntimeState>();
        let _guard = state.lock()?;
        let config = load_config(&self.app)?;
        let workspace = active_workspace(&self.app)?;
        let workspace_id = workspace
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Active workspace has no identity".to_string())?;
        let mut requests = load_requests(&self.app)?;
        requests.retain(|request| {
            request.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
        });
        let executions = execution_records(&self.app, workspace_id)?;

        if uri == ACTIVE_WORKSPACE_URI {
            return Ok(workspace);
        }
        if uri == ALLOWED_PIPELINES_URI {
            return Ok(json!({
                "workspace": workspace,
                "pipelines": valid_grants(&self.app, &config, workspace_id)?,
            }));
        }
        if uri == RUNS_URI {
            requests.truncate(MAX_RESOURCE_RUNS);
            return Ok(json!({ "runs": requests }));
        }
        if uri == JOBS_URI {
            let jobs = super::jobs::lia_jobs_list(
                self.app.clone(),
                Some(workspace_id.to_string()),
                Some(false),
            )?;
            let jobs = jobs
                .into_iter()
                .filter_map(|job| serde_json::to_value(job).ok())
                .filter_map(|job| {
                    let root_run_id = job_root_run_id(&job, &executions)?;
                    let request = requests.iter().find(|request| {
                        request.get("runId").and_then(Value::as_str) == Some(&root_run_id)
                    })?;
                    Some(public_job(&job, request, None))
                })
                .collect::<Vec<_>>();
            return Ok(json!({ "jobs": jobs }));
        }
        if uri == RESULTS_URI {
            if !results_read_allowed(&config, workspace_id) {
                return Err("Reading workspace Results is not allowed for MCP".to_string());
            }
            let results = analysis_results(&self.app, workspace_id)?
                .into_iter()
                .take(MAX_RESOURCE_RESULTS)
                .map(|result| {
                    public_result_summary(
                        &self.app,
                        &config,
                        &requests,
                        workspace_id,
                        &result,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(json!({ "results": results }));
        }
        if uri == ARTIFACTS_URI {
            return Ok(json!({
                "artifacts": readable_artifacts(&self.app, &config, &requests, workspace_id)?,
                "maxChunkBytes": MAX_ARTIFACT_CHUNK_BYTES,
            }));
        }
        if let Some(job_id) = parse_single_resource_uri(uri, JOB_PREFIX) {
            let (job, request) = mcp_job(
                &self.app,
                &requests,
                &executions,
                workspace_id,
                job_id,
            )?;
            let output = serde_json::to_value(super::jobs::lia_jobs_get_output(
                self.app.clone(),
                job_id.to_string(),
                None,
            )?)
            .map_err(|error| error.to_string())?;
            let replacements = path_replacements(&self.app, &config, &requests, workspace_id)?;
            return Ok(public_job(
                &job,
                &request,
                sanitize_value(&output, &replacements),
            ));
        }
        if let Some(result_id) = parse_single_resource_uri(uri, RESULT_PREFIX) {
            if !results_read_allowed(&config, workspace_id) {
                return Err("Reading workspace Results is not allowed for MCP".to_string());
            }
            let result = analysis_results(&self.app, workspace_id)?
                .into_iter()
                .find(|result| result.get("id").and_then(Value::as_str) == Some(result_id))
                .ok_or_else(|| "Result not found in the active workspace".to_string())?;
            return public_result(&self.app, &config, &requests, workspace_id, &result);
        }
        if let Some(artifact_id) = parse_single_resource_uri(uri, ARTIFACT_PREFIX) {
            let file = data_file(&self.app, workspace_id, artifact_id)?;
            return artifact_descriptor(&self.app, &config, &requests, workspace_id, &file)?
                .ok_or_else(|| "This artifact is not allowed for MCP".to_string());
        }

        let (run_id, kind) = parse_run_resource_uri(uri)
            .ok_or_else(|| format!("Unknown Liatir MCP resource: {uri}"))?;
        let run_request = requests
            .iter()
            .find(|request| request.get("runId").and_then(Value::as_str) == Some(run_id))
            .cloned()
            .ok_or_else(|| "MCP run not found in the active workspace".to_string())?;
        let owned_executions: Vec<Value> = executions
            .into_iter()
            .filter(|execution| {
                execution
                    .get("identity")
                    .and_then(|identity| identity.get("rootRunId"))
                    .and_then(Value::as_str)
                    == Some(run_id)
            })
            .collect();
        let replacements = path_replacements(&self.app, &config, &requests, workspace_id)?;

        match kind {
            "status" => Ok(json!({
                "request": run_request,
                "execution": owned_executions.iter().find(|execution| {
                    execution.get("identity").and_then(|identity| identity.get("runId")).and_then(Value::as_str) == Some(run_id)
                }).map(|execution| public_execution(execution, &replacements)),
            })),
            "logs" => {
                let analysis_log_rel = format!("workspaces/{workspace_id}/runs/{run_id}/log.jsonl");
                let result_log = read_run_log(&self.app, &analysis_log_rel)?;
                Ok(json!({
                    "runId": run_id,
                    "executions": owned_executions.into_iter().map(|execution| json!({
                        "runId": execution.get("identity").and_then(|identity| identity.get("runId")),
                        "runKind": execution.get("identity").and_then(|identity| identity.get("runKind")),
                        "label": execution.get("label"),
                        "status": execution.get("status"),
                        "logs": execution.get("logs")
                            .and_then(|logs| sanitize_value(logs, &replacements))
                            .unwrap_or_else(|| json!([])),
                    })).collect::<Vec<_>>(),
                    "resultLog": sanitize_value(&result_log, &replacements).unwrap_or_else(|| json!([])),
                }))
            }
            "result" => {
                let result_id = run_request
                    .get("resultId")
                    .and_then(Value::as_str)
                    .unwrap_or(run_id);
                let result = analysis_results(&self.app, workspace_id)?
                    .into_iter()
                    .find(|result| result.get("id").and_then(Value::as_str) == Some(result_id))
                    .ok_or_else(|| "The MCP run has no Result yet".to_string())?;
                Ok(json!({
                    "runId": run_id,
                    "resultId": result_id,
                    "data": public_result(&self.app, &config, &requests, workspace_id, &result)?,
                }))
            }
            _ => Err(format!("Unknown Liatir MCP run resource: {uri}")),
        }
    }

    fn resource_contents(&self, uri: &str) -> Result<ResourceContents, String> {
        if parse_artifact_content_uri(uri).is_some() {
            let state = self.app.state::<McpRuntimeState>();
            let _guard = state.lock()?;
            let workspace = active_workspace(&self.app)?;
            let workspace_id = workspace
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Active workspace has no identity".to_string())?;
            let config = load_config(&self.app)?;
            let requests = load_requests(&self.app)?;
            return artifact_content(
                &self.app,
                uri,
                &config,
                &requests,
                workspace_id,
            );
        }
        let value = self.resource_json(uri)?;
        let text = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
        Ok(ResourceContents::text(text, uri).with_mime_type("application/json"))
    }

    fn audit_tool_rejection(
        &self,
        request: &CallToolRequestParams,
        client: &Value,
        detail: &str,
    ) -> Result<(), String> {
        let state = self.app.state::<McpRuntimeState>();
        let _guard = state.lock()?;
        let workspace_id = active_workspace(&self.app).ok().and_then(|workspace| {
            workspace
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        let arguments = request.arguments.as_ref();
        let pipeline_id = arguments
            .and_then(|values| values.get("pipeline_id"))
            .and_then(Value::as_str);
        let run_id = arguments
            .and_then(|values| values.get("run_id"))
            .and_then(Value::as_str);
        append_audit(
            &self.app,
            audit_record(
                "request-rejected",
                "denied",
                Some(client),
                workspace_id.as_deref(),
                pipeline_id,
                run_id,
                Some(detail),
            ),
        )
    }
}

impl ServerHandler for LiatirMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_resources()
                .enable_tools()
                .build(),
        )
        .with_server_info(
            Implementation::new("liatir", env!("CARGO_PKG_VERSION"))
                .with_title("Liatir Scientific AI Workbench"),
        )
        .with_instructions(
            "Read explicitly permitted Liatir Results and artifacts, inspect MCP-owned Jobs, and request exact saved pipeline runs with their advertised inputs. Every run requires explicit approval in Liatir; this server cannot mutate pipelines, make scientific choices, execute shell commands, or read arbitrary paths.",
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(
            ListToolsResult::with_all_items(vec![
                Self::start_tool(),
                Self::cancel_tool(),
                Self::cancel_job_tool(),
            ])
                .with_ttl_ms(0)
                .with_cache_scope(CacheScope::Private),
        )
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        match name {
            START_SAVED_PIPELINE => Some(Self::start_tool()),
            CANCEL_PIPELINE_RUN => Some(Self::cancel_tool()),
            CANCEL_JOB => Some(Self::cancel_job_tool()),
            _ => None,
        }
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let client = Self::client(&context);
        let result = match request.name.as_ref() {
            START_SAVED_PIPELINE => self.call_start(&request, client.clone()),
            CANCEL_PIPELINE_RUN => self.call_cancel(&request, client.clone()),
            CANCEL_JOB => self.call_cancel_job(&request, client.clone()),
            _ => Err("Unknown Liatir MCP tool".to_string()),
        };
        Ok(match result {
            Ok(value) => CallToolResult::structured(value).into(),
            Err(error) => {
                if let Err(audit_error) = self.audit_tool_rejection(&request, &client, &error) {
                    return Err(McpError::internal_error(
                        format!("{error}; failed to write MCP audit: {audit_error}"),
                        None,
                    ));
                }
                CallToolResult::error(vec![ContentBlock::text(error)]).into()
            }
        })
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let client = Self::client(&context);
        let result = (|| -> Result<Vec<Resource>, String> {
            let state = self.app.state::<McpRuntimeState>();
            let _guard = state.lock()?;
            let workspace = active_workspace(&self.app)?;
            let workspace_id = workspace
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Active workspace has no identity".to_string())?;
            let config = load_config(&self.app)?;
            let requests = load_requests(&self.app)?;
            let workspace_requests = requests
                .iter()
                .filter(|request| {
                    request.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
                })
                .cloned()
                .collect::<Vec<_>>();
            let executions = execution_records(&self.app, workspace_id)?;
            append_audit(
                &self.app,
                audit_record(
                    "resource-listed",
                    "allowed",
                    Some(&client),
                    Some(workspace_id),
                    None,
                    None,
                    None,
                ),
            )?;
            let mut resources = vec![
                Resource::new(ACTIVE_WORKSPACE_URI, "active_workspace")
                    .with_title("Active Liatir workspace")
                    .with_description("Identity of the workspace currently open in Liatir.")
                    .with_mime_type("application/json"),
                Resource::new(ALLOWED_PIPELINES_URI, "allowed_pipelines")
                    .with_title("MCP-allowed saved pipelines")
                    .with_description("Exact saved pipeline revisions currently allowed for MCP requests.")
                    .with_mime_type("application/json"),
                Resource::new(RUNS_URI, "mcp_runs")
                    .with_title("Liatir MCP runs")
                    .with_description("Recent run requests created through MCP in the active workspace.")
                    .with_mime_type("application/json"),
                Resource::new(JOBS_URI, "mcp_jobs")
                    .with_title("Jobs owned by Liatir MCP runs")
                    .with_description("Jobs attached to pipeline runs started through this MCP server.")
                    .with_mime_type("application/json"),
                Resource::new(ARTIFACTS_URI, "mcp_artifacts")
                    .with_title("MCP-readable Liatir artifacts")
                    .with_description("Path-free metadata for Result artifacts and explicitly allowed Data files.")
                    .with_mime_type("application/json"),
            ];
            if results_read_allowed(&config, workspace_id) {
                resources.push(
                    Resource::new(RESULTS_URI, "workspace_results")
                        .with_title("Results in the active Liatir workspace")
                        .with_description("Results exposed by the workspace-level MCP permission.")
                        .with_mime_type("application/json"),
                );
            }
            for request in workspace_requests.iter().take(MAX_RESOURCE_RUNS) {
                let Some(run_id) = request.get("runId").and_then(Value::as_str) else {
                    continue;
                };
                resources.push(
                    Resource::new(format!("liatir://runs/{run_id}/status"), format!("run_{run_id}_status"))
                        .with_title("Pipeline run status")
                        .with_mime_type("application/json"),
                );
                resources.push(
                    Resource::new(format!("liatir://runs/{run_id}/logs"), format!("run_{run_id}_logs"))
                        .with_title("Pipeline run logs")
                        .with_mime_type("application/json"),
                );
                resources.push(
                    Resource::new(format!("liatir://runs/{run_id}/result"), format!("run_{run_id}_result"))
                        .with_title("Pipeline Result")
                        .with_mime_type("application/json"),
                );
            }
            for job in super::jobs::lia_jobs_list(
                self.app.clone(),
                Some(workspace_id.to_string()),
                Some(false),
            )? {
                let job = serde_json::to_value(job).map_err(|error| error.to_string())?;
                let Some(root_run_id) = job_root_run_id(&job, &executions) else {
                    continue;
                };
                if !workspace_requests.iter().any(|request| {
                    request.get("runId").and_then(Value::as_str) == Some(&root_run_id)
                }) {
                    continue;
                }
                let Some(job_id) = job.get("id").and_then(Value::as_str) else {
                    continue;
                };
                resources.push(
                    Resource::new(format!("{JOB_PREFIX}{job_id}"), format!("job_{job_id}"))
                        .with_title("Liatir Job")
                        .with_mime_type("application/json"),
                );
            }
            if results_read_allowed(&config, workspace_id) {
                for result in analysis_results(&self.app, workspace_id)?
                    .into_iter()
                    .take(MAX_RESOURCE_RESULTS)
                {
                    let Some(result_id) = result.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    resources.push(
                        Resource::new(
                            format!("{RESULT_PREFIX}{result_id}"),
                            format!("result_{result_id}"),
                        )
                        .with_title("Liatir Result")
                        .with_mime_type("application/json"),
                    );
                }
            }
            for artifact in readable_artifacts(
                &self.app,
                &config,
                &workspace_requests,
                workspace_id,
            )? {
                let Some(artifact_id) = artifact.get("artifactId").and_then(Value::as_str) else {
                    continue;
                };
                let mut resource = Resource::new(
                    format!("{ARTIFACT_PREFIX}{artifact_id}"),
                    format!("artifact_{artifact_id}"),
                )
                .with_title(
                    artifact
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Liatir artifact"),
                )
                .with_mime_type("application/json");
                if let Some(size) = artifact.get("size").and_then(Value::as_u64) {
                    resource = resource.with_size(size);
                }
                resources.push(resource);
            }
            Ok(resources)
        })();
        result
            .map(|resources| {
                ListResourcesResult::with_all_items(resources)
                    .with_ttl_ms(0)
                    .with_cache_scope(CacheScope::Private)
            })
            .map_err(|error| McpError::internal_error(error, None))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, McpError> {
        Ok(
            ListResourceTemplatesResult::with_all_items(vec![
                ResourceTemplate::new("liatir://runs/{run_id}/status", "run_status")
                    .with_title("Pipeline run status")
                    .with_mime_type("application/json"),
                ResourceTemplate::new("liatir://runs/{run_id}/logs", "run_logs")
                    .with_title("Pipeline run logs")
                    .with_mime_type("application/json"),
                ResourceTemplate::new("liatir://runs/{run_id}/result", "run_result")
                    .with_title("Pipeline Result")
                    .with_mime_type("application/json"),
                ResourceTemplate::new("liatir://jobs/{job_id}", "job")
                    .with_title("MCP-owned Liatir Job")
                    .with_mime_type("application/json"),
                ResourceTemplate::new("liatir://results/{result_id}", "result")
                    .with_title("Allowed Liatir Result")
                    .with_mime_type("application/json"),
                ResourceTemplate::new("liatir://artifacts/{artifact_id}", "artifact")
                    .with_title("Allowed Liatir artifact metadata")
                    .with_mime_type("application/json"),
                ResourceTemplate::new(
                    "liatir://artifacts/{artifact_id}/content/{offset}/{length}",
                    "artifact_content",
                )
                .with_title("Bounded Liatir artifact content chunk"),
            ])
            .with_ttl_ms(0)
            .with_cache_scope(CacheScope::Private),
        )
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let client = Self::client(&context);
        let contents = self
            .resource_contents(&request.uri)
            .map_err(|error| McpError::resource_not_found(error, None))?;
        {
            let state = self.app.state::<McpRuntimeState>();
            let _guard = state
                .lock()
                .map_err(|error| McpError::internal_error(error, None))?;
            let workspace_id = active_workspace(&self.app)
                .ok()
                .and_then(|workspace| workspace.get("id").and_then(Value::as_str).map(str::to_string));
            append_audit(
                &self.app,
                audit_record(
                    "resource-read",
                    "allowed",
                    Some(&client),
                    workspace_id.as_deref(),
                    None,
                    parse_run_resource_uri(&request.uri).map(|(run_id, _)| run_id),
                    Some(&request.uri),
                ),
            )
            .map_err(|error| McpError::internal_error(error, None))?;
        }
        Ok(ReadResourceResult::new(vec![contents])
        .with_ttl_ms(0)
        .with_cache_scope(CacheScope::Private)
        .into())
    }
}

fn parse_run_resource_uri(uri: &str) -> Option<(&str, &str)> {
    let rest = uri.strip_prefix(RUN_STATUS_PREFIX)?;
    let (run_id, kind) = rest.rsplit_once('/')?;
    if run_id.is_empty() || !matches!(kind, "status" | "logs" | "result") {
        return None;
    }
    Some((run_id, kind))
}

fn allowed_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok()) else {
        return true;
    };
    let Some(authority) = origin.strip_prefix("http://") else {
        return false;
    };
    let Some((host, port)) = authority.rsplit_once(':') else {
        return false;
    };
    matches!(host, "127.0.0.1" | "localhost")
        && !port.is_empty()
        && port.parse::<u16>().is_ok()
}

fn secure_token_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

async fn authorize_mcp(
    app: AppHandle,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let decision = (|| -> Result<(), (StatusCode, &'static str)> {
        if !allowed_origin(&headers) {
            return Err((StatusCode::FORBIDDEN, "Origin is not allowed"));
        }
        let state = app.state::<McpRuntimeState>();
        let _guard = state
            .lock()
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "MCP state is unavailable"))?;
        let config = load_config(&app)
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "MCP configuration is unavailable"))?;
        if config.get("enabled").and_then(Value::as_bool) != Some(true) {
            return Err((StatusCode::FORBIDDEN, "MCP server is disabled"));
        }
        let supplied = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default();
        let expected = config
            .get("bearerToken")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !secure_token_eq(supplied, expected) {
            return Err((StatusCode::UNAUTHORIZED, "Invalid bearer token"));
        }
        Ok(())
    })();
    match decision {
        Ok(()) => next.run(request).await,
        Err((status, message)) => (status, message).into_response(),
    }
}

/// Start the MCP endpoint on loopback. The listener exists for the app lifetime,
/// while policy enforcement keeps it inert until the user enables it.
pub async fn start(app: AppHandle) -> anyhow::Result<()> {
    {
        let state = app.state::<McpRuntimeState>();
        let _guard = state.lock().map_err(anyhow::Error::msg)?;
        load_config(&app).map_err(anyhow::Error::msg)?;
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    app.state::<McpRuntimeState>()
        .port
        .store(port, Ordering::Release);

    let service: StreamableHttpService<LiatirMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            {
                let app = app.clone();
                move || Ok(LiatirMcpServer::new(app.clone()))
            },
            Default::default(),
            StreamableHttpServerConfig::default().with_json_response(true),
        );
    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(DefaultBodyLimit::max(MAX_MCP_REQUEST_BYTES))
        .layer(middleware::from_fn({
            let app = app.clone();
            move |headers, request, next| authorize_mcp(app.clone(), headers, request, next)
        }));

    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_comparison_requires_an_exact_match() {
        assert!(secure_token_eq("abc123", "abc123"));
        assert!(!secure_token_eq("abc123", "abc124"));
        assert!(!secure_token_eq("abc123", "abc1234"));
    }

    #[test]
    fn bearer_tokens_are_fixed_lowercase_hex_secrets() {
        assert!(valid_bearer_token(&"a1".repeat(32)));
        assert!(!valid_bearer_token(&"a1".repeat(31)));
        assert!(!valid_bearer_token(&"A1".repeat(32)));
        assert!(!valid_bearer_token(&"z1".repeat(32)));
    }

    #[test]
    fn origin_allows_only_well_formed_http_loopback() {
        let allowed = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::ORIGIN, value.parse().unwrap());
            allowed_origin(&headers)
        };
        assert!(allowed("http://127.0.0.1:5173"));
        assert!(allowed("http://localhost:1420"));
        assert!(!allowed("null"));
        assert!(!allowed("https://localhost:1420"));
        assert!(!allowed("http://localhost.example:1420"));
        assert!(!allowed("http://127.0.0.1:@example.test"));
    }

    #[test]
    fn a_folder_grant_covers_its_own_tree_and_never_results() {
        assert!(data_folder_covers("Inputs", "Inputs"));
        assert!(data_folder_covers("Inputs", "Inputs/patient-1"));
        assert!(!data_folder_covers("Inputs", "Inputs-archive"));
        assert!(!data_folder_covers("Inputs", ""));
        // Results readability is the workspace Result grant, never a Data folder grant.
        assert!(!data_folder_covers("Results", "Results"));
        assert!(!data_folder_covers("Inputs", "Results/run-1"));
    }

    #[test]
    fn only_a_named_source_folder_can_carry_a_standing_grant() {
        assert!(is_grantable_folder("Inputs"));
        assert!(is_grantable_folder("Inputs/patient-1"));
        // The Data root would mean every present and future file in the workspace.
        assert!(!is_grantable_folder(""));
        assert!(!is_grantable_folder("   "));
        assert!(!is_grantable_folder("/"));
        assert!(!is_grantable_folder("Results"));
        assert!(!is_grantable_folder("Results/run-1"));
    }

    #[test]
    fn a_folder_grant_authorizes_a_file_exactly_like_a_file_grant() {
        let config = json!({
            "dataFolderAllowlist": [
                { "workspaceId": "ws-1", "folder": "Inputs" },
            ],
        });
        let file = |folder: &str| json!({ "id": "artifact-1", "folder": folder });
        assert!(folder_grant_allows(&config, "ws-1", &file("Inputs")));
        assert!(folder_grant_allows(&config, "ws-1", &file("Inputs/patient-1")));
        assert!(!folder_grant_allows(&config, "ws-1", &file("Other")));
        // Grants never cross workspaces.
        assert!(!folder_grant_allows(&config, "ws-2", &file("Inputs")));
    }

    #[test]
    fn a_bulk_permission_change_is_one_audit_entry() {
        let ids = |count: usize| (0..count).map(|n| format!("artifact-{n}")).collect::<Vec<_>>();
        // A single file keeps the plain identity the per-file action has always recorded.
        assert_eq!(bulk_detail(&ids(1)), "artifact-0");
        assert_eq!(bulk_detail(&ids(2)), "2 files: artifact-0, artifact-1");
        assert_eq!(bulk_detail(&ids(300)), "300 files");
    }

    #[test]
    fn mcp_administration_is_main_window_only() {
        assert!(is_main_window_label("main"));
        assert!(!is_main_window_label("plugin-dev-example"));
        assert!(!is_main_window_label("child"));
    }

    #[test]
    fn run_resources_accept_only_the_three_read_surfaces() {
        assert_eq!(
            parse_run_resource_uri("liatir://runs/run-1/status"),
            Some(("run-1", "status"))
        );
        assert_eq!(
            parse_run_resource_uri("liatir://runs/run-1/logs"),
            Some(("run-1", "logs"))
        );
        assert!(parse_run_resource_uri("liatir://runs/run-1/shell").is_none());
        assert!(parse_run_resource_uri("liatir://runs//status").is_none());
    }

    #[test]
    fn artifact_chunks_are_identity_scoped_and_bounded() {
        assert_eq!(
            parse_artifact_content_uri("liatir://artifacts/file-1/content/1024/4096"),
            Some(("file-1", 1024, 4096))
        );
        assert!(parse_artifact_content_uri("liatir://artifacts/../content/0/10").is_none());
        assert!(parse_artifact_content_uri("liatir://artifacts/file-1/content/0/0").is_none());
        assert!(parse_artifact_content_uri("liatir://artifacts/file-1/content/0/65537").is_none());
        assert!(parse_artifact_content_uri("liatir://artifacts/file-1/content/0/10/extra").is_none());
    }

    #[test]
    fn result_values_replace_known_paths_and_drop_unknown_path_fields() {
        let replacements = vec![(
            "/private/work/result.csv".to_string(),
            "liatir://artifacts/result-1".to_string(),
        )];
        let value = json!({
            "path": "/private/work/result.csv",
            "indexPath": "/secret/unregistered.idx",
            "description": "Created /private/work/result.csv",
            "raw": false,
        });
        assert_eq!(
            sanitize_value(&value, &replacements),
            Some(json!({
                "path": "liatir://artifacts/result-1",
                "description": "Created liatir://artifacts/result-1",
                "raw": false,
            }))
        );
        assert_eq!(sanitize_value(&json!({ "raw": true, "content": "secret" }), &[]), None);
    }

    #[test]
    fn output_lines_cannot_expose_an_unregistered_absolute_path() {
        let value = json!([
            "/mnt/c/Users/Bio/Gate 8/reads.fastq  FASTQ  DNA  17",
            r"C:\Users\Bio\private.fastq",
            "17 records processed",
        ]);
        assert_eq!(
            sanitize_value(&value, &[]),
            Some(json!([
                "[absolute path redacted]",
                "[absolute path redacted]",
                "17 records processed",
            ]))
        );
    }
}
