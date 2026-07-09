use reqwest::{header::CONTENT_TYPE, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;
use url::{Host, Url};

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

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
    let endpoint = ollama_endpoint(&base_url, "version")?;
    let response = client(Duration::from_secs(10))?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("Ollama is unavailable: {error}"))?;
    json_response(response).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_models(base_url: String) -> Result<Value, String> {
    let endpoint = ollama_endpoint(&base_url, "tags")?;
    let response = client(Duration::from_secs(15))?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("cannot list Ollama models: {error}"))?;
    json_response(response).await
}

#[tauri::command]
pub async fn lia_quenta_ollama_chat(
    base_url: String,
    model: String,
    messages: Vec<QuentaRuntimeMessage>,
    temperature: f64,
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
