use std::{
    collections::HashMap,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::python_env::{
    env_dir, prepare_env, spawn_in_env, status_env, PythonEnvLock, PythonEnvPackage,
    PythonEnvStatus, PythonRequirement,
};

const SIG: &str = "LIATIR/1";
const PYTHON_PLUGIN_ENV_ROOT: &str = "plugin-runtimes";
pub(crate) const PYTHON_PLUGIN_DEV_ENV_ROOT: &str = "plugin-dev-runtimes";

const RUNNER: &str = r#"import * as _mod from './index.js';
// definePlugin(...) returns an object with .run; legacy shapes are accepted for older bundles.
const _m = _mod.default ?? _mod;
const _run = typeof _m === 'function' ? _m : (_m && (_m.run ?? _mod.run));
if (typeof _run !== 'function') {
  process.stderr.write('[liatir] plugin must `export default definePlugin(...)`\n');
  process.exit(1);
}
const _inputs = JSON.parse(process.argv[2] ?? '{}');
try {
  const _result = await _run(_inputs);
  if (_result !== undefined && _result !== null) {
    process.stdout.write('__LIATIR_RESULT__' + JSON.stringify(_result) + '\n');
  }
} catch (err) {
  process.stderr.write('[liatir] ' + (err?.message ?? String(err)) + '\n');
  process.exit(1);
}
"#;

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PythonPluginSpec {
    entry: Option<String>,
    packages: Option<Vec<PythonEnvPackage>>,
    requirements: Option<Vec<String>>,
    python_requirement: Option<PythonRequirement>,
}

#[derive(Debug, Clone)]
struct PythonPluginRuntimeContext {
    manifest: Value,
    spec: PythonPluginSpec,
    entry: String,
    env_id: String,
}

fn open_validated(path: &str) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "Not a valid .lia plugin (not a zip)".to_string())?;

    // Validate signature
    let mut sig_entry = zip.by_name("_sig")
        .map_err(|_| "Not a valid .lia plugin (missing signature)".to_string())?;
    let mut sig = String::new();
    sig_entry.read_to_string(&mut sig).map_err(|e| e.to_string())?;
    if sig.trim() != SIG {
        return Err("Not a valid .lia plugin (wrong signature)".to_string());
    }
    drop(sig_entry);

    Ok(zip)
}

fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.trim().is_empty() || path.is_absolute() {
        return Err(format!("unsafe plugin payload path: {value}"));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("unsafe plugin payload path: {value}")),
        }
    }
    Ok(path.to_path_buf())
}

fn sanitize_env_part(value: &str, max_len: usize) -> String {
    let mut clean = value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    while clean.contains("--") {
        clean = clean.replace("--", "-");
    }
    clean = clean.trim_matches('-').to_string();
    if clean.is_empty() {
        clean = "plugin".to_string();
    }
    clean.chars().take(max_len).collect()
}

