// src/bridge/network.rs
use std::net::ToSocketAddrs;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::Instant;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkStatus {
    pub online: bool,
    pub reason: String,      // "ok" | "dns" | "timeout" | "tls" | "unknown"
    pub latency_ms: Option<u128>,
}

#[tauri::command]
pub async fn dtr_network_get_status(app: AppHandle) -> Result<NetworkStatus, String> {
    // NOTE: Cheap probe to a fast, highly available endpoint.
    // Prefer a HEAD to a CDN endpoint you control; fallback to public.
    probe(&app, Some("https://www.cloudflare.com/cdn-cgi/trace".to_string()), 2500).await
}

#[tauri::command]
pub async fn dtr_network_ping(
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
pub async fn dtr_network_resolve(host: String) -> Result<serde_json::Value, String> {
    // NOTE: Use system resolver via ToSocketAddrs; for more control use trust-dns-resolver.
    let addrs: Vec<String> = (host.as_str(), 443)
        .to_socket_addrs()
        .map_err(|e| format!("DNS error: {e}"))?
        .map(|a| a.ip().to_string())
        .collect();
    Ok(serde_json::json!({ "addresses": addrs }))
}

#[tauri::command]
pub async fn dtr_network_bandwidth_estimate(
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
use std::sync::{Mutex, OnceLock};
use tokio::task::JoinHandle;

struct MonitorState {
    handle: Option<JoinHandle<()>>,
}

static MONITOR: OnceLock<Mutex<MonitorState>> = OnceLock::new();

#[tauri::command]
pub async fn dtr_network_set_monitor(app: AppHandle, interval_ms: u64, targets: Option<Vec<String>>) -> Result<(), String> {
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
pub async fn dtr_network_stop_monitor() -> Result<(), String> {
    if let Some(state) = MONITOR.get() {
        let mut s = state.lock().unwrap();
        if let Some(h) = s.handle.take() { h.abort(); }
    }
    Ok(())
}