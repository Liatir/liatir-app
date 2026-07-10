use reqwest::{header::CONTENT_TYPE, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use url::{Host, Url};

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_BOOT_TIMEOUT_MS: u64 = 30_000;
static OLLAMA_SERVER_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuentaRuntimeMessage {
    role: String,
    content: String,
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

fn ollama_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
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

fn start_ollama_server_process() -> Result<(), String> {
    let child_slot = OLLAMA_SERVER_CHILD.get_or_init(|| Mutex::new(None));
    let mut child_guard = child_slot
        .lock()
        .map_err(|_| "cannot lock local AI process state".to_string())?;

    if let Some(child) = child_guard.as_mut() {
        if child.try_wait().map_err(|error| format!("cannot inspect local AI process: {error}"))?.is_none() {
            return Ok(());
        }
    }

    let Some(ollama) = ollama_candidates().into_iter().next() else {
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("open")
                .args(["-a", "Ollama"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
        return Ok(());
    };

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

#[tauri::command]
pub async fn lia_quenta_ollama_status(base_url: String) -> Result<Value, String> {
    ollama_status_value(&base_url, Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_models(base_url: String) -> Result<Value, String> {
    ollama_models_value(&base_url, Duration::from_secs(15)).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_bootstrap(base_url: String, model: String) -> Result<Value, String> {
    let model = model.trim().to_string();
    if !model_name_is_safe(&model) {
        return Err("recommended local AI model name is invalid".to_string());
    }

    let status = match ollama_status_value(&base_url, Duration::from_secs(5)).await {
        Ok(value) => value,
        Err(_) => {
            tauri::async_runtime::spawn_blocking(start_ollama_server_process)
                .await
                .map_err(|error| error.to_string())??;
            wait_for_ollama(&base_url).await.map_err(|error| {
                format!("Quenta could not prepare its local AI engine automatically. This app build needs a bundled local AI runtime or an available advanced local runtime. Details: {error}")
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
pub async fn lia_quenta_ollama_chat(
    base_url: String,
    model: String,
    messages: Vec<QuentaRuntimeMessage>,
    temperature: f64,
    thinking_enabled: Option<bool>,
    format: Option<Value>,
) -> Result<Value, String> {
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
        "stream": false,
        "options": {
            "temperature": temperature.clamp(0.0, 2.0)
        }
    });
    if let Some(format) = format {
        body["format"] = format;
    }

    // No `tools` field is ever sent. Quenta is a read-only language-model
    // surface and cannot receive runnable callbacks from the application.
    let response = client(Duration::from_secs(15 * 60))?
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| format!("Ollama chat failed: {error}"))?;
    let value = json_response(response).await?;
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
    use super::ollama_endpoint;

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
}