fn stable_hash_hex(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn python_plugin_env_id(manifest: &Value, bundle_hash: &str) -> String {
    let name = manifest
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("plugin");
    let version = manifest
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or("0");
    format!(
        "plugin-{}-{}-{}",
        sanitize_env_part(name, 28),
        sanitize_env_part(version, 16),
        &bundle_hash[..12.min(bundle_hash.len())]
    )
}

fn parse_python_spec(manifest: &Value) -> Result<PythonPluginSpec, String> {
    let mut spec = match manifest.get("python") {
        Some(value) => serde_json::from_value::<PythonPluginSpec>(value.clone())
            .map_err(|e| format!("Invalid python runtime spec in manifest: {e}"))?,
        None => PythonPluginSpec::default(),
    };

    if spec.entry.is_none() {
        spec.entry = Some("python/main.py".to_string());
    }
    Ok(spec)
}

fn read_manifest(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<Value, String> {
    let mut entry = zip
        .by_name("manifest.json")
        .map_err(|_| "manifest.json not found in bundle".to_string())?;
    let mut buf = String::new();
    entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_str(&buf).map_err(|e| format!("Invalid manifest JSON: {e}"))
}

pub(crate) fn read_manifest_from_bundle(path: &str) -> Result<Value, String> {
    let mut zip = open_validated(path)?;
    read_manifest(&mut zip)
}

pub(crate) fn python_env_id_for_bundle(path: &str, manifest: &Value) -> Result<String, String> {
    let bundle_hash = stable_hash_hex(&std::fs::read(path).map_err(|e| e.to_string())?);
    Ok(python_plugin_env_id(manifest, &bundle_hash))
}

fn python_runtime_context(path: &str, manifest: Value) -> Result<PythonPluginRuntimeContext, String> {
    let runtime = manifest
        .get("runtime")
        .and_then(|r| r.as_str())
        .unwrap_or("node");
    if runtime != "python" {
        return Err("This .lia plugin does not declare the Python runtime.".to_string());
    }

    let spec = parse_python_spec(&manifest)?;
    let entry = spec
        .entry
        .clone()
        .unwrap_or_else(|| "python/main.py".to_string());
    validate_relative_path(&entry)?;
    let bundle_hash = stable_hash_hex(&std::fs::read(path).map_err(|e| e.to_string())?);
    let env_id = python_plugin_env_id(&manifest, &bundle_hash);

    Ok(PythonPluginRuntimeContext {
        manifest,
        spec,
        entry,
        env_id,
    })
}

fn status_python_plugin_env(
    app: AppHandle,
    env_id: String,
    spec: &PythonPluginSpec,
) -> Result<PythonEnvStatus, String> {
    status_env(
        app,
        PYTHON_PLUGIN_ENV_ROOT.to_string(),
        env_id,
        spec.packages.clone().unwrap_or_default(),
        Vec::new(),
    )
}

fn prepare_python_plugin_env(
    app: AppHandle,
    env_id: String,
    spec: &PythonPluginSpec,
) -> Result<super::python_env::PythonEnvPrepareResult, String> {
    prepare_env(
        app,
        PYTHON_PLUGIN_ENV_ROOT.to_string(),
        env_id,
        spec.requirements.clone(),
        spec.packages.clone(),
        None,
        spec.python_requirement.clone(),
    )
}

fn extract_python_payload(
    zip: &mut zip::ZipArchive<std::fs::File>,
    target_root: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(target_root).map_err(|e| e.to_string())?;
    let mut extracted = 0usize;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !name.starts_with("python/") || name.ends_with('/') {
            continue;
        }
        let relative = validate_relative_path(&name)?;
        let target = target_root.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(target, buf).map_err(|e| e.to_string())?;
        extracted += 1;
    }

    if extracted == 0 {
        return Err("Python .lia bundle has no python/ payload files".to_string());
    }
    Ok(())
}

fn python_plugin_runner(plugin_root: &Path, entry: &str) -> String {
    format!(
        r#"
import asyncio
import importlib.util
import inspect
import json
import pathlib
import sys
import traceback

plugin_root = pathlib.Path({plugin_root:?})
entry_path = plugin_root / {entry:?}

try:
    payload = json.load(sys.stdin)
    sys.path.insert(0, str(plugin_root))
    sys.path.insert(0, str(entry_path.parent))
    spec = importlib.util.spec_from_file_location("_liatir_python_plugin", entry_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Python plugin entry: {{entry_path}}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, "main", None)
    if not callable(handler):
        raise TypeError("Python .lia plugin must define a callable main(input) function.")
    result = handler(payload)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    if result is not None:
        print("__LIATIR_RESULT__" + json.dumps(result))
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
"#,
        plugin_root = plugin_root.to_string_lossy().to_string(),
        entry = entry,
    )
}

/// Read manifest.json from a .lia plugin, validating the signature first.
#[tauri::command]
pub async fn lia_liatir_read_manifest(path: String) -> Result<Value, String> {
    read_manifest_from_bundle(&path)
}

#[tauri::command]
pub async fn lia_liatir_python_runtime_status(
    app: AppHandle,
    path: String,
) -> Result<PythonEnvStatus, String> {
    let mut zip = open_validated(&path)?;
    let manifest = read_manifest(&mut zip)?;
    let context = python_runtime_context(&path, manifest)?;
    let app_for_status = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        status_python_plugin_env(app_for_status, context.env_id, &context.spec)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lia_liatir_python_runtime_prepare(
    app: AppHandle,
    path: String,
) -> Result<super::python_env::PythonEnvPrepareResult, String> {
    let mut zip = open_validated(&path)?;
    let manifest = read_manifest(&mut zip)?;
    let context = python_runtime_context(&path, manifest)?;
    let app_for_prepare = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        prepare_python_plugin_env(app_for_prepare, context.env_id, &context.spec)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run a .lia plugin with the runtime declared by its manifest.
/// Returns the same {jobId} value as lia_jobs_spawn.
#[tauri::command]
pub async fn lia_liatir_run(
    app: AppHandle,
    path: String,
    inputs: Value,
) -> Result<Value, String> {
    run_lia_plugin_bundle(app, path, inputs, LiaPluginRunOptions::default()).await
}

#[derive(Debug, Clone)]
pub(crate) struct LiaPluginRunOptions {
    pub python_env_root: String,
    pub workspace_id: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub job_label: Option<String>,
    pub job_kind: String,
    pub metadata: Option<Value>,
    pub wasm_storage_name: Option<String>,
}

impl Default for LiaPluginRunOptions {
    fn default() -> Self {
        Self {
            python_env_root: PYTHON_PLUGIN_ENV_ROOT.to_string(),
            workspace_id: None,
            env: None,
            job_label: None,
            job_kind: "lia-plugin".to_string(),
            metadata: None,
            wasm_storage_name: None,
        }
    }
}

pub(crate) async fn run_lia_plugin_bundle(
    app: AppHandle,
    path: String,
    inputs: Value,
    options: LiaPluginRunOptions,
) -> Result<Value, String> {
    let mut zip = open_validated(&path)?;

    // Read the manifest to pick the runtime (node | python | wasm). Default: node.
    let manifest = read_manifest(&mut zip)?;
    let runtime = manifest
        .get("runtime")
        .and_then(|r| r.as_str())
        .unwrap_or("node");

    // ── WASM runtime: extract plugin.wasm and run it in the sandbox ─────────
    if runtime == "wasm" {
        let wasm_bytes = {
            const PLUGIN_WASM_ENTRY: &str = "plugin.wasm";
            const LEGACY_WASM_ENTRY: &str = "module.wasm";
            let wasm_entry_name = if zip.by_name(PLUGIN_WASM_ENTRY).is_ok() {
                PLUGIN_WASM_ENTRY
            } else {
                LEGACY_WASM_ENTRY
            };
            let mut entry = zip
                .by_name(wasm_entry_name)
                .map_err(|_| "plugin.wasm not found in bundle (runtime: wasm)".to_string())?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            buf
        };

        // Auto-expose the directory of each "file" input read-only, so the
        // sandboxed plugin can open it — wasm has no host fs access otherwise.
        let mut host_read_paths: Vec<String> = Vec::new();
        if let Some(schema) = manifest.get("inputSchema").and_then(|s| s.as_object()) {
            for (key, def) in schema {
                if def.get("type").and_then(|t| t.as_str()) == Some("file") {
                    if let Some(p) = inputs.get(key).and_then(|v| v.as_str()) {
                        if let Some(parent) = std::path::Path::new(p).parent() {
                            let dir = parent.to_string_lossy().to_string();
                            if !dir.is_empty() && !host_read_paths.contains(&dir) {
                                host_read_paths.push(dir);
                            }
                        }
                    }
                }
            }
        }

        // Persistent /storage scope name, derived from the manifest name
        // (sanitized + ".wasm" so it passes the plugin-name validation).
        let storage_name = options.wasm_storage_name.unwrap_or_else(|| manifest
            .get("name")
            .and_then(|n| n.as_str())
            .map(|n| {
                let safe: String = n
                    .chars()
                    .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                    .collect();
                format!("{safe}.wasm")
            })
            .unwrap_or_else(|| "plugin.wasm".to_string()));

        return tauri::async_runtime::spawn_blocking(move || {
            super::plugins::run_wasm_bundle(
                app,
                storage_name,
                wasm_bytes,
                inputs,
                None,
                host_read_paths,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| format!("WASM plugin runtime failed: {e}"))?;
    }

    if runtime == "python" {
        let context = python_runtime_context(&path, manifest)?;
        let app_for_prepare = app.clone();
        let env_id_for_prepare = context.env_id.clone();
        let spec_for_prepare = context.spec.clone();
        let python_env_root = options.python_env_root.clone();
        let python_env_root_for_prepare = python_env_root.clone();
        let workspace_id = options.workspace_id.clone();
        let extra_env = options.env.clone();
        let job_label = options.job_label.clone();
        let job_kind = options.job_kind.clone();
        let extra_metadata = options.metadata.clone();
        let runtime_lock = tauri::async_runtime::spawn_blocking(move || {
            let status = status_env(
                app_for_prepare.clone(),
                python_env_root_for_prepare.clone(),
                env_id_for_prepare.clone(),
                spec_for_prepare.packages.clone().unwrap_or_default(),
                Vec::new(),
            )?;
            if status.installed {
                return Ok::<Option<PythonEnvLock>, String>(status.lock);
            }
            let prepared = prepare_env(
                app_for_prepare,
                python_env_root_for_prepare.clone(),
                env_id_for_prepare,
                spec_for_prepare.requirements.clone(),
                spec_for_prepare.packages.clone(),
                None,
                spec_for_prepare.python_requirement.clone(),
            )?;
            Ok::<Option<PythonEnvLock>, String>(prepared.lock)
        })
        .await
        .map_err(|e| e.to_string())??;

        let source_root =
            env_dir(&app, &python_env_root, &context.env_id)?.join("plugin-source");
        extract_python_payload(&mut zip, &source_root)?;

        let plugin_name = context
            .manifest
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Python plugin")
            .to_string();
        let plugin_version = context
            .manifest
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("0")
            .to_string();
        let mut metadata_map = serde_json::Map::new();
        metadata_map.insert("runtime".to_string(), Value::String("python".to_string()));
        metadata_map.insert("pluginName".to_string(), Value::String(plugin_name.clone()));
        metadata_map.insert("pluginVersion".to_string(), Value::String(plugin_version.clone()));
        metadata_map.insert("runtimeLock".to_string(), serde_json::to_value(runtime_lock).unwrap_or(Value::Null));
        if let Some(Value::Object(extra)) = extra_metadata {
            for (key, value) in extra {
                metadata_map.insert(key, value);
            }
        } else if let Some(extra) = extra_metadata {
            metadata_map.insert("extra".to_string(), extra);
        }
        let metadata = Value::Object(metadata_map);

        return spawn_in_env(
            app,
            python_env_root,
            context.env_id.clone(),
            python_plugin_runner(&source_root, &context.entry),
            Vec::new(),
            inputs,
            workspace_id,
            extra_env,
            job_label.or_else(|| Some(format!("Liatir Python plugin: {plugin_name}"))),
            job_kind,
            Some(metadata),
        )
        .await;
    }

    // ── Node runtime (default): extract index.js and spawn node ────────────
    let run_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir().join(format!("liatir-run-{run_id}"));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    // Extract index.js
    {
        let mut entry = zip.by_name("index.js")
            .map_err(|_| "index.js not found in bundle".to_string())?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(temp_dir.join("index.js"), buf).map_err(|e| e.to_string())?;
    }

    // Write runner shim
    std::fs::write(temp_dir.join("_runner.mjs"), RUNNER)
        .map_err(|e| e.to_string())?;

    let inputs_json = serde_json::to_string(&inputs).map_err(|e| e.to_string())?;
    let cwd = temp_dir.to_string_lossy().to_string();

    super::jobs::lia_jobs_spawn_with_cleanup(
        app,
        "node".to_string(),
        vec!["_runner.mjs".to_string(), inputs_json],
        Some(cwd),
        options.workspace_id,
        options.env,
        options.job_label.or_else(|| Some("Liatir plugin run".to_string())),
        Some(options.job_kind),
        options.metadata,
        Some(temp_dir.to_string_lossy().to_string()),
    ).await
}
