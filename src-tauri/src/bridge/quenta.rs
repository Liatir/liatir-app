use crate::bridge::app_storage::{resolve_app_path, write_text_atomic};
use crate::bridge::managed_bins::stream_download;
use reqwest::{header::CONTENT_TYPE, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};
use url::{Host, Url};

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_BOOT_TIMEOUT_MS: u64 = 60_000;
const MANAGED_OLLAMA_DOWNLOAD_ID: &str = "quenta-ollama-runtime";
const OLLAMA_MACOS_DOWNLOAD_URL: &str = "https://ollama.com/download/Ollama-darwin.zip";
static OLLAMA_SERVER_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static QUENTA_CHAT_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();
static QUENTA_CONVERSATIONS_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static QUENTA_BOOTSTRAP_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuentaRuntimeMessage {
    role: String,
    content: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum QuentaChatStreamEvent {
    ThinkingDelta { delta: String },
    ContentDelta { delta: String },
}

#[derive(Default)]
struct QuentaChatStreamAccumulator {
    model: Option<String>,
    content: String,
    thinking: String,
    final_chunk: Option<Value>,
    done: bool,
}

impl QuentaChatStreamAccumulator {
    fn push(&mut self, chunk: Value) -> Result<Vec<QuentaChatStreamEvent>, String> {
        if chunk
            .pointer("/message/tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|calls| !calls.is_empty())
        {
            return Err(
                "Ollama returned a tool call, which the read-only Quenta refuses".to_string(),
            );
        }

        let mut deltas = Vec::new();
        if let Some(model) = chunk.get("model").and_then(Value::as_str) {
            self.model = Some(model.to_string());
        }
        if let Some(thinking) = chunk
            .pointer("/message/thinking")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            self.thinking.push_str(thinking);
            deltas.push(QuentaChatStreamEvent::ThinkingDelta {
                delta: thinking.to_string(),
            });
        }
        if let Some(content) = chunk
            .pointer("/message/content")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            self.content.push_str(content);
            deltas.push(QuentaChatStreamEvent::ContentDelta {
                delta: content.to_string(),
            });
        }
        self.done = chunk.get("done").and_then(Value::as_bool).unwrap_or(false);
        self.final_chunk = Some(chunk);
        Ok(deltas)
    }

    fn finish(self, fallback_model: &str) -> Result<Value, String> {
        if !self.done {
            return Err("Ollama ended the response before it was complete".to_string());
        }
        let mut value = self
            .final_chunk
            .ok_or_else(|| "Ollama returned an empty response stream".to_string())?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| "Ollama returned an invalid response stream".to_string())?;
        object.insert(
            "model".to_string(),
            Value::String(self.model.unwrap_or_else(|| fallback_model.to_string())),
        );
        object.insert(
            "message".to_string(),
            json!({
                "role": "assistant",
                "content": self.content,
                "thinking": self.thinking,
            }),
        );
        Ok(value)
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuentaConversationsFile {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    conversations: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuentaConversationsWriteResult {
    rel: String,
    applied: bool,
    revision: u64,
    conversations: Vec<Value>,
}

fn quenta_conversations_workspace(rel: &str) -> Result<String, String> {
    let components = Path::new(rel)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if components.len() != 4
        || components[0] != "workspaces"
        || components[1].is_empty()
        || !components[1]
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        || components[2] != "quenta"
        || components[3] != "conversations.json"
    {
        return Err("Quenta conversations path is invalid".to_string());
    }
    Ok(components[1].clone())
}

fn normalized_quenta_conversations(
    conversations: Vec<Value>,
    workspace_id: &str,
) -> Result<Vec<Value>, String> {
    let mut normalized = conversations
        .into_iter()
        .map(|conversation| {
            let id = conversation
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Quenta conversation ID is missing".to_string())?;
            let conversation_workspace = conversation
                .get("workspaceId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Quenta conversation workspace is missing".to_string())?;
            if conversation_workspace != workspace_id {
                return Err("Quenta conversation belongs to another workspace".to_string());
            }
            let updated_at = conversation
                .get("updatedAt")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Quenta conversation timestamp is invalid".to_string())?;
            Ok((id.to_string(), updated_at, conversation))
        })
        .collect::<Result<Vec<_>, String>>()?;
    normalized.sort_by(|left, right| right.1.cmp(&left.1));

    let mut seen = std::collections::HashSet::new();
    Ok(normalized
        .into_iter()
        .filter(|(id, _, _)| seen.insert(id.clone()))
        .take(40)
        .map(|(_, _, conversation)| conversation)
        .collect())
}

fn quenta_chat_cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    QUENTA_CHAT_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn request_id_is_safe(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= 128
        && request_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':'))
}

