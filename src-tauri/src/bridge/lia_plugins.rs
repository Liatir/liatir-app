use std::{
    collections::HashMap,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::python_env::{
    env_dir, prepare_env, spawn_in_env, status_env, PythonEnvLock, PythonEnvPackage,
    PythonEnvStatus, PythonRequirement,
};

const SIG: &str = "LIATIR/1";
const PYTHON_PLUGIN_ENV_ROOT: &str = "plugin-runtimes";
pub(crate) const PYTHON_PLUGIN_DEV_ENV_ROOT: &str = "plugin-dev-runtimes";

// Signature-related zip entries. Excluded from the signed digest and, together,
// carry an Ed25519 signature over the rest of the bundle.
const SIG_ENTRY_ALG: &str = "_sig_alg";
const SIG_ENTRY_PUBKEY: &str = "_pubkey";
const SIG_ENTRY_SIGNATURE: &str = "_signature";
const SIG_ALG_ED25519: &str = "ed25519";

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

    // Verify the Ed25519 signature when present. Unsigned bundles (dev/legacy)
    // are allowed; a *signed* bundle whose content was altered is rejected.
    verify_bundle_signature(&mut zip)?;

    Ok(zip)
}

fn read_zip_entry_bytes(
    zip: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
) -> Result<Option<Vec<u8>>, String> {
    match zip.by_name(name) {
        Ok(mut entry) => {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Canonical digest signed by the CLI and re-derived here. Deterministic across
/// implementations: for every entry except the signature-meta entries, sorted
/// by name, append `"{name}\n{sha256hex(content)}\n"`, then SHA-256 the whole.
fn bundle_signing_digest(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<Vec<u8>, String> {
    let mut rows: Vec<(String, Vec<u8>)> = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if matches!(
            name.as_str(),
            SIG_ENTRY_ALG | SIG_ENTRY_PUBKEY | SIG_ENTRY_SIGNATURE
        ) || name.ends_with('/')
        {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        rows.push((name, buf));
    }
    Ok(canonical_digest_from_rows(&rows))
}

/// Pure canonical digest — kept in sync with `bundleSigningDigest` in the CLI's
/// signing.ts. Split out from zip reading so it can be tested directly.
fn canonical_digest_from_rows(rows: &[(String, Vec<u8>)]) -> Vec<u8> {
    use sha2::{Digest, Sha256};

    let mut hashed: Vec<(String, String)> = rows
        .iter()
        .map(|(name, content)| {
            let mut hasher = Sha256::new();
            hasher.update(content);
            (name.clone(), hex_lower(&hasher.finalize()))
        })
        .collect();
    hashed.sort_by(|a, b| a.0.cmp(&b.0));

    let mut outer = Sha256::new();
    for (name, content_hash) in hashed {
        outer.update(name.as_bytes());
        outer.update(b"\n");
        outer.update(content_hash.as_bytes());
        outer.update(b"\n");
    }
    outer.finalize().to_vec()
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Verify the bundle's Ed25519 signature if it carries one.
/// - no signature entries  → Ok (unsigned/dev/legacy bundle, allowed)
/// - complete + valid       → Ok
/// - incomplete or invalid  → Err (tamper-evident)
fn verify_bundle_signature(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let signature_b64 = read_zip_entry_bytes(zip, SIG_ENTRY_SIGNATURE)?;
    let pubkey_b64 = read_zip_entry_bytes(zip, SIG_ENTRY_PUBKEY)?;

    match (signature_b64, pubkey_b64) {
        (None, None) => return Ok(()), // Unsigned bundle.
        (Some(_), None) | (None, Some(_)) => {
            return Err("Malformed .lia signature (missing public key or signature).".to_string());
        }
        (Some(sig_raw), Some(pub_raw)) => {
            if let Some(alg) = read_zip_entry_bytes(zip, SIG_ENTRY_ALG)? {
                let alg = String::from_utf8_lossy(&alg).trim().to_string();
                if alg != SIG_ALG_ED25519 {
                    return Err(format!("Unsupported .lia signature algorithm: {alg}"));
                }
            }

            let sig_bytes = STANDARD
                .decode(sig_raw.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect::<Vec<u8>>())
                .map_err(|e| format!("Invalid .lia signature encoding: {e}"))?;
            let pub_bytes = STANDARD
                .decode(pub_raw.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect::<Vec<u8>>())
                .map_err(|e| format!("Invalid .lia public key encoding: {e}"))?;

            let pub_arr: [u8; 32] = pub_bytes
                .as_slice()
                .try_into()
                .map_err(|_| "Invalid .lia public key length.".to_string())?;
            let sig_arr: [u8; 64] = sig_bytes
                .as_slice()
                .try_into()
                .map_err(|_| "Invalid .lia signature length.".to_string())?;

            let verifying_key = VerifyingKey::from_bytes(&pub_arr)
                .map_err(|e| format!("Invalid .lia public key: {e}"))?;
            let signature = Signature::from_bytes(&sig_arr);

            let digest = bundle_signing_digest(zip)?;
            verifying_key
                .verify(&digest, &signature)
                .map_err(|_| "This .lia plugin's signature is invalid — it may be corrupted or tampered with.".to_string())
        }
    }
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

/// Hash of the dependency-defining parts of the Python spec ONLY. Keying the
/// venv on this (instead of the whole bundle bytes) lets code-only edits reuse
/// the same environment — critical for `liatir dev`, where every save produces
/// a new bundle. Only a change in packages/requirements/pythonRequirement
/// yields a new env. serde_json objects serialize with sorted keys, so the
/// fingerprint is deterministic.
fn python_spec_hash(spec: &PythonPluginSpec) -> String {
    let fingerprint = serde_json::json!({
        "packages": spec.packages,
        "requirements": spec.requirements,
        "pythonRequirement": spec.python_requirement,
    });
    stable_hash_hex(
        serde_json::to_string(&fingerprint)
            .unwrap_or_default()
            .as_bytes(),
    )
}

fn python_plugin_env_id(manifest: &Value, spec: &PythonPluginSpec) -> String {
    let name = manifest
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("plugin");
    let version = manifest
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or("0");
    let spec_hash = python_spec_hash(spec);
    format!(
        "plugin-{}-{}-{}",
        sanitize_env_part(name, 28),
        sanitize_env_part(version, 16),
        &spec_hash[..12.min(spec_hash.len())]
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

pub(crate) fn python_env_id_for_manifest(manifest: &Value) -> Result<String, String> {
    let spec = parse_python_spec(manifest)?;
    Ok(python_plugin_env_id(manifest, &spec))
}

fn python_runtime_context(manifest: Value) -> Result<PythonPluginRuntimeContext, String> {
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
    let env_id = python_plugin_env_id(&manifest, &spec);

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
    let context = python_runtime_context(manifest)?;
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
    let context = python_runtime_context(manifest)?;
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
        let context = python_runtime_context(manifest)?;
        let app_for_prepare = app.clone();
        let env_id_for_prepare = context.env_id.clone();
        let spec_for_prepare = context.spec.clone();
        let python_env_root = options.python_env_root.clone();
        let python_env_root_for_prepare = python_env_root.clone();
        let workspace_id = options.workspace_id.clone();
        // Point the Python process at the app's IPC server so `ctx.liatir.*`
        // can reach it. The path mirrors what ipc_server writes
        // ({app_data_dir}/.ipc); the Python SDK also has an app-data fallback,
        // but injecting it here makes discovery deterministic. A caller-provided
        // LIATIR_IPC_FILE wins.
        let mut env_map = options.env.clone().unwrap_or_default();
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            let ipc_file = app_data_dir.join(".ipc");
            env_map
                .entry("LIATIR_IPC_FILE".to_string())
                .or_insert_with(|| ipc_file.to_string_lossy().to_string());
        }
        let extra_env = Some(env_map);
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

        // Source dirs are content-addressed by the bundle hash: the venv is
        // shared across code edits (env id = dependency spec), but each bundle
        // content gets its own immutable source snapshot. This avoids both
        // stale files from older bundles and races between concurrent runs.
        let bundle_hash = stable_hash_hex(&std::fs::read(&path).map_err(|e| e.to_string())?);
        let source_root = env_dir(&app, &python_env_root, &context.env_id)?
            .join("plugin-source")
            .join(&bundle_hash[..12.min(bundle_hash.len())]);
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
        None,
        Some(temp_dir.to_string_lossy().to_string()),
    ).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(python: Value) -> Value {
        json!({
            "name": "Demo Plugin",
            "version": "1.0.0",
            "runtime": "python",
            "python": python,
        })
    }

    #[test]
    fn python_env_id_is_stable_across_code_only_changes() {
        // The env id is keyed on the dependency spec, NOT on bundle bytes, so
        // code-only edits (different entry, different sources) reuse the venv.
        let a = python_env_id_for_manifest(&manifest(json!({
            "entry": "python/main.py",
            "requirements": ["colorama==0.4.6"],
        })))
        .unwrap();
        let b = python_env_id_for_manifest(&manifest(json!({
            "entry": "python/other.py",
            "requirements": ["colorama==0.4.6"],
        })))
        .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn python_env_id_changes_when_dependencies_change() {
        let base = python_env_id_for_manifest(&manifest(json!({
            "requirements": ["colorama==0.4.6"],
        })))
        .unwrap();
        let bumped = python_env_id_for_manifest(&manifest(json!({
            "requirements": ["colorama==0.4.5"],
        })))
        .unwrap();
        let with_packages = python_env_id_for_manifest(&manifest(json!({
            "requirements": ["colorama==0.4.6"],
            "packages": [{ "package": "numpy" }],
        })))
        .unwrap();
        let with_python_requirement = python_env_id_for_manifest(&manifest(json!({
            "requirements": ["colorama==0.4.6"],
            "pythonRequirement": { "minVersion": "3.11" },
        })))
        .unwrap();
        assert_ne!(base, bumped);
        assert_ne!(base, with_packages);
        assert_ne!(base, with_python_requirement);
    }

    #[test]
    fn canonical_digest_matches_cli_signing_digest() {
        // Fixed input; expected hex computed by the CLI's bundleSigningDigest
        // (signing.ts). If either side changes the formula, this breaks.
        let rows = vec![
            ("_sig".to_string(), b"LIATIR/1".to_vec()),
            ("manifest.json".to_string(), b"{}".to_vec()),
            ("python/main.py".to_string(), b"x=1\n".to_vec()),
        ];
        assert_eq!(
            hex_lower(&canonical_digest_from_rows(&rows)),
            "efa4ba1296535072c771119a233b874990c006d8deda526e4390cbbb5e4a82b6"
        );
    }

    #[test]
    fn canonical_digest_is_order_independent() {
        let a = vec![
            ("b.txt".to_string(), b"two".to_vec()),
            ("a.txt".to_string(), b"one".to_vec()),
        ];
        let b = vec![
            ("a.txt".to_string(), b"one".to_vec()),
            ("b.txt".to_string(), b"two".to_vec()),
        ];
        assert_eq!(canonical_digest_from_rows(&a), canonical_digest_from_rows(&b));
    }

    #[test]
    fn python_env_id_stays_within_env_id_limits() {
        // env ids must pass python_env::validate_env_id (alnum/-/_, len <= 80).
        let id = python_env_id_for_manifest(&manifest(json!({
            "requirements": ["colorama==0.4.6"],
        })))
        .unwrap();
        assert!(id.len() <= 80, "env id too long: {id}");
        assert!(id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
