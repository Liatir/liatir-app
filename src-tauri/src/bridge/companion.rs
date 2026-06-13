use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::helpers::states::{register_companion_sandbox, unregister_companion_sandbox};

const COMPANION_LABEL_PREFIX: &str = "dtr-cache-only-window-";

fn log_debug(app: &AppHandle, msg: &str) {
    // [DEBUG] Forward logs both to stdout and to the frontend
    println!("[Desktopr][DEBUG] {msg}");
    if let Err(e) = app.emit("desktopr:debug", msg.to_string()) {
        println!("[Desktopr][DEBUG] Failed to emit debug event: {e}");
    }
}

/// Simple appearance options parsed from the JSON config passed by the frontend.
/// This is intentionally minimal and can be extended later.
#[derive(Debug, Clone)]
struct CompanionAppearance {
    title: String,
    width: f64,
    height: f64,
    resizable: bool,
    open_fullscreen: bool,
    background_color: Option<String>,
}

impl Default for CompanionAppearance {
    fn default() -> Self {
        Self {
            title: "Cache-only Window".to_string(),
            width: 1100.0,
            height: 800.0,
            resizable: true,
            open_fullscreen: false,
            background_color: None,
        }
    }
}

/// Parse appearance options from the JSON config coming from the frontend.
/// Expected keys (all optional):
/// - title: string
/// - width: number
/// - height: number
/// - resizable: boolean
/// - openFullscreen: boolean (or open_fullscreen)
fn parse_appearance_config(config: &serde_json::Value) -> CompanionAppearance {
    let mut opts = CompanionAppearance::default();

    if let Some(t) = config.get("title").and_then(|v| v.as_str()) {
        opts.title = t.to_string();
    }

    if let Some(w) = config.get("width").and_then(|v| v.as_f64()) {
        if w > 0.0 {
            opts.width = w;
        }
    }

    if let Some(h) = config.get("height").and_then(|v| v.as_f64()) {
        if h > 0.0 {
            opts.height = h;
        }
    }

    if let Some(r) = config.get("resizable").and_then(|v| v.as_bool()) {
        opts.resizable = r;
    }

    if let Some(f) = config
        .get("openFullscreen")
        .or_else(|| config.get("open_fullscreen"))
        .and_then(|v| v.as_bool())
    {
        opts.open_fullscreen = f;
    }

    if let Some(c) = config.get("backgroundColor").and_then(|v| v.as_str()) {
        opts.background_color = Some(c.to_string());
    }

    opts
}

/// Build a per-session sandbox path for the companion.
/// On Unix it uses /tmp, on other platforms it uses the system temp dir.
fn build_sandbox_path(session_id: &str) -> PathBuf {
    let package_name: &str = env!("CARGO_PKG_NAME");

    #[cfg(unix)]
    let mut base = PathBuf::from("/tmp");
    #[cfg(not(unix))]
    let mut base = std::env::temp_dir();

    base.push(package_name);
    base.push("cache-only");
    base.push(session_id);

    base
}

