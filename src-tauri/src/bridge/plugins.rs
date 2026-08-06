use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Manager};
use wasmtime::{Config, Engine, Linker, Module, Store};
use wasmtime_wasi::{
    p1::{self, WasiP1Ctx},
    p2::pipe::{MemoryInputPipe, MemoryOutputPipe},
    DirPerms, FilePerms, WasiCtxBuilder,
};

static PLUGIN_REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

const WASM_MAGIC: [u8; 4] = [0x00, 0x61, 0x73, 0x6D];

// Default stdout/stderr capture limit.
// Keep this conservative because plugin output should be JSON metadata,
// not huge binary/file payloads.
const DEFAULT_STDIO_LIMIT_BYTES: usize = 1024 * 1024;

// ---------------------------------
// Response types
// ---------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginResponse {
    pub id: String,
    pub ok: bool,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub value: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

// ---------------------------------
// IDs
// ---------------------------------

fn gen_plugin_job_id() -> String {
    let n = PLUGIN_REQ_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("plugin_req{:x}", n)
}

// ---------------------------------
// Scope / root helpers
// ---------------------------------

fn plugin_scope_dir_name(window_label: Option<&str>) -> Result<String> {
    match window_label {
        None => Ok(".main".to_string()),
        Some(raw) => {
            let label = raw.trim();

            if label.is_empty() {
                return Err(anyhow!("window_label cannot be empty"));
            }

            if label == "main" {
                return Err(anyhow!("window_label 'main' is reserved"));
            }

            if !label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err(anyhow!("window_label contains invalid characters"));
            }

            Ok(format!(".{}", label))
        }
    }
}

fn plugin_scope_root(
    app: &AppHandle,
    permanent: bool,
    window_label: Option<&str>,
) -> Result<PathBuf> {
    let base = if permanent {
        app.path()
            .app_data_dir()
            .map_err(|_| anyhow!("app_data_dir not available"))?
    } else {
        app.path()
            .app_cache_dir()
            .map_err(|_| anyhow!("app_cache_dir not available"))?
    };

    let scope = plugin_scope_dir_name(window_label)?;
    let root = base.join(".liatir").join(scope);

    if !root.exists() {
        fs::create_dir_all(&root)
            .with_context(|| format!("cannot create scope root {}", root.display()))?;
    }

    Ok(root)
}

fn external_modules_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = plugin_scope_root(app, true, None)?.join("_external_modules");

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create external plugins dir {}", dir.display()))?;
    }

    Ok(dir)
}

fn builtin_modules_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = plugin_scope_root(app, true, None)?.join("_builtin_modules");

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create builtin plugins dir {}", dir.display()))?;
    }

    Ok(dir)
}

fn external_modules_storage_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = plugin_scope_root(app, true, None)?.join("_external_modules_storage");

    if !dir.exists() {
        fs::create_dir_all(&dir).with_context(|| {
            format!(
                "cannot create external plugins storage dir {}",
                dir.display()
            )
        })?;
    }

    Ok(dir)
}

fn plugin_sandbox_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = plugin_scope_root(app, false, None)?.join("_sandbox");

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create plugin sandbox dir {}", dir.display()))?;
    }

    Ok(dir)
}

fn plugin_job_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf> {
    let dir = plugin_sandbox_dir(app)?.join(job_id);

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create plugin job dir {}", dir.display()))?;
    }

    Ok(dir)
}

// ---------------------------------
// Plugin/storage helpers
// ---------------------------------

fn validate_plugin_wasm_name(plugin: &str) -> Result<()> {
    let name = plugin.trim();

    if name.is_empty() {
        return Err(anyhow!("plugin cannot be empty"));
    }

    if Path::new(name).is_absolute()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(std::path::is_separator)
    {
        return Err(anyhow!("invalid plugin name"));
    }

    if !name.ends_with(".wasm") {
        return Err(anyhow!("invalid plugin: expected .wasm extension"));
    }

    Ok(())
}

fn plugin_wasm_path(app: &AppHandle, plugin: &str) -> Result<PathBuf> {
    validate_plugin_wasm_name(plugin)?;
    let user = external_modules_dir(app)?.join(plugin);
    if user.exists() {
        return Ok(user);
    }
    let builtin = builtin_modules_dir(app)?.join(plugin);
    if builtin.exists() {
        return Ok(builtin);
    }
    Ok(user)
}