async fn wait_for_chat_cancellation(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn ollama_endpoint(base_url: &str, endpoint: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url).map_err(|error| format!("invalid Ollama URL: {error}"))?;
    if url.scheme() != "http" {
        return Err("Ollama must use a local http:// endpoint".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Ollama endpoint credentials are not supported".to_string());
    }

    let is_loopback = match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
        Some(Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    };
    if !is_loopback {
        return Err("Ollama endpoint must resolve to localhost or a loopback IP".to_string());
    }

    url.set_query(None);
    url.set_fragment(None);
    url.set_path(&format!("/api/{}", endpoint.trim_start_matches('/')));
    Ok(url)
}

fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("cannot create Ollama client: {error}"))
}

fn model_name_is_safe(model: &str) -> bool {
    let trimmed = model.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':' | '/'))
}

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    #[cfg(target_os = "windows")]
    let extensions = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(target_os = "windows"))]
    let extensions = [""];

    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn managed_ollama_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?
        .join(".liatir")
        .join(".main")
        .join("runtimes")
        .join("quenta")
        .join("ollama"))
}

#[cfg(target_os = "macos")]
fn managed_ollama_download_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("cannot resolve app cache directory: {error}"))?
        .join(".liatir")
        .join(".main")
        .join("downloads")
        .join("quenta")
        .join("Ollama-darwin.zip"))
}

#[cfg(target_os = "macos")]
fn managed_ollama_executable(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_ollama_root(app)?
        .join("Ollama.app")
        .join("Contents")
        .join("Resources")
        .join("ollama"))
}

fn ollama_candidates(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(app) = app {
        if let Ok(path) = managed_ollama_executable(app) {
            candidates.push(path);
        }
    }

    if let Some(path) = find_executable_in_path("ollama") {
        candidates.push(path);
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/ollama"));
        candidates.push(PathBuf::from("/usr/local/bin/ollama"));
        candidates.push(PathBuf::from(
            "/Applications/Ollama.app/Contents/Resources/ollama",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data).join("Programs/Ollama/ollama.exe"));
        }
    }

    candidates
        .into_iter()
        .filter(|candidate| candidate.is_file())
        .collect()
}

#[cfg(target_os = "macos")]
fn extract_managed_ollama_archive(
    archive_path: &Path,
    runtime_root: &Path,
) -> Result<PathBuf, String> {
    let parent = runtime_root
        .parent()
        .ok_or_else(|| "cannot resolve managed local AI runtime directory".to_string())?;
    let staging = parent.join("ollama-runtime.staging");
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("cannot clean local AI staging directory: {error}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|error| format!("cannot create local AI staging directory: {error}"))?;

    let file = fs::File::open(archive_path)
        .map_err(|error| format!("cannot open downloaded local AI runtime: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("cannot read downloaded local AI runtime: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("cannot read local AI runtime archive entry: {error}"))?;
        let Some(enclosed_name) = entry.enclosed_name() else {
            continue;
        };
        let out_path = staging.join(enclosed_name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|error| format!("cannot create local AI runtime directory: {error}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create local AI runtime directory: {error}"))?;
        }
        let mut out_file = fs::File::create(&out_path)
            .map_err(|error| format!("cannot write local AI runtime file: {error}"))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|error| format!("cannot extract local AI runtime file: {error}"))?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))
                .map_err(|error| format!("cannot apply local AI runtime permissions: {error}"))?;
        }
    }

    let staged_app = staging.join("Ollama.app");
    let staged_executable = staged_app.join("Contents").join("Resources").join("ollama");
    if !staged_executable.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(
            "downloaded local AI runtime did not contain the expected executable".to_string(),
        );
    }

    if runtime_root.exists() {
        fs::remove_dir_all(runtime_root)
            .map_err(|error| format!("cannot replace old local AI runtime: {error}"))?;
    }
    fs::create_dir_all(runtime_root)
        .map_err(|error| format!("cannot create managed local AI runtime directory: {error}"))?;
    let final_app = runtime_root.join("Ollama.app");
    fs::rename(&staged_app, &final_app)
        .or_else(|_| {
            copy_dir_all(&staged_app, &final_app)?;
            fs::remove_dir_all(&staged_app)
        })
        .map_err(|error| format!("cannot install managed local AI runtime: {error}"))?;
    let _ = fs::remove_dir_all(&staging);

    let executable = final_app.join("Contents").join("Resources").join("ollama");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&executable)
            .map_err(|error| format!("cannot inspect managed local AI runtime: {error}"))?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(&executable, permissions)
            .map_err(|error| format!("cannot mark managed local AI runtime executable: {error}"))?;
    }

    Ok(executable)
}

