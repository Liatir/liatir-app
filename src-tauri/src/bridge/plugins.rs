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

// Reuse the existing file picker helper.
use crate::bridge::files::dtr_file_open_with_bytes;

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

fn validate_wasm_name_and_bytes(name: &str, bytes: &[u8]) -> Result<()> {
    validate_module_name(name)?;

    if bytes.len() < 4 || bytes[..4] != WASM_MAGIC {
        return Err(anyhow!("invalid module: missing WASM magic header (\\0asm)"));
    }

    Ok(())
}

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
    let root = base.join(".desktopr").join(scope);

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
            .with_context(|| format!("cannot create external modules dir {}", dir.display()))?;
    }

    Ok(dir)
}

fn external_modules_storage_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = plugin_scope_root(app, true, None)?.join("_external_modules_storage");

    if !dir.exists() {
        fs::create_dir_all(&dir).with_context(|| {
            format!(
                "cannot create external modules storage dir {}",
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
// Module/storage helpers
// ---------------------------------

fn validate_module_name(module: &str) -> Result<()> {
    let name = module.trim();

    if name.is_empty() {
        return Err(anyhow!("module cannot be empty"));
    }

    if Path::new(name).is_absolute()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(std::path::is_separator)
    {
        return Err(anyhow!("invalid module name"));
    }

    if !name.ends_with(".wasm") {
        return Err(anyhow!("invalid module: expected .wasm extension"));
    }

    Ok(())
}

fn module_path(app: &AppHandle, module: &str) -> Result<PathBuf> {
    validate_module_name(module)?;
    Ok(external_modules_dir(app)?.join(module))
}

fn plugin_storage_dir(app: &AppHandle, module: &str) -> Result<PathBuf> {
    validate_module_name(module)?;

    let dir = external_modules_storage_dir(app)?.join(module);

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .with_context(|| format!("cannot create plugin storage dir {}", dir.display()))?;
    }

    Ok(dir)
}

pub fn dtr_plugin_storage_dir(app: &AppHandle, module: &str) -> Result<PathBuf> {
    plugin_storage_dir(app, module)
}

fn validate_wasm_file(path: &Path) -> Result<()> {
    let bytes = fs::read(path).with_context(|| format!("cannot read module: {}", path.display()))?;

    if bytes.len() < 4 || bytes[..4] != WASM_MAGIC {
        return Err(anyhow!("invalid module: missing WASM magic header (\\0asm)"));
    }

    Ok(())
}

fn read_wasm_module(app: &AppHandle, module: &str) -> Result<Vec<u8>> {
    let path = module_path(app, module)?;
    validate_wasm_file(&path)?;
    fs::read(&path).with_context(|| format!("cannot read module: {}", path.display()))
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
pub fn dtr_plugin_status() -> serde_json::Value {
    serde_json::json!({
        "ready": true,
        "runtime": "native-wasi"
    })
}

#[tauri::command]
pub fn dtr_plugin_paths(app: AppHandle, module: String) -> Result<serde_json::Value, String> {
    let modules = external_modules_dir(&app).map_err(|e| e.to_string())?;
    let storage = plugin_storage_dir(&app, &module).map_err(|e| e.to_string())?;
    let sandbox = plugin_sandbox_dir(&app).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "externalModules": modules.to_string_lossy(),
        "storage": storage.to_string_lossy(),
        "sandbox": sandbox.to_string_lossy()
    }))
}

#[tauri::command]
pub fn dtr_plugin_storage_clear(app: AppHandle, module: String) -> Result<bool, String> {
    let storage = plugin_storage_dir(&app, &module).map_err(|e| e.to_string())?;

    if storage.exists() {
        fs::remove_dir_all(&storage).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&storage).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn dtr_plugin_clear_all_jobs(app: AppHandle) -> Result<bool, String> {
    let sandbox = plugin_sandbox_dir(&app).map_err(|e| e.to_string())?;

    if sandbox.exists() {
        fs::remove_dir_all(&sandbox).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&sandbox).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn dtr_plugin_call(
    app: AppHandle,
    module: String,
    payload: serde_json::Value,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let started = Instant::now();
    let id = gen_plugin_job_id();
    let timeout_ms = timeout_ms.unwrap_or(2_000);

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_plugin_job(app, id, module, payload, timeout_ms, started)
    })
    .await
    .map_err(|e| format!("plugin task join error: {e}"))?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_plugin_add_module(
    app: AppHandle,
    name: String,
    contents: Vec<u8>,
) -> Result<bool, String> {
    // Default size limit: 20 MB.
    let max_size: usize = 20 * 1024 * 1024;

    if contents.len() > max_size {
        return Err(format!(
            "module too large ({} bytes > {} bytes)",
            contents.len(),
            max_size
        ));
    }

    let base = external_modules_dir(&app).map_err(|e| e.to_string())?;

    if name.contains(std::path::is_separator) {
        return Err("Invalid module name".into());
    }

    if let Err(e) = validate_wasm_name_and_bytes(&name, &contents) {
        return Err(e.to_string());
    }

    let target = base.join(&name);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, &contents).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub async fn dtr_plugin_pick_and_add_module(
    app: AppHandle,
    default_name: Option<String>,
    max_bytes: Option<u64>,
) -> Result<serde_json::Value, String> {
    let allowed = Some(vec!["wasm".to_string()]);
    let picked = dtr_file_open_with_bytes(app.clone(), false, allowed, max_bytes).await?;

    let file = match picked.files.into_iter().next() {
        Some(f) => f,
        None => return Err("no file selected".into()),
    };

    let name = match default_name {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            Path::new(&file.path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "cannot derive file name".to_string())?
        }
    };

    let base = external_modules_dir(&app).map_err(|e| e.to_string())?;

    if name.contains(std::path::is_separator) {
        return Err("Invalid module name".into());
    }

    if let Err(e) = validate_wasm_name_and_bytes(&name, &file.bytes) {
        return Err(e.to_string());
    }

    let target = base.join(&name);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, &file.bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "saved": true,
        "name": name,
        "path": target.to_string_lossy(),
        "bytes": file.bytes.len(),
    }))
}