fn plugin_storage_dir(app: &AppHandle, plugin: &str) -> Result<PathBuf> {
    validate_plugin_wasm_name(plugin)?;

    let dir = external_modules_storage_dir(app)?.join(plugin);

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create plugin storage dir {}", dir.display()))?;
    }

    Ok(dir)
}

pub fn lia_plugin_storage_dir(app: &AppHandle, plugin: &str) -> Result<PathBuf> {
    plugin_storage_dir(app, plugin)
}

fn validate_wasm_file(path: &Path) -> Result<()> {
    let bytes = fs::read(path).with_context(|| format!("cannot read plugin: {}", path.display()))?;

    if bytes.len() < 4 || bytes[..4] != WASM_MAGIC {
        return Err(anyhow!("invalid plugin: missing WASM magic header (\\0asm)"));
    }

    Ok(())
}

fn read_wasm_plugin(app: &AppHandle, plugin: &str) -> Result<Vec<u8>> {
    let path = plugin_wasm_path(app, plugin)?;
    validate_wasm_file(&path)?;
    fs::read(&path).with_context(|| format!("cannot read plugin: {}", path.display()))
}

fn safe_remove_dir_all(path: &Path) -> Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)
            .with_context(|| format!("cannot remove directory {}", path.display()))?;
    }

    Ok(())
}

fn try_parse_json(stdout: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(stdout.trim()).ok()
}

fn bytes_to_trimmed_string(bytes: impl AsRef<[u8]>) -> String {
    String::from_utf8_lossy(bytes.as_ref()).trim().to_string()
}

fn bytes_to_string(bytes: impl AsRef<[u8]>) -> String {
    String::from_utf8_lossy(bytes.as_ref()).to_string()
}

// ---------------------------------
// Public Tauri commands
// ---------------------------------

#[tauri::command]
pub fn lia_plugin_paths(
    app: AppHandle,
    plugin: Option<String>,
    module: Option<String>,
) -> Result<serde_json::Value, String> {
    let plugin = plugin
        .or(module)
        .ok_or_else(|| "plugin required".to_string())?;
    let plugins = external_modules_dir(&app).map_err(|e| e.to_string())?;
    let storage = plugin_storage_dir(&app, &plugin).map_err(|e| e.to_string())?;
    let sandbox = plugin_sandbox_dir(&app).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "externalPlugins": plugins.to_string_lossy(),
        "storage": storage.to_string_lossy(),
        "sandbox": sandbox.to_string_lossy()
    }))
}