#[cfg(target_os = "macos")]
fn copy_dir_all(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn ensure_managed_ollama_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = managed_ollama_executable(app)?;
    if executable.is_file() {
        return Ok(executable);
    }

    let runtime_root = managed_ollama_root(app)?;
    let archive_path = managed_ollama_download_path(app)?;
    let archive_path_string = archive_path.to_string_lossy().to_string();
    let cancelled = Arc::new(AtomicBool::new(false));
    stream_download(
        app,
        MANAGED_OLLAMA_DOWNLOAD_ID,
        OLLAMA_MACOS_DOWNLOAD_URL,
        &archive_path_string,
        None,
        &cancelled,
    )
    .await
    .map_err(|error| format!("cannot download the managed local AI runtime: {error}"))?;

    extract_managed_ollama_archive(&archive_path, &runtime_root)
}

#[cfg(not(target_os = "macos"))]
async fn ensure_managed_ollama_runtime(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("managed local AI runtime installation is not available on this platform yet".to_string())
}

fn start_ollama_server_process(ollama: PathBuf) -> Result<(), String> {
    let child_slot = OLLAMA_SERVER_CHILD.get_or_init(|| Mutex::new(None));
    let mut child_guard = child_slot
        .lock()
        .map_err(|_| "cannot lock local AI process state".to_string())?;

    if let Some(child) = child_guard.as_mut() {
        if child
            .try_wait()
            .map_err(|error| format!("cannot inspect local AI process: {error}"))?
            .is_none()
        {
            return Ok(());
        }
    }

    let child = Command::new(ollama)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("cannot start local AI engine: {error}"))?;
    *child_guard = Some(child);
    Ok(())
}

async fn ollama_status_value(base_url: &str, timeout: Duration) -> Result<Value, String> {
    let endpoint = ollama_endpoint(base_url, "version")?;
    let response = client(timeout)?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("Ollama is unavailable: {error}"))?;
    json_response(response).await
}

async fn ollama_models_value(base_url: &str, timeout: Duration) -> Result<Value, String> {
    let endpoint = ollama_endpoint(base_url, "tags")?;
    let response = client(timeout)?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("cannot list Ollama models: {error}"))?;
    json_response(response).await
}

fn models_include(value: &Value, model: &str) -> bool {
    value
        .get("models")
        .and_then(Value::as_array)
        .is_some_and(|models| {
            models.iter().any(|item| {
                item.get("name")
                    .or_else(|| item.get("model"))
                    .and_then(Value::as_str)
                    .is_some_and(|name| name == model)
            })
        })
}

async fn wait_for_ollama(base_url: &str) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let mut last_error = String::new();
    while started.elapsed() < Duration::from_millis(DEFAULT_BOOT_TIMEOUT_MS) {
        match ollama_status_value(base_url, Duration::from_secs(5)).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                tokio::time::sleep(Duration::from_millis(750)).await;
            }
        }
    }

    Err(if last_error.is_empty() {
        "local AI engine did not become ready in time".to_string()
    } else {
        last_error
    })
}

async fn pull_ollama_model(base_url: &str, model: &str) -> Result<Value, String> {
    let endpoint = ollama_endpoint(base_url, "pull")?;
    let response = client(Duration::from_secs(45 * 60))?
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": model,
                "stream": false
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("cannot download the recommended local AI model: {error}"))?;
    json_response(response).await
}

