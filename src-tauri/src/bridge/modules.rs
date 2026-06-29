use std::io::Read;
use tauri::AppHandle;
use serde_json::Value;

const SIG: &str = "LIATIR/1";

const RUNNER: &str = r#"import * as _mod from './index.js';
// defineModule(...) returns an object with .run; also accept a bare function or a named run export.
const _m = _mod.default ?? _mod;
const _run = typeof _m === 'function' ? _m : (_m && (_m.run ?? _mod.run));
if (typeof _run !== 'function') {
  process.stderr.write('[liatir] module must `export default defineModule(...)`\n');
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

fn open_validated(path: &str) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "Not a valid .lia module (not a zip)".to_string())?;

    // Validate signature
    let mut sig_entry = zip.by_name("_sig")
        .map_err(|_| "Not a valid .lia module (missing signature)".to_string())?;
    let mut sig = String::new();
    sig_entry.read_to_string(&mut sig).map_err(|e| e.to_string())?;
    if sig.trim() != SIG {
        return Err("Not a valid .lia module (wrong signature)".to_string());
    }
    drop(sig_entry);

    Ok(zip)
}

/// Read manifest.json from a .lia module, validating the signature first.
#[tauri::command]
pub async fn lia_liatir_read_manifest(path: String) -> Result<Value, String> {
    let mut zip = open_validated(&path)?;
    let mut entry = zip.by_name("manifest.json")
        .map_err(|_| "manifest.json not found in bundle".to_string())?;
    let mut buf = String::new();
    entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_str(&buf).map_err(|e| format!("Invalid manifest JSON: {e}"))
}

/// Extract a .lia module to a temp dir and spawn it with node.
/// Returns the same {jobId} value as lia_jobs_spawn.
#[tauri::command]
pub async fn lia_liatir_run(
    app: AppHandle,
    path: String,
    inputs: Value,
) -> Result<Value, String> {
    let mut zip = open_validated(&path)?;

    // Read the manifest to pick the runtime (node | wasm). Default: node.
    let manifest: Value = {
        let mut buf = String::new();
        if let Ok(mut entry) = zip.by_name("manifest.json") {
            entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
        }
        serde_json::from_str(&buf).unwrap_or(Value::Null)
    };
    let runtime = manifest
        .get("runtime")
        .and_then(|r| r.as_str())
        .unwrap_or("node");

    // ── WASM runtime: extract module.wasm and run it in the sandbox ─────────
    if runtime == "wasm" {
        let wasm_bytes = {
            let mut entry = zip
                .by_name("module.wasm")
                .map_err(|_| "module.wasm not found in bundle (runtime: wasm)".to_string())?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            buf
        };

        // Auto-expose the directory of each "file" input read-only, so the
        // sandboxed module can open it — wasm has no host fs access otherwise.
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
        let storage_name = manifest
            .get("name")
            .and_then(|n| n.as_str())
            .map(|n| {
                let safe: String = n
                    .chars()
                    .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                    .collect();
                format!("{safe}.wasm")
            })
            .unwrap_or_else(|| "module.wasm".to_string());

        return super::plugins::run_wasm_bundle(
            app,
            storage_name,
            wasm_bytes,
            inputs,
            None,
            host_read_paths,
        )
        .map_err(|e| e.to_string());
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
        None,
        None,
        Some("Liatir plugin run".to_string()),
        Some("lia-plugin".to_string()),
        None,
        Some(temp_dir.to_string_lossy().to_string()),
    ).await
}
