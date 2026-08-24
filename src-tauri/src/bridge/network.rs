// src/bridge/network.rs
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::Instant;
use url::Url;

const API_CONNECTOR_MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const API_CONNECTOR_DEFAULT_TIMEOUT_MS: u64 = 120_000;

static HTTP_REQUESTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestInput {
    request_id: String,
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseOutput {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
    duration_ms: u128,
}

fn http_requests() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    HTTP_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate_api_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid API URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("API Connector URLs must use http:// or https://.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Put credentials in Authentication, not in the API URL.".to_string());
    }
    Ok(())
}

async fn run_http_request(
    request: &HttpRequestInput,
    cancelled: &Arc<AtomicBool>,
) -> Result<HttpResponseOutput, String> {
    validate_api_url(&request.url)?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("Unsupported HTTP method: {}", request.method))?;
    let mut headers = HeaderMap::new();
    for (name, value) in &request.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid HTTP header name {name:?}: {error}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|error| format!("Invalid value for HTTP header {name}: {error}"))?;
        headers.insert(name, value);
    }

    let timeout_ms = request
        .timeout_ms
        .unwrap_or(API_CONNECTOR_DEFAULT_TIMEOUT_MS)
        .clamp(1_000, 600_000);
    let client = reqwest::Client::builder()
        .user_agent("Liatir API Connector")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client.request(method, &request.url).headers(headers);
    if let Some(body) = &request.body {
        builder = builder.body(body.clone());
    }

    let started = Instant::now();
    let mut pending = Box::pin(builder.send());
    let mut response = loop {
        tokio::select! {
            result = &mut pending => break result.map_err(|error| format!("API request failed: {error}"))?,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                if cancelled.load(Ordering::Relaxed) {
                    return Err("API request cancelled".to_string());
                }
            }
        }
    };

    let status = response.status();
    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| (name.to_string(), value.to_string())))
        .collect();
    if response
        .content_length()
        .is_some_and(|length| length > API_CONNECTOR_MAX_RESPONSE_BYTES as u64)
    {
        return Err("API response is larger than the 32 MB safety limit.".to_string());
    }

    let mut bytes = Vec::new();
    loop {
        let mut pending_chunk = Box::pin(tokio::time::timeout(
            Duration::from_secs(60),
            response.chunk(),
        ));
        let chunk = loop {
            tokio::select! {
                result = &mut pending_chunk => {
                    break result
                        .map_err(|_| "API response stalled for 60 seconds.".to_string())?
                        .map_err(|error| format!("Could not read API response: {error}"))?;
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    if cancelled.load(Ordering::Relaxed) {
                        return Err("API request cancelled".to_string());
                    }
                }
            }
        };
        let Some(chunk) = chunk else { break };
        if bytes.len().saturating_add(chunk.len()) > API_CONNECTOR_MAX_RESPONSE_BYTES {
            return Err("API response is larger than the 32 MB safety limit.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    Ok(HttpResponseOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers: response_headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        duration_ms: started.elapsed().as_millis(),
    })
}