async fn json_response(response: Response) -> Result<Value, String> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Ollama response exceeded the 16 MB safety limit".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("cannot read Ollama response: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("Ollama response exceeded the 16 MB safety limit".to_string());
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Ollama returned invalid JSON: {error}"))?;
    if !status.is_success() {
        let detail = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("request failed");
        return Err(format!("Ollama returned {status}: {detail}"));
    }
    Ok(value)
}

fn consume_quenta_chat_stream_line(
    on_event: &Channel<QuentaChatStreamEvent>,
    line: &[u8],
    accumulator: &mut QuentaChatStreamAccumulator,
) -> Result<(), String> {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    if line.is_empty() {
        return Ok(());
    }
    let chunk: Value = serde_json::from_slice(line)
        .map_err(|error| format!("Ollama returned an invalid response stream: {error}"))?;
    for event in accumulator.push(chunk)? {
        let _ = on_event.send(event);
    }
    Ok(())
}

async fn streaming_quenta_chat_response(
    on_event: &Channel<QuentaChatStreamEvent>,
    fallback_model: &str,
    mut response: Response,
) -> Result<Value, String> {
    if !response.status().is_success() {
        return json_response(response).await;
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Ollama response exceeded the 16 MB safety limit".to_string());
    }

    let mut total_bytes = 0usize;
    let mut pending = Vec::new();
    let mut accumulator = QuentaChatStreamAccumulator::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("cannot read Ollama response stream: {error}"))?
    {
        total_bytes = total_bytes.saturating_add(chunk.len());
        if total_bytes > MAX_RESPONSE_BYTES {
            return Err("Ollama response exceeded the 16 MB safety limit".to_string());
        }
        pending.extend_from_slice(&chunk);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let mut line = pending.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            consume_quenta_chat_stream_line(on_event, &line, &mut accumulator)?;
        }
    }
    if !pending.is_empty() {
        consume_quenta_chat_stream_line(on_event, &pending, &mut accumulator)?;
    }
    accumulator.finish(fallback_model)
}