#[tauri::command]
pub fn lia_fastqc_sample_path(app: AppHandle) -> Result<String, String> {
    static BYTES: &[u8] = include_bytes!("../../../test-files/fastqc/sample.fastq");
    let storage = plugin_storage_dir(&app, "fastqc.wasm").map_err(|e| e.to_string())?;
    let dest = storage.join("sample.fastq");
    if !dest.exists() {
        fs::write(&dest, BYTES).map_err(|e| e.to_string())?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn lia_plugin_storage_clear(
    app: AppHandle,
    plugin: Option<String>,
    module: Option<String>,
) -> Result<bool, String> {
    let plugin = plugin
        .or(module)
        .ok_or_else(|| "plugin required".to_string())?;
    let storage = plugin_storage_dir(&app, &plugin).map_err(|e| e.to_string())?;

    if storage.exists() {
        fs::remove_dir_all(&storage).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&storage).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn lia_plugin_call(
    app: AppHandle,
    plugin: Option<String>,
    module: Option<String>,
    payload: serde_json::Value,
    timeout_ms: Option<u64>,
    // Optional list of host directories to expose as read-only inside the
    // WASM sandbox. Required for tools that read large files from the
    // filesystem (e.g. FASTQ, BAM) that cannot be passed through stdin.
    // Each entry must be an absolute path to an existing directory.
    host_read_paths: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let started = Instant::now();
    let id = gen_plugin_job_id();
    let timeout_ms = timeout_ms.unwrap_or(300_000);
    let plugin = plugin
        .or(module)
        .ok_or_else(|| "plugin required".to_string())?;

    let validated_paths = validate_host_read_paths(host_read_paths.unwrap_or_default())
        .map_err(|e| e.to_string())?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_plugin_job(app, id, plugin, None, payload, timeout_ms, started, validated_paths)
    })
    .await
    .map_err(|e| format!("plugin task join error: {e}"))?;

    result.map_err(|e| e.to_string())
}

fn validate_host_read_paths(raw: Vec<String>) -> Result<Vec<PathBuf>> {
    // Paths that must never be exposed to a WASM plugin.
    let blocked_prefixes: &[&str] = &[
        "/etc", "/proc", "/sys", "/dev",
        "/System", "/Library", "/private/etc",
        "C:\\Windows", "C:\\Program Files",
    ];

    let mut out = Vec::with_capacity(raw.len());

    for s in raw {
        let p = PathBuf::from(&s);

        if !p.is_absolute() {
            return Err(anyhow!("host_read_path must be absolute: {s}"));
        }

        if !p.is_dir() {
            return Err(anyhow!("host_read_path is not a directory: {s}"));
        }

        let canonical = p.canonicalize()
            .with_context(|| format!("cannot canonicalize path: {s}"))?;

        for blocked in blocked_prefixes {
            if canonical.starts_with(blocked) {
                return Err(anyhow!("host_read_path is blocked: {s}"));
            }
        }

        out.push(canonical);
    }

    Ok(out)
}

// ---------------------------------
// Built-in plugin installer
// ---------------------------------

/// Copy WASM plugins bundled in resources/wasm/ into the builtin plugins dir.
/// Called once on startup so first-party plugins (fastqc, …) are always available.
/// Also migrates stale copies from _external_modules to keep the user-visible
/// plugin list clean.
pub(crate) fn ensure_builtin_modules(app: &AppHandle) {
    static FASTQC_WASM: &[u8] = include_bytes!("../../resources/wasm/fastqc.wasm");

    let builtin_dir = match builtin_modules_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[plugins] builtin_modules_dir error: {e}");
            return;
        }
    };

    let dest = builtin_dir.join("fastqc.wasm");
    match fs::write(&dest, FASTQC_WASM) {
        Ok(_) => {}
        Err(e) => eprintln!("[plugins] failed to install fastqc.wasm: {e}"),
    }

    // Migration: remove any copy that ended up in _external_modules (legacy location).
    if let Ok(ext_dir) = external_modules_dir(app) {
        let stale = ext_dir.join("fastqc.wasm");
        if stale.exists() {
            if let Err(e) = fs::remove_file(&stale) {
                eprintln!("[plugins] failed to remove stale fastqc.wasm from external plugins: {e}");
            } else {
                eprintln!("[plugins] migrated: removed stale fastqc.wasm from external plugins");
            }
        }
    }
}

// ---------------------------------
// Runtime
// ---------------------------------

fn run_plugin_job(
    app: AppHandle,
    id: String,
    plugin_name: String,
    // See run_plugin_job_inner: Some = run these bytes, None = load by name.
    wasm_bytes_override: Option<Vec<u8>>,
    payload: serde_json::Value,
    timeout_ms: u64,
    started: Instant,
    host_read_paths: Vec<PathBuf>,
) -> Result<serde_json::Value> {
    let job_dir = plugin_job_dir(&app, &id)?;
    let storage_dir = plugin_storage_dir(&app, &plugin_name)?;

    let run_result = run_plugin_job_inner(
        &app,
        &id,
        &plugin_name,
        wasm_bytes_override,
        payload,
        timeout_ms,
        &job_dir,
        &storage_dir,
        &host_read_paths,
    );

    let duration_ms = started.elapsed().as_millis() as u64;

    // The job sandbox is temporary and must not leave noise behind.
    let cleanup_result = safe_remove_dir_all(&job_dir);

    let response = match run_result {
        Ok(mut response) => {
            response.duration_ms = duration_ms;
            serde_json::to_value(response)?
        }
        Err(err) => serde_json::to_value(PluginResponse {
            id,
            ok: false,
            stdout: None,
            stderr: None,
            value: None,
            error: Some(err.to_string()),
            duration_ms,
        })?,
    };

    if let Err(cleanup_err) = cleanup_result {
        eprintln!("[lia-plugin] sandbox cleanup failed: {cleanup_err}");
    }

    Ok(response)
}

/// Execute wasm bytes extracted from a .lia bundle (manifest runtime "wasm")
/// and return the parsed JSON result. Mirrors lia_plugin_call but for a plugin
/// that lives inside the bundle rather than being separately installed —
/// reuses the SAME sandboxed executor (run_plugin_job).
pub fn run_wasm_bundle(
    app: AppHandle,
    storage_name: String,
    wasm_bytes: Vec<u8>,
    payload: serde_json::Value,
    timeout_ms: Option<u64>,
    host_read_paths: Vec<String>,
) -> Result<serde_json::Value> {
    let id = gen_plugin_job_id();
    let timeout_ms = timeout_ms.unwrap_or(300_000);
    // Same path validation lia_plugin_call applies (blocks /etc, /sys, …).
    let validated_paths = validate_host_read_paths(host_read_paths)?;
    run_plugin_job(
        app,
        id,
        storage_name,
        Some(wasm_bytes),
        payload,
        timeout_ms,
        Instant::now(),
        validated_paths,
    )
}