/// Execute API Connector traffic in Rust so ordinary external APIs are not blocked by webview CORS.
#[tauri::command]
pub async fn lia_http_request(request: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    if request.request_id.trim().is_empty() {
        return Err("API request id is required.".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = http_requests().lock().unwrap();
        if active.contains_key(&request.request_id) {
            return Err("An API request with this id is already running.".to_string());
        }
        active.insert(request.request_id.clone(), Arc::clone(&cancelled));
    }
    let result = run_http_request(&request, &cancelled).await;
    http_requests().lock().unwrap().remove(&request.request_id);
    result
}

#[tauri::command]
pub fn lia_http_request_cancel(request_id: String) -> bool {
    let active = http_requests().lock().unwrap();
    let Some(cancelled) = active.get(&request_id) else { return false };
    cancelled.store(true, Ordering::Relaxed);
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkStatus {
    pub online: bool,
    pub reason: String,      // "ok" | "dns" | "timeout" | "tls" | "unknown"
    pub latency_ms: Option<u128>,
}

#[tauri::command]
pub async fn lia_network_get_status(app: AppHandle) -> Result<NetworkStatus, String> {
    // NOTE: Cheap probe to a fast, highly available endpoint.
    // Prefer a HEAD to a CDN endpoint you control; fallback to public.
    probe(&app, Some("https://www.cloudflare.com/cdn-cgi/trace".to_string()), 2500).await
}

#[tauri::command]
pub async fn lia_network_ping(
    app: AppHandle,
    url: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let timeout = timeout_ms.unwrap_or(2000);
    let start = Instant::now();
    let status = probe(&app, url, timeout).await?;
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(serde_json::json!({
        "ok": status.online,
        "latencyMs": status.latency_ms.unwrap_or(elapsed as u128)
    }))
}

#[tauri::command]
pub async fn lia_network_resolve(host: String) -> Result<serde_json::Value, String> {
    // NOTE: Use system resolver via ToSocketAddrs; for more control use trust-dns-resolver.
    let addrs: Vec<String> = (host.as_str(), 443)
        .to_socket_addrs()
        .map_err(|e| format!("DNS error: {e}"))?
        .map(|a| a.ip().to_string())
        .collect();
    Ok(serde_json::json!({ "addresses": addrs }))
}

#[tauri::command]
pub async fn lia_network_bandwidth_estimate(
    app: AppHandle,
    url: Option<String>,
    size_hint_bytes: Option<u64>,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    // NOTE: Download a small static file to estimate throughput.
    let url = url.unwrap_or_else(|| "https://speed.cloudflare.com/__down?bytes=200000".to_string());
    let timeout = timeout_ms.unwrap_or(4000);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let ms = start.elapsed().as_millis().max(1) as u64;
    let bytes_len = bytes.len() as u64;
    // kbps = (bytes * 8) / ms
    let kbps = ((bytes_len * 8) as f64) / (ms as f64);
    Ok(serde_json::json!({ "kbps": kbps, "bytes": bytes_len, "ms": ms }))
}

async fn probe(app: &AppHandle, url: Option<String>, timeout_ms: u64) -> Result<NetworkStatus, String> {
    // NOTE: First do a fast DNS check to discriminate reasons.
    let dns_ok = ("one.one.one.one", 443).to_socket_addrs().is_ok();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    let target = url.unwrap_or_else(|| "https://www.google.com/generate_204".to_string());

    let start = Instant::now();
    let res = client.head(&target).send().await;
    let status = match res {
        Ok(r) => {
            if r.status().is_success() || r.status().as_u16() == 204 {
                let latency = start.elapsed().as_millis();
                NetworkStatus { online: true, reason: "ok".into(), latency_ms: Some(latency) }
            } else {
                NetworkStatus { online: false, reason: "unknown".into(), latency_ms: None }
            }
        }
        Err(e) if e.is_timeout() => NetworkStatus { online: false, reason: "timeout".into(), latency_ms: None },
        Err(_e) => {
            let reason = if !dns_ok { "dns" } else { "unknown" };
            NetworkStatus { online: false, reason: reason.into(), latency_ms: None }
        }
    };

    // Emit a status event for listeners
    let _ = app.emit("network:status", &status);
    Ok(status)
}

// --- Optional: simple monitor (interval polling) ---
use tokio::task::JoinHandle;

struct MonitorState {
    handle: Option<JoinHandle<()>>,
}

static MONITOR: OnceLock<Mutex<MonitorState>> = OnceLock::new();

#[tauri::command]
pub async fn lia_network_set_monitor(app: AppHandle, interval_ms: u64, targets: Option<Vec<String>>) -> Result<(), String> {
    // NOTE: Simple polling monitor; for OS-level callbacks use platform-specific crates.
    let app_handle = app.clone();
    let tgts = targets.unwrap_or_else(|| vec![
        "https://www.google.com/generate_204".to_string(),
        "https://www.cloudflare.com/cdn-cgi/trace".to_string()
    ]);

    let handle = tokio::spawn(async move {
        loop {
            for t in &tgts {
                let _ = probe(&app_handle, Some(t.clone()), 2500).await;
            }
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        }
    });

    let state = MONITOR.get_or_init(|| Mutex::new(MonitorState { handle: None }));
    let mut s = state.lock().unwrap();
    if let Some(old) = s.handle.take() { old.abort(); }
    s.handle = Some(handle);
    Ok(())
}

#[tauri::command]
pub async fn lia_network_stop_monitor() -> Result<(), String> {
    if let Some(state) = MONITOR.get() {
        let mut s = state.lock().unwrap();
        if let Some(h) = s.handle.take() { h.abort(); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_api_url;

    #[test]
    fn api_connector_accepts_only_ordinary_http_urls_without_embedded_credentials() {
        assert!(validate_api_url("https://api.example.test/v1/items").is_ok());
        assert!(validate_api_url("http://127.0.0.1:8080/items").is_ok());
        assert!(validate_api_url("file:///tmp/secret").is_err());
        assert!(validate_api_url("https://user:password@example.test/items").is_err());
        assert!(validate_api_url("not a url").is_err());
    }
}