#[tauri::command]
pub async fn lia_quenta_ollama_status(base_url: String) -> Result<Value, String> {
    ollama_status_value(&base_url, Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_models(base_url: String) -> Result<Value, String> {
    ollama_models_value(&base_url, Duration::from_secs(15)).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_bootstrap(
    app: AppHandle,
    base_url: String,
    model: String,
) -> Result<Value, String> {
    let model = model.trim().to_string();
    if !model_name_is_safe(&model) {
        return Err("recommended local AI model name is invalid".to_string());
    }
    let _bootstrap_guard = QUENTA_BOOTSTRAP_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    let status = match ollama_status_value(&base_url, Duration::from_secs(5)).await {
        Ok(value) => value,
        Err(_) => {
            let ollama = match ollama_candidates(Some(&app)).into_iter().next() {
                Some(path) => path,
                None => ensure_managed_ollama_runtime(&app).await?,
            };
            tauri::async_runtime::spawn_blocking(move || start_ollama_server_process(ollama))
                .await
                .map_err(|error| error.to_string())??;
            wait_for_ollama(&base_url).await.map_err(|error| {
                format!("Quenta could not start the local AI engine after preparing it. Details: {error}")
            })?
        }
    };

    let mut models = ollama_models_value(&base_url, Duration::from_secs(15)).await?;
    let mut downloaded = false;
    if !models_include(&models, &model) {
        pull_ollama_model(&base_url, &model).await?;
        downloaded = true;
        models = ollama_models_value(&base_url, Duration::from_secs(15)).await?;
    }

    if !models_include(&models, &model) {
        return Err(format!(
            "The recommended local AI model {model} was not found after setup."
        ));
    }

    Ok(json!({
        "available": true,
        "version": status.get("version").and_then(Value::as_str),
        "model": model,
        "downloaded": downloaded,
        "models": models.get("models").cloned().unwrap_or_else(|| json!([])),
    }))
}

#[tauri::command]
pub fn lia_quenta_conversations_compare_and_swap(
    app: AppHandle,
    rel: String,
    expected_revision: u64,
    conversations: Vec<Value>,
) -> Result<QuentaConversationsWriteResult, String> {
    let workspace_id = quenta_conversations_workspace(&rel)?;
    let path = resolve_app_path(&app, &rel)?;
    let _guard = QUENTA_CONVERSATIONS_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "cannot access Quenta conversation storage".to_string())?;

    let current = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        serde_json::from_str::<QuentaConversationsFile>(&raw)
            .map_err(|_| "Quenta conversations file is invalid".to_string())?
    } else {
        QuentaConversationsFile::default()
    };
    let current_conversations = normalized_quenta_conversations(
        current.conversations,
        &workspace_id,
    )?;
    if current.revision != expected_revision {
        return Ok(QuentaConversationsWriteResult {
            rel,
            applied: false,
            revision: current.revision,
            conversations: current_conversations,
        });
    }

    let conversations = normalized_quenta_conversations(conversations, &workspace_id)?;
    let revision = current
        .revision
        .checked_add(1)
        .ok_or_else(|| "Quenta conversation revision overflow".to_string())?;
    let content = serde_json::to_string_pretty(&QuentaConversationsFile {
        revision,
        conversations: conversations.clone(),
    })
    .map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    write_text_atomic(&path, &content)?;

    let result = QuentaConversationsWriteResult {
        rel,
        applied: true,
        revision,
        conversations,
    };
    let _ = app.emit(
        "quenta:conversations-updated",
        json!({ "rel": &result.rel, "revision": result.revision }),
    );
    Ok(result)
}

#[tauri::command]
pub async fn lia_quenta_ollama_chat(
    request_id: String,
    base_url: String,
    model: String,
    messages: Vec<QuentaRuntimeMessage>,
    temperature: f64,
    thinking_enabled: Option<bool>,
    format: Option<Value>,
    on_event: Channel<QuentaChatStreamEvent>,
) -> Result<Value, String> {
    if !request_id_is_safe(&request_id) {
        return Err("Quenta request ID is invalid".to_string());
    }
    if model.trim().is_empty() {
        return Err("Select an installed Ollama model first".to_string());
    }
    if messages.is_empty() {
        return Err("Quenta messages cannot be empty".to_string());
    }
    if messages
        .iter()
        .any(|message| !matches!(message.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err("Quenta message role is invalid".to_string());
    }

    let endpoint = ollama_endpoint(&base_url, "chat")?;
    let mut body = json!({
        "model": model,
        "messages": messages,
        "think": thinking_enabled.unwrap_or(false),
        "stream": true,
        "options": {
            "temperature": temperature.clamp(0.0, 2.0)
        }
    });
    if let Some(format) = format {
        body["format"] = format;
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = quenta_chat_cancellations()
            .lock()
            .map_err(|_| "cannot access Quenta cancellation state".to_string())?;
        if cancellations.contains_key(&request_id) {
            return Err("Quenta request ID is already active".to_string());
        }
        cancellations.insert(request_id.clone(), cancelled.clone());
    }

    // No `tools` field is ever sent. Quenta is a read-only language-model
    // surface and cannot receive runnable callbacks from the application.
    let request = async {
        let response = client(Duration::from_secs(15 * 60))?
            .post(endpoint)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|error| format!("Ollama chat failed: {error}"))?;
        streaming_quenta_chat_response(&on_event, &model, response).await
    };
    let value = tokio::select! {
        result = request => result,
        _ = wait_for_chat_cancellation(cancelled) => Err("Quenta response stopped".to_string()),
    };
    if let Ok(mut cancellations) = quenta_chat_cancellations().lock() {
        cancellations.remove(&request_id);
    }
    let value = value?;
    if value
        .pointer("/message/tool_calls")
        .and_then(Value::as_array)
        .is_some_and(|calls| !calls.is_empty())
    {
        return Err("Ollama returned a tool call, which the read-only Quenta refuses".to_string());
    }
    Ok(value)
}

#[tauri::command]
pub fn lia_quenta_ollama_cancel_chat(request_id: String) -> Result<bool, String> {
    if !request_id_is_safe(&request_id) {
        return Err("Quenta request ID is invalid".to_string());
    }
    let cancellations = quenta_chat_cancellations()
        .lock()
        .map_err(|_| "cannot access Quenta cancellation state".to_string())?;
    let Some(cancelled) = cancellations.get(&request_id) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}

#[tauri::command]
pub async fn lia_quenta_ollama_embed(
    base_url: String,
    model: String,
    input: Vec<String>,
) -> Result<Value, String> {
    if model.trim().is_empty() {
        return Err("Select an installed Ollama embedding model first".to_string());
    }
    if input.is_empty() || input.len() > 128 {
        return Err("Embedding input must contain between 1 and 128 documents".to_string());
    }
    let endpoint = ollama_endpoint(&base_url, "embed")?;
    let response = client(Duration::from_secs(10 * 60))?
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": model,
                "input": input,
                "truncate": true
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("Ollama embedding failed: {error}"))?;
    json_response(response).await
}