fn run_plugin_job_inner(
    app: &AppHandle,
    id: &str,
    plugin_name: &str,
    // When Some, run these bytes directly (e.g. a wasm payload extracted from a
    // .lia bundle with runtime "wasm"); when None, load the installed plugin by
    // name. Keeps a single sandboxed executor for both sources.
    wasm_bytes_override: Option<Vec<u8>>,
    payload: serde_json::Value,
    timeout_ms: u64,
    job_dir: &Path,
    storage_dir: &Path,
    host_read_paths: &[PathBuf],
) -> Result<PluginResponse> {
    let wasm_bytes = match wasm_bytes_override {
        Some(bytes) => bytes,
        None => read_wasm_plugin(app, plugin_name)?,
    };
    let stdin_text = serde_json::to_string(&payload)? + "\n";

    let mut config = Config::new();

    // This allows Store::set_epoch_deadline to interrupt runaway execution.
    config.epoch_interruption(true);

    let engine = Engine::new(&config)?;
    let module = Module::from_binary(&engine, &wasm_bytes)?;

    let stdin = MemoryInputPipe::new(stdin_text.into_bytes());
    let stdout = MemoryOutputPipe::new(DEFAULT_STDIO_LIMIT_BYTES);
    let stderr = MemoryOutputPipe::new(DEFAULT_STDIO_LIMIT_BYTES);

    let mut wasi_builder = WasiCtxBuilder::new();

    wasi_builder
        .arg("plugin.wasm")
        .stdin(stdin)
        .stdout(stdout.clone())
        .stderr(stderr.clone())
        .allow_tcp(false)
        .allow_udp(false)
        .allow_ip_name_lookup(false);

    // The job sandbox is the plugin working directory.
    // Relative paths are temporary and are cleaned after the run.
    wasi_builder.preopened_dir(
        job_dir,
        ".",
        DirPerms::all(),
        FilePerms::all(),
    )?;

    // Persistent plugin storage is available explicitly under /storage.
    wasi_builder.preopened_dir(
        storage_dir,
        "/storage",
        DirPerms::all(),
        FilePerms::all(),
    )?;

    // Read-only host directories requested by the caller (e.g. the directory
    // containing a FASTQ or BAM file). Mapped to the same absolute path inside
    // the sandbox so the plugin can open files by their original path.
    for host_dir in host_read_paths {
        if let Some(guest) = host_dir.to_str() {
            wasi_builder.preopened_dir(
                host_dir,
                guest,
                DirPerms::READ,
                FilePerms::READ,
            )?;
        }
    }

    let wasi = wasi_builder.build_p1();

    let mut store = Store::new(&engine, wasi);

    // The first epoch increment after this point interrupts execution.
    store.set_epoch_deadline(1);

    let engine_for_timeout = engine.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(timeout_ms));
        engine_for_timeout.increment_epoch();
    });

    let mut linker = Linker::<WasiP1Ctx>::new(&engine);
    p1::add_to_linker_sync(&mut linker, |ctx| ctx)?;

    let instance = linker.instantiate(&mut store, &module)?;

    let start = instance
        .get_typed_func::<(), ()>(&mut store, "_start")
        .map_err(|e| anyhow!("plugin does not export _start: {e}"))?;

    let call_result = start.call(&mut store, ());

    let stdout_text = bytes_to_trimmed_string(stdout.contents());
    let stderr_text = bytes_to_string(stderr.contents());

    if let Err(err) = call_result {
        return Ok(PluginResponse {
            id: id.to_string(),
            ok: false,
            stdout: Some(stdout_text),
            stderr: Some(stderr_text),
            value: None,
            error: Some(err.to_string()),
            duration_ms: 0,
        });
    }

    let value = try_parse_json(&stdout_text);

    Ok(PluginResponse {
        id: id.to_string(),
        ok: true,
        stdout: Some(stdout_text),
        stderr: Some(stderr_text),
        value,
        error: None,
        duration_ms: 0,
    })
}
