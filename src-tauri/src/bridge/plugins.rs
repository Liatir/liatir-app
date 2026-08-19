use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
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
    // When present, expose this in-process WASM call through Jobs using the
    // caller-allocated ID and ownership metadata.
    job_id: Option<String>,
    workspace_id: Option<String>,
    job_label: Option<String>,
    job_kind: Option<String>,
    metadata: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let started = Instant::now();
    let timeout_ms = timeout_ms.unwrap_or(300_000);
    let plugin = plugin
        .or(module)
        .ok_or_else(|| "plugin required".to_string())?;

    let raw_host_read_paths = host_read_paths.unwrap_or_default();
    let validated_paths = validate_host_read_paths(raw_host_read_paths.clone())
        .map_err(|e| e.to_string())?;
    // The payload names the files the plugin will open, so it has to speak in sandbox paths.
    let mut payload = payload;
    rewrite_host_paths(&mut payload, &raw_host_read_paths);

    let tracked_job = if let Some(job_id) = job_id {
        let (id, cancelled) = super::jobs::create_in_process_job_with_id(
            &app,
            job_id,
            format!("wasm:{plugin}"),
            Vec::new(),
            workspace_id,
            job_label,
            Some(job_kind.unwrap_or_else(|| "native-tool".to_string())),
            metadata,
        )?;
        let _ = super::plugin_progress::lia_plugin_progress(
            app.clone(),
            id.clone(),
            Some(0),
            Some(1),
            Some("Running".to_string()),
            None,
            Some(false),
        );
        Some((id, cancelled))
    } else {
        None
    };
    let id = tracked_job
        .as_ref()
        .map(|(id, _)| id.clone())
        .unwrap_or_else(gen_plugin_job_id);
    let cancelled = tracked_job.as_ref().map(|(_, flag)| flag.clone());
    let app_for_run = app.clone();
    let run_id = id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_plugin_job(
            app_for_run,
            run_id,
            plugin,
            None,
            payload,
            timeout_ms,
            started,
            validated_paths,
            cancelled,
        )
    })
    .await;

    let response = match result {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(error) => Err(format!("plugin task join error: {error}")),
    };

    if tracked_job.is_some() {
        let ok = response
            .as_ref()
            .ok()
            .and_then(|value| value.get("ok"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if let Ok(value) = response.as_ref() {
            for (field, stream) in [("stdout", "stdout"), ("stderr", "stderr")] {
                if let Some(output) = value.get(field).and_then(serde_json::Value::as_str) {
                    for line in output.lines().filter(|line| !line.is_empty()) {
                        super::jobs::append_in_process_output(&app, &id, stream, line.to_string());
                    }
                }
            }
        }
        let _ = super::plugin_progress::lia_plugin_progress(
            app.clone(),
            id.clone(),
            Some(if ok { 1 } else { 0 }),
            Some(1),
            Some(if ok { "Completed" } else { "Failed" }.to_string()),
            None,
            Some(true),
        );
        super::jobs::finish_in_process_job(&app, &id, ok);
    }

    response
}

/// Mount point of one exposed host directory inside the WASI sandbox.
///
/// WASI paths are POSIX. A Windows path is not one: it starts with a drive letter instead of `/`,
/// and `canonicalize` turns it into a verbatim `\?\C:\...` path on top of that, so a preopen
/// named after it can never match the path a plugin actually opens. That is why FastQC failed on
/// Windows with `Operation not permitted` while working everywhere else.
///
/// A host whose paths are already absolute POSIX keeps its real path, so a plugin still opens the
/// file by the exact path it was handed and nothing about the existing behaviour changes there.
/// Everything else gets a synthetic POSIX mount, and the caller rewrites its file inputs to match
/// through this same function — which is why it is deterministic in the directory's list position.
pub fn wasm_guest_mount(host_dir: &str, index: usize) -> String {
    if host_dir.starts_with('/') && !host_dir.contains('\\') {
        return host_dir.to_string();
    }
    format!("/liatir-host-{index}")
}

/// Rewrites one host file path to its sandbox equivalent under `guest`.
///
/// Returns `None` when the value does not live in that directory, so the caller can try the next
/// mount. Comparison is case-insensitive because the hosts that need a synthetic mount are the
/// ones with case-insensitive filesystems.
pub fn wasm_guest_path(value: &str, host_dir: &str, guest: &str) -> Option<String> {
    if guest == host_dir {
        return Some(value.to_string());
    }
    let normalized = value.replace('\\', "/");
    let normalized_dir = host_dir.replace('\\', "/");
    let remainder = normalized
        .get(..normalized_dir.len())
        .filter(|prefix| prefix.eq_ignore_ascii_case(&normalized_dir))
        .map(|_| &normalized[normalized_dir.len()..])?;
    let remainder = remainder.strip_prefix('/').unwrap_or(remainder);
    if remainder.is_empty() {
        return Some(guest.to_string());
    }
    Some(format!("{guest}/{remainder}"))
}

/// Rewrites every string in `value` that points inside one of the exposed host directories.
///
/// The plugin receives paths in its own payload — `lia_plugin_call` carries them inside
/// `payload.args`, a bundle run carries them in its inputs — and it opens them verbatim. Those
/// paths therefore have to name the mount the sandbox actually exposes. On a POSIX host each mount
/// is the real directory, so this walk rewrites nothing and behaviour is unchanged.
pub fn rewrite_host_paths(value: &mut serde_json::Value, host_dirs: &[String]) {
    if host_dirs.is_empty() {
        return;
    }
    match value {
        serde_json::Value::String(text) => {
            for (index, dir) in host_dirs.iter().enumerate() {
                let guest = wasm_guest_mount(dir, index);
                if guest == *dir {
                    continue;
                }
                if let Some(mapped) = wasm_guest_path(text, dir, &guest) {
                    *text = mapped;
                    return;
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                rewrite_host_paths(item, host_dirs);
            }
        }
        serde_json::Value::Object(entries) => {
            for (_, item) in entries.iter_mut() {
                rewrite_host_paths(item, host_dirs);
            }
        }
        _ => {}
    }
}

fn validate_host_read_paths(raw: Vec<String>) -> Result<Vec<(PathBuf, String)>> {
    // Paths that must never be exposed to a WASM plugin.
    let blocked_prefixes: &[&str] = &[
        "/etc", "/proc", "/sys", "/dev",
        "/System", "/Library", "/private/etc",
        "C:\\Windows", "C:\\Program Files",
    ];

    let mut out = Vec::with_capacity(raw.len());

    for (index, s) in raw.into_iter().enumerate() {
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

        out.push((canonical, wasm_guest_mount(&s, index)));
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
    host_read_paths: Vec<(PathBuf, String)>,
    cancelled: Option<Arc<AtomicBool>>,
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
        cancelled,
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
    cancelled: Arc<AtomicBool>,
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
        Some(cancelled),
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
    host_read_paths: &[(PathBuf, String)],
    cancelled: Option<Arc<AtomicBool>>,
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
    for (host_dir, guest) in host_read_paths {
        wasi_builder.preopened_dir(
            host_dir,
            guest,
            DirPerms::READ,
            FilePerms::READ,
        )?;
    }

    let wasi = wasi_builder.build_p1();

    let mut store = Store::new(&engine, wasi);

    // The first epoch increment after this point interrupts execution.
    store.set_epoch_deadline(1);

    let engine_for_timeout = engine.clone();

    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            if cancelled
                .as_ref()
                .map(|flag| flag.load(Ordering::SeqCst))
                .unwrap_or(false)
                || started.elapsed() >= std::time::Duration::from_millis(timeout_ms)
            {
                engine_for_timeout.increment_epoch();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
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

#[cfg(test)]
mod tests {
    use super::{wasm_guest_mount, wasm_guest_path};

    /// A POSIX host must keep the exact path the plugin was handed, or this becomes a behaviour
    /// change on macOS and Linux rather than a Windows fix.
    #[test]
    fn posix_host_directories_mount_at_their_own_path() {
        let dir = "/home/lorenzo/data";
        let guest = wasm_guest_mount(dir, 0);
        assert_eq!(guest, dir);
        assert_eq!(
            wasm_guest_path("/home/lorenzo/data/sample.fastq", dir, &guest).as_deref(),
            Some("/home/lorenzo/data/sample.fastq"),
        );
    }

    /// A drive-letter path is not a WASI path: wasi-libc reads it as relative, so the preopen could
    /// never match the file the plugin opens. FastQC failed on Windows for exactly this.
    #[test]
    fn windows_host_directories_mount_at_a_synthetic_posix_path() {
        let dir = "C:\\lt-8380\\wasm";
        let guest = wasm_guest_mount(dir, 0);
        assert_eq!(guest, "/liatir-host-0");
        assert_eq!(
            wasm_guest_path("C:\\lt-8380\\wasm\\sample.fastq", dir, &guest).as_deref(),
            Some("/liatir-host-0/sample.fastq"),
        );
    }

    #[test]
    fn each_directory_keeps_its_own_mount_and_ignores_unrelated_paths() {
        assert_eq!(wasm_guest_mount("C:\\a", 1), "/liatir-host-1");
        assert_eq!(wasm_guest_path("C:\\other\\x.fastq", "C:\\a", "/liatir-host-1"), None);
        // Windows filesystems are case-insensitive, so the mount has to be too.
        assert_eq!(
            wasm_guest_path("c:\\A\\x.fastq", "C:\\a", "/liatir-host-1").as_deref(),
            Some("/liatir-host-1/x.fastq"),
        );
    }
}
