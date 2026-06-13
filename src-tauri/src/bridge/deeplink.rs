// src/bridge/deeplink.rs
use serde::Serialize;
use std::str::FromStr;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Url, WebviewWindow, Manager};

#[derive(Debug, Serialize)]
pub struct DeepLinkSegments {
  pub first: String,
  pub last: String,
  pub list: Vec<String>,
}

impl Default for DeepLinkSegments {
  fn default() -> Self {
      Self {
          first: String::new(),
          last: String::new(),
          list: Vec::new(),
      }
  }
}

#[derive(Debug, Serialize)]
pub struct DeepLinkPayload {
  pub scheme: String,
  pub segments: DeepLinkSegments,
  pub query: HashMap<String, String> ,
  pub raw: String,
  pub error: Option<String>,
}

impl Default for DeepLinkPayload {
  fn default() -> Self {
      Self {
          scheme: String::new(),
          segments: DeepLinkSegments::default(),
          query: HashMap::new(),
          raw: String::new(),
          error: None,
      }
  }
}

impl FromStr for DeepLinkPayload {
  type Err = ();
  fn from_str(s: &str) -> Result<Self, Self::Err> {
    let u = Url::parse(s).map_err(|_| ())?;
    let scheme = u.scheme().to_string();

    // Collect path segments (initially WITHOUT host when form is scheme://host/...)
    let mut list: Vec<String> = u
        .path_segments()
        .map(|it| it.map(|p| p.to_string()).collect())
        .unwrap_or_else(Vec::new);

    // Determine "first" (handle)
    // - If host exists => that's the handle
    // - Else => first path segment (or "")
    let first = if let Some(h) = u.host_str() {
        h.to_string()
    } else {
        list.first().cloned().unwrap_or_default()
    };

    // Ensure list includes the handle as the first element
    // Only needed when handle came from host (scheme://handle/...)
    if u.host_str().is_some() && !first.is_empty() {
        list.insert(0, first.clone());
    }

    // Last segment from the full list
    let last = list.last().cloned().unwrap_or_default();

    let segments = DeepLinkSegments { first, last, list };

    let query: HashMap<String, String> = u
    .query_pairs()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();

    Ok(Self {
      scheme, segments, query, raw: s.to_string(), error: None
    })
  }
}

fn focus_main_window(handle: &tauri::AppHandle) {
  // Try to get the "main" window; adjust the label if yours is different
  if let Some(win) = handle.get_webview_window("main") {
      // Make sure it's visible and not minimized
      let _ = win.show();
      let _ = win.unminimize();

      // Cross-platform focus
      #[cfg(target_os = "macos")]
      {
          // Workaround: briefly allow on all workspaces, then focus, then revert
          let _ = win.set_visible_on_all_workspaces(true); 
          let _ = win.set_focus();
          let _ = win.set_visible_on_all_workspaces(false);
      }
      #[cfg(not(target_os = "macos"))]
      {
          let _ = win.set_focus();
      }
  }
}

pub fn emit_parsed_deeplink(handle: &AppHandle, url: &str) {
  match DeepLinkPayload::from_str(url) {
    Ok(payload) => {
      // In Tauri v2, AppHandle::emit invia a TUTTE le finestre
      let _ = handle.emit("deeplink", &payload);
      focus_main_window(handle);
    }
    Err(_) => {
      let _ = handle.emit("deeplink", &DeepLinkPayload {
        scheme: String::new(),
        segments: DeepLinkSegments::default(),
        query: HashMap::new(),
        raw: url.to_string(),
        error: Some("invalid_url".into()),
      });
      focus_main_window(handle);
    }
  }
}