#[tauri::command]
pub fn dtr_plugin_remove_module(app: AppHandle, name: String) -> Result<bool, String> {
    let base = external_modules_dir(&app).map_err(|e| e.to_string())?;

    if name.contains(std::path::is_separator) {
        return Err("Invalid module name".into());
    }

    let target = base.join(&name);

    if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }

    Ok(true)
}

#[tauri::command]
pub fn dtr_plugin_list_modules(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = external_modules_dir(&app).map_err(|e| e.to_string())?;
    let mut out = vec![];

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;

        if e.path().is_file()
            && e.path()
                .extension()
                .map(|x| x == "wasm")
                .unwrap_or(false)
        {
            out.push(e.file_name().to_string_lossy().to_string());
        }
    }

    Ok(out)
}

// ---------------------------------
// Runtime
// ---------------------------------

fn run_plugin_job(
    app: AppHandle,
    id: String,
    module_name: String,
    payload: serde_json::Value,
    timeout_ms: u64,
    started: Instant,
) -> Result<serde_json::Value> {
    let job_dir = plugin_job_dir(&app, &id)?;
    let storage_dir = plugin_storage_dir(&app, &module_name)?;

    let run_result = run_plugin_job_inner(
        &app,
        &id,
        &module_name,
        payload,
        timeout_ms,
        &job_dir,
        &storage_dir,
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
        eprintln!("[dtr-plugin] sandbox cleanup failed: {cleanup_err}");
    }

    Ok(response)
}

fn run_plugin_job_inner(
    app: &AppHandle,
    id: &str,
    module_name: &str,
    payload: serde_json::Value,
    timeout_ms: u64,
    job_dir: &Path,
    storage_dir: &Path,
) -> Result<PluginResponse> {
    let wasm_bytes = read_wasm_module(app, module_name)?;
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
        .arg("module.wasm")
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
        .map_err(|e| anyhow!("module does not export _start: {e}"))?;

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