#[cfg(test)]
mod tests {
    use super::{
        lia_quenta_ollama_cancel_chat, normalized_quenta_conversations, ollama_endpoint,
        quenta_chat_cancellations, quenta_conversations_workspace, request_id_is_safe,
        QuentaChatStreamAccumulator,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[test]
    fn accepts_only_loopback_ollama_endpoints() {
        assert_eq!(
            ollama_endpoint("http://127.0.0.1:11434", "chat")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:11434/api/chat"
        );
        assert!(ollama_endpoint("http://localhost:11434/api", "tags").is_ok());
        assert!(ollama_endpoint("http://[::1]:11434", "embed").is_ok());
        assert!(ollama_endpoint("https://localhost:11434", "chat").is_err());
        assert!(ollama_endpoint("http://example.com:11434", "chat").is_err());
        assert!(ollama_endpoint("http://127.0.0.1.evil.test", "chat").is_err());
    }

    #[test]
    fn validates_and_cancels_only_the_registered_quenta_request() {
        assert!(request_id_is_safe("quenta-request-123"));
        assert!(!request_id_is_safe("request with spaces"));

        let request_id = "quenta-cancellation-test".to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        quenta_chat_cancellations()
            .lock()
            .unwrap()
            .insert(request_id.clone(), cancelled.clone());

        assert_eq!(lia_quenta_ollama_cancel_chat(request_id.clone()), Ok(true));
        assert!(cancelled.load(Ordering::Relaxed));
        assert_eq!(
            lia_quenta_ollama_cancel_chat("missing-request".to_string()),
            Ok(false)
        );

        quenta_chat_cancellations()
            .lock()
            .unwrap()
            .remove(&request_id);
    }

    #[test]
    fn accumulates_thinking_and_content_from_streamed_chat_chunks() {
        let mut stream = QuentaChatStreamAccumulator::default();
        assert_eq!(
            stream
                .push(json!({
                    "model": "mock-local",
                    "message": { "thinking": "Check the evidence. " },
                    "done": false
                }))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            stream
                .push(json!({
                    "model": "mock-local",
                    "message": { "content": "Observed result." },
                    "done": true,
                    "prompt_eval_count": 10,
                    "eval_count": 4
                }))
                .unwrap()
                .len(),
            1
        );

        let response = stream.finish("fallback").unwrap();
        assert_eq!(response["model"], "mock-local");
        assert_eq!(response["message"]["thinking"], "Check the evidence. ");
        assert_eq!(response["message"]["content"], "Observed result.");
        assert_eq!(response["prompt_eval_count"], 10);
    }

    #[test]
    fn rejects_tool_calls_before_finishing_a_streamed_chat() {
        let mut stream = QuentaChatStreamAccumulator::default();
        assert!(stream
            .push(json!({
                "message": {
                    "tool_calls": [{ "function": { "name": "run_pipeline" } }]
                },
                "done": true
            }))
            .is_err());
    }

    #[test]
    fn validates_and_orders_quenta_conversation_storage() {
        assert_eq!(
            quenta_conversations_workspace("workspaces/workspace-1/quenta/conversations.json"),
            Ok("workspace-1".to_string())
        );
        assert!(quenta_conversations_workspace("quenta/conversations.json").is_err());
        assert!(quenta_conversations_workspace("workspaces/../quenta/conversations.json").is_err());

        let conversations = normalized_quenta_conversations(
            vec![
                json!({ "id": "older", "workspaceId": "workspace-1", "updatedAt": 1 }),
                json!({ "id": "newer", "workspaceId": "workspace-1", "updatedAt": 2 }),
            ],
            "workspace-1",
        )
        .unwrap();
        assert_eq!(conversations[0]["id"], "newer");
        assert!(normalized_quenta_conversations(
            vec![json!({ "id": "wrong", "workspaceId": "workspace-2", "updatedAt": 3 })],
            "workspace-1",
        )
        .is_err());
    }
}