/// Launch the Desktopr companion as a dedicated Tauri window.
///
/// This replaces the previous sidecar-based approach:
/// - No external binary is spawned.
/// - A new window is created with its own label, URL and appearance.
/// - A per-session sandbox directory is created and passed to the window.
///
/// The `app_config` parameter is a JSON object coming from the frontend that
/// carries appearance options and any other companion-specific config.
///
/// Frontend responsibilities:
/// - Call this command with a config object (title, width, height, etc.).
/// - Listen for the `desktopr:companion:init` event on the companion window:
///   - payload contains: sessionId, sandboxPath, config, windowLabel
/// - Attach a native menu specific to this window using your existing bridge.
/// - Use `sandboxPath` as the logical root for the companion FS.
#[tauri::command]
pub async fn dtr_launch_companion(
    app: AppHandle,
    app_config: serde_json::Value,
) -> Result<(), String> {
    // 1) Generate session id and sandbox path
    let session_id = Uuid::new_v4().to_string();
    let sandbox_path = build_sandbox_path(&session_id);

    log_debug(
        &app,
        &format!(
            "Cache-only session {} will use sandbox path: {:?}",
            session_id, sandbox_path
        ),
    );

    log_debug(&app, &format!("cache-only window raw config: {app_config}"));

    // 2) Create sandbox directory
    if let Err(e) = fs::create_dir_all(&sandbox_path) {
        log_debug(
            &app,
            &format!(
                "[ERROR] Failed to create cache-only sandbox {:?}: {}",
                sandbox_path, e
            ),
        );
        return Err(format!("Failed to create cache-only sandbox: {e}"));
    }
    log_debug(
        &app,
        &format!("Cache-only window sandbox created successfully at {:?}", sandbox_path),
    );

    // 3) Parse appearance options from the config object
    let appearance = parse_appearance_config(&app_config);
    log_debug(
        &app,
        &format!("Cache-only appearance options: {:?}", appearance),
    );

    // 4) Compute a unique window label for this companion instance
    let window_label = format!("{COMPANION_LABEL_PREFIX}{session_id}");
    log_debug(
        &app,
        &format!("Creating cache-only window with label '{}'", window_label),
    );

    // Register sandbox root for this companion window so filesystem operations can be isolated.
    register_companion_sandbox(&app, window_label.clone(), sandbox_path.clone());

    // 5) Choose the URL for the companion window.
    //    Adjust this to match your actual frontend route (e.g. "/companion").
    // Read URL from config; supports both plain string and object with `href`.
    let url_str: String = app_config
        .get("url")
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if let Some(obj) = v.as_object() {
                obj.get("href")
                    .and_then(|h| h.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "/cache-only/blank.html".to_string());

    // Convert to Tauri WebviewUrl
    let companion_url = if url_str.starts_with("http://") || url_str.starts_with("https://") {
        WebviewUrl::External(
            url_str
                .parse()
                .expect("Invalid external URL in cache-only config"),
        )
    } else {
        WebviewUrl::App(url_str.clone().into())
    };

    log_debug(&app, &format!("Cache-only window URL: {}", url_str));

    // 6) Create the companion window with its own appearance
    let mut builder = WebviewWindowBuilder::new(&app, &window_label, companion_url)
        .title(&appearance.title)
        .inner_size(appearance.width, appearance.height)
        .resizable(appearance.resizable);

    if let Some(bg) = &appearance.background_color {
        if let Ok(col) = bg.parse() {
            builder = builder.background_color(col);
        }
    }

    builder = builder.visible(true);

    if appearance.open_fullscreen {
        // NOTE: If your Tauri version does not support .fullscreen(true) on the builder,
        // you can remove this block and control fullscreen from the frontend.
        builder = builder.fullscreen(true);
    }

    let companion_window = builder
        .build()
        .map_err(|e| format!("Failed to create cache-only window: {e}"))?;

    log_debug(
        &app,
        &format!("Cache-only window '{}' created successfully", window_label),
    );

    // Unregister the sandbox when the companion window is destroyed.
    // This keeps the registry clean and avoids leaking stale entries.
    let app_for_event = app.clone();
    let label_for_event = window_label.clone();
    companion_window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            unregister_companion_sandbox(&app_for_event, &label_for_event);
        }
    });

    // 7) Emit an init event to the companion window only.
    //    The frontend can:
    //      - Attach a native menu specific to this window.
    //      - Use sandboxPath as its isolated FS root.
    //      - Use config for any other behavior.
    let payload = serde_json::json!({
        "isCacheOnly": true,
        "sessionId": session_id,
        "sandboxPath": sandbox_path,
        "config": app_config,
        "windowLabel": window_label
    });

    if let Err(e) = companion_window.emit("desktopr:window:cacheonly:init", payload) {
        log_debug(
            &app,
            &format!(
                "[WARN] Failed to emit 'desktopr:window:cacheonly:init' event: {}",
                e
            ),
        );
        // Not fatal: the window exists, frontend may still recover.
    } else {
        log_debug(
            &app,
            "Emitted 'desktopr:window:cacheonly:init' event to companion window.",
        );
    }

    Ok(())
}