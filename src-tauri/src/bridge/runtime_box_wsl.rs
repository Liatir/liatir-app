//! Windows execution of Linux Runtime Components through WSL2.
//!
//! The Windows app owns registry policy, signatures, downloads, Jobs and Results. A small static
//! Scrollcase consumer performs the Linux-filesystem half: re-verification, extraction, self-test,
//! activation, rollback and removal. User file paths are translated by `wslpath`; no command is
//! assembled as shell text from user data.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::AppHandle;

use super::{
    app_storage::write_text_atomic,
    jobs::{lia_jobs_spawn_with_cleanup_and_kill_command, JobKillCommand},
    native_tools::verified_wsl_consumer,
    python_env::{env_dir, PythonEnvPackage, PythonRunResult},
    runtime_boxes::{validate_runtime_box_activation_value, RuntimeComponentKind},
};
use crate::helpers::wsl::{
    combined_output, is_mappable_windows_path, map_host_paths_to_wsl,
    require_runtime_box_distribution, run_wsl, wsl_command_args,
};

const RECORD_SCHEMA_VERSION: u32 = 1;
const RECORD_FILE: &str = "runtime-box-wsl.json";
const ACTIVATION_FILE: &str = "runtime-box-activation.json";
const MAX_RECORD_BYTES: u64 = 64 * 1024;
const MAX_SCRIPT_BYTES: usize = 4 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;

const PYTHON_RUNNER: &str = r#"import io
import json
import os
import pathlib
import runpy
import sys

def translate(value, pairs):
    if isinstance(value, str):
        for pair in pairs:
            source = pair["wsl"]
            if value == source:
                return pair["host"]
            if value.startswith(source + "/"):
                suffix = value[len(source) + 1:].replace("/", "\\")
                return pair["host"].rstrip("\\/") + "\\" + suffix
        return value
    if isinstance(value, list):
        return [translate(item, pairs) for item in value]
    if isinstance(value, dict):
        return {key: translate(item, pairs) for key, item in value.items()}
    return value

class MappedStream:
    def __init__(self, target, pairs):
        self.target = target
        self.pairs = pairs
        self.buffer = ""
    def write(self, text):
        self.buffer += text
        written = len(text)
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            try:
                mapped = json.dumps(translate(json.loads(line), self.pairs), separators=(",", ":"))
            except Exception:
                mapped = line
                for pair in self.pairs:
                    mapped = mapped.replace(pair["wsl"], pair["host"])
            self.target.write(mapped + "\n")
            self.target.flush()
        return written
    def flush(self):
        if self.buffer:
            text = self.buffer
            for pair in self.pairs:
                text = text.replace(pair["wsl"], pair["host"])
            self.target.write(text)
            self.buffer = ""
        self.target.flush()
    def __getattr__(self, name):
        return getattr(self.target, name)

def main():
    runtime_root = pathlib.Path(sys.argv[1])
    input_path = pathlib.Path(sys.argv[2])
    mapping_path = pathlib.Path(sys.argv[3])
    script_path = pathlib.Path(sys.argv[4])
    script_args = sys.argv[5:]
    pairs = json.loads(mapping_path.read_text(encoding="utf-8"))
    pairs.sort(key=lambda pair: len(pair["wsl"]), reverse=True)
    os.chdir(runtime_root)
    sys.argv = [str(script_path), *script_args]
    sys.path.insert(0, str(script_path.parent))
    sys.stdin = io.StringIO(input_path.read_text(encoding="utf-8"))
    sys.stdout = MappedStream(sys.stdout, pairs)
    sys.stderr = MappedStream(sys.stderr, pairs)
    try:
        runpy.run_path(str(script_path), run_name="__main__")
    finally:
        sys.stdout.flush()
        sys.stderr.flush()

if __name__ == "__main__":
    main()
"#;

const LAUNCHER: &str = r#"#!/bin/sh
cancel_marker=$1
pid_file=$2
shift 2
if [ -e "$cancel_marker" ]; then exit 130; fi
setsid "$@" &
child=$!
printf '%s\n' "$child" > "$pid_file"
wait "$child"
status=$?
rm -f "$pid_file"
exit "$status"
"#;

const CANCELLER: &str = r#"#!/bin/sh
pid_file=$1
i=0
while [ ! -f "$pid_file" ] && [ "$i" -lt 20 ]; do
  sleep 0.1
  i=$((i + 1))
done
if [ ! -f "$pid_file" ]; then exit 0; fi
pid=$(cat "$pid_file")
case "$pid" in *[!0-9]*|'') exit 2;; esac
/bin/kill -TERM -- "-$pid" 2>/dev/null || true
i=0
while [ "$i" -lt 20 ] && /bin/kill -0 "$pid" 2>/dev/null; do
  sleep 0.1
  i=$((i + 1))
done
if /bin/kill -0 "$pid" 2>/dev/null; then /bin/kill -KILL -- "-$pid" 2>/dev/null || true; fi
"#;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeBoxWslRecord {
    schema_version: u32,
    distribution: String,
    runtime_dir: String,
    python_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsumerRuntimeState {
    runtime_dir: String,
    python_path: String,
    size_bytes: u64,
    rollback_available: bool,
    activation: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsumerRollbackState {
    runtime_dir: String,
    restored: bool,
    activation: Option<Value>,
}

pub(crate) struct WslComponentStatus {
    pub(crate) runtime_dir: String,
    pub(crate) python_path: String,
    pub(crate) missing_packages: Vec<String>,
    pub(crate) size_bytes: u64,
}

pub(crate) struct WslInstallResult {
    pub(crate) runtime_dir: String,
    pub(crate) python_path: String,
    pub(crate) size_bytes: u64,
    pub(crate) rollback_available: bool,
}

pub(crate) struct WslRollbackResult {
    pub(crate) runtime_dir: String,
    pub(crate) restored: bool,
}

fn record_path(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<PathBuf, String> {
    Ok(env_dir(app, kind.runtime_root(), runtime_id)?.join(RECORD_FILE))
}

fn host_runtime_dir(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<PathBuf, String> {
    env_dir(app, kind.runtime_root(), runtime_id)
}

fn valid_wsl_path(value: &str) -> bool {
    value.starts_with('/')
        && !value.contains('\0')
        && !value.contains('\r')
        && !value.contains('\n')
        && !value.split('/').any(|part| part == "." || part == "..")
}

fn validate_record(
    record: RuntimeBoxWslRecord,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<RuntimeBoxWslRecord, String> {
    let suffix = format!("/{}/{runtime_id}", kind.runtime_root());
    if record.schema_version != RECORD_SCHEMA_VERSION
        || !crate::helpers::wsl::valid_wsl_distribution(&record.distribution)
        || !valid_wsl_path(&record.runtime_dir)
        || !record.runtime_dir.ends_with(&suffix)
        || !valid_wsl_path(&record.python_path)
        || !record
            .python_path
            .starts_with(&format!("{}/", record.runtime_dir))
    {
        return Err("The WSL2 Runtime Box location record is invalid.".into());
    }
    Ok(record)
}

fn read_record(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<RuntimeBoxWslRecord, String> {
    let path = record_path(app, kind, runtime_id)?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| "The WSL2 Runtime Box location record is missing.".to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_RECORD_BYTES {
        return Err("The WSL2 Runtime Box location record has an invalid size.".into());
    }
    let record =
        serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("The WSL2 Runtime Box location record is invalid: {error}"))?;
    validate_record(record, kind, runtime_id)
}

fn parse_consumer_json<T: for<'de> Deserialize<'de>>(
    output: std::process::Output,
) -> Result<T, String> {
    if !output.status.success() {
        return Err(format!(
            "The WSL2 Runtime Box operation failed: {}",
            combined_output(&output)
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("The WSL2 Runtime Box consumer returned invalid data: {error}"))
}

fn consumer_command(
    app: &AppHandle,
    distribution: &str,
    arguments: &[String],
) -> Result<std::process::Output, String> {
    let consumer = verified_wsl_consumer(app)?;
    let mapped = map_host_paths_to_wsl(distribution, &[consumer.to_string_lossy().to_string()])?;
    let mut command = vec![mapped[0].clone()];
    command.extend(arguments.iter().cloned());
    run_wsl(Some(distribution), &command)
}

fn compare_consumer_state(
    state: &ConsumerRuntimeState,
    expected_activation: &Value,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<(), String> {
    let suffix = format!("/{}/{runtime_id}", kind.runtime_root());
    if !valid_wsl_path(&state.runtime_dir)
        || !state.runtime_dir.ends_with(&suffix)
        || !valid_wsl_path(&state.python_path)
        || !state
            .python_path
            .starts_with(&format!("{}/", state.runtime_dir))
    {
        return Err("The WSL2 Runtime Box consumer returned an unsafe location.".into());
    }
    let activation = validate_runtime_box_activation_value(state.activation.clone())?;
    if &activation != expected_activation {
        return Err("The WSL2 Runtime Box provenance does not match the Windows app.".into());
    }
    Ok(())
}

pub(crate) fn trust_document() -> Result<String, String> {
    fn append_keys(keys: &mut Vec<Value>, raw: &str, source: &str) -> Result<(), String> {
        scrollcase_consumer::trust::parse_trusted_keys(raw.as_bytes())
            .map_err(|error| format!("invalid {source} Runtime Box trust key: {error}"))?;
        let value: Value = serde_json::from_str(raw)
            .map_err(|error| format!("invalid {source} Runtime Box trust JSON: {error}"))?;
        if let Some(values) = value.get("keys").and_then(Value::as_array) {
            keys.extend(values.iter().cloned());
        } else {
            keys.push(value);
        }
        Ok(())
    }

    let mut keys = Vec::new();
    append_keys(
        &mut keys,
        include_str!("../../../runtime-boxes/trust/production-public.json"),
        "production",
    )?;
    if cfg!(debug_assertions) {
        append_keys(
            &mut keys,
            include_str!("../../../runtime-boxes/trust/development-public.json"),
            "development",
        )?;
        if let Ok(path) = std::env::var("LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE") {
            let raw = std::fs::read_to_string(&path).map_err(|error| {
                format!("cannot read debug Liatir distribution trust key {path}: {error}")
            })?;
            append_keys(&mut keys, &raw, "debug Liatir distribution")?;
        }
    }
    if let Some(raw) = option_env!("LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON") {
        append_keys(&mut keys, raw, "compiled production")?;
    }
    serde_json::to_string_pretty(&serde_json::json!({
        "schemaVersion": 1,
        "keys": keys,
    }))
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn install(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    box_id: &str,
    component_id: &str,
    runtime_id: &str,
    release_path: &Path,
    trust_path: &Path,
    archive_path: &Path,
    archive_digest: &str,
    release_payload_digest: &str,
    activation_path: &Path,
    expected_activation: &Value,
) -> Result<WslInstallResult, String> {
    let distribution = require_runtime_box_distribution()?;
    let consumer = verified_wsl_consumer(app)?;
    let host_paths = [
        consumer.to_string_lossy().to_string(),
        release_path.to_string_lossy().to_string(),
        trust_path.to_string_lossy().to_string(),
        archive_path.to_string_lossy().to_string(),
        activation_path.to_string_lossy().to_string(),
    ];
    let mapped = map_host_paths_to_wsl(&distribution, &host_paths)?;
    let command = vec![
        mapped[0].clone(),
        "runtime-install".into(),
        kind.runtime_root().into(),
        box_id.into(),
        component_id.into(),
        runtime_id.into(),
        mapped[1].clone(),
        mapped[2].clone(),
        mapped[3].clone(),
        archive_digest.into(),
        release_payload_digest.into(),
        mapped[4].clone(),
    ];
    let state: ConsumerRuntimeState = parse_consumer_json(run_wsl(Some(&distribution), &command)?)?;
    compare_consumer_state(&state, expected_activation, kind, runtime_id)?;
    let record = RuntimeBoxWslRecord {
        schema_version: RECORD_SCHEMA_VERSION,
        distribution: distribution.clone(),
        runtime_dir: state.runtime_dir.clone(),
        python_path: state.python_path.clone(),
    };
    let host_dir = host_runtime_dir(app, kind, runtime_id)?;
    let persist = (|| -> Result<(), String> {
        std::fs::create_dir_all(&host_dir).map_err(|error| error.to_string())?;
        write_text_atomic(
            &host_dir.join(RECORD_FILE),
            &format!(
                "{}\n",
                serde_json::to_string_pretty(&record).map_err(|error| error.to_string())?
            ),
        )?;
        write_text_atomic(
            &host_dir.join(ACTIVATION_FILE),
            &format!(
                "{}\n",
                serde_json::to_string_pretty(expected_activation)
                    .map_err(|error| error.to_string())?
            ),
        )
    })();
    if let Err(error) = persist {
        let recovery = if state.rollback_available {
            consumer_command(
                app,
                &distribution,
                &[
                    "runtime-rollback".into(),
                    kind.runtime_root().into(),
                    runtime_id.into(),
                ],
            )
        } else {
            consumer_command(
                app,
                &distribution,
                &[
                    "runtime-remove".into(),
                    kind.runtime_root().into(),
                    runtime_id.into(),
                ],
            )
        };
        if !state.rollback_available {
            let _ = std::fs::remove_dir_all(&host_dir);
        }
        return Err(match recovery {
            Ok(output) if output.status.success() => format!(
                "Could not persist the WSL2 Runtime Box location; the payload was restored: {error}"
            ),
            Ok(output) => format!(
                "Could not persist the WSL2 Runtime Box location ({error}); recovery also failed: {}",
                combined_output(&output)
            ),
            Err(recovery_error) => format!(
                "Could not persist the WSL2 Runtime Box location ({error}); recovery also failed: {recovery_error}"
            ),
        });
    }
    Ok(WslInstallResult {
        runtime_dir: state.runtime_dir,
        python_path: state.python_path,
        size_bytes: state.size_bytes,
        rollback_available: state.rollback_available,
    })
}

fn import_names(packages: &[PythonEnvPackage]) -> Vec<String> {
    packages
        .iter()
        .map(|package| {
            package
                .import_name
                .as_deref()
                .unwrap_or(package.package.as_str())
                .replace('-', "_")
        })
        .collect()
}

pub(crate) fn status(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
    packages: &[PythonEnvPackage],
    expected_activation: &Value,
) -> Result<WslComponentStatus, String> {
    let record = read_record(app, kind, runtime_id)?;
    let state: ConsumerRuntimeState = parse_consumer_json(consumer_command(
        app,
        &record.distribution,
        &[
            "runtime-status".into(),
            kind.runtime_root().into(),
            runtime_id.into(),
        ],
    )?)?;
    compare_consumer_state(&state, expected_activation, kind, runtime_id)?;
    if state.runtime_dir != record.runtime_dir || state.python_path != record.python_path {
        return Err("The WSL2 Runtime Box location changed unexpectedly.".into());
    }
    let names = import_names(packages);
    let missing_packages = if names.is_empty() {
        Vec::new()
    } else {
        let names_json = serde_json::to_string(&names).map_err(|error| error.to_string())?;
        let script = format!(
            "import importlib.util,json; names={names_json}; print(json.dumps({{'missing':[name for name in names if importlib.util.find_spec(name) is None]}}))"
        );
        let output = run_wsl(
            Some(&record.distribution),
            &[record.python_path.clone(), "-c".into(), script],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Could not inspect the Runtime Box inside WSL2: {}",
                combined_output(&output)
            ));
        }
        serde_json::from_slice::<Value>(&output.stdout)
            .map_err(|error| format!("WSL2 returned an invalid package check: {error}"))?
            .get("missing")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    Ok(WslComponentStatus {
        runtime_dir: state.runtime_dir,
        python_path: state.python_path,
        missing_packages,
        size_bytes: state.size_bytes,
    })
}

pub(crate) fn rollback(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<WslRollbackResult, String> {
    let record = read_record(app, kind, runtime_id)?;
    let state: ConsumerRollbackState = parse_consumer_json(consumer_command(
        app,
        &record.distribution,
        &[
            "runtime-rollback".into(),
            kind.runtime_root().into(),
            runtime_id.into(),
        ],
    )?)?;
    if state.runtime_dir != record.runtime_dir {
        return Err("The WSL2 Runtime Box rollback returned an unsafe location.".into());
    }
    if state.restored {
        let activation = state
            .activation
            .ok_or("The restored WSL2 Runtime Box has no provenance.")?;
        let activation = validate_runtime_box_activation_value(activation)?;
        write_text_atomic(
            &host_runtime_dir(app, kind, runtime_id)?.join(ACTIVATION_FILE),
            &format!(
                "{}\n",
                serde_json::to_string_pretty(&activation).map_err(|error| error.to_string())?
            ),
        )?;
    }
    Ok(WslRollbackResult {
        runtime_dir: state.runtime_dir,
        restored: state.restored,
    })
}

pub(crate) fn remove(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
) -> Result<(), String> {
    let record = read_record(app, kind, runtime_id)?;
    let output = consumer_command(
        app,
        &record.distribution,
        &[
            "runtime-remove".into(),
            kind.runtime_root().into(),
            runtime_id.into(),
        ],
    )?;
    if !output.status.success() {
        return Err(format!(
            "Could not remove the Runtime Box from WSL2: {}",
            combined_output(&output)
        ));
    }
    Ok(())
}

fn collect_host_paths(value: &Value, paths: &mut Vec<String>) -> Result<(), String> {
    match value {
        Value::String(text) if text.starts_with(r"\\") => Err(format!(
            "Liatir cannot open files from a network location inside WSL2: {text}. Copy the file to a drive on this computer and retry."
        )),
        Value::String(text) if is_mappable_windows_path(text) => {
            paths.push(text.clone());
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                collect_host_paths(item, paths)?;
            }
            Ok(())
        }
        Value::Object(items) => {
            for item in items.values() {
                collect_host_paths(item, paths)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn translate_value(value: &mut Value, mappings: &HashMap<String, String>) {
    match value {
        Value::String(text) => {
            if let Some(mapped) = mappings.get(text) {
                *text = mapped.clone();
            }
        }
        Value::Array(items) => {
            for item in items {
                translate_value(item, mappings);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                translate_value(item, mappings);
            }
        }
        _ => {}
    }
}

struct PreparedRun {
    host_dir: PathBuf,
    display_args: Vec<String>,
    cancel_args: Vec<String>,
    cancel_marker: PathBuf,
}

fn prepare_run(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
    script: &str,
    args: &[String],
    input_json: &Value,
) -> Result<PreparedRun, String> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err("The Runtime Component script is too large.".into());
    }
    let record = read_record(app, kind, runtime_id)?;
    let mut translated_input = input_json.clone();
    let mut host_paths = Vec::new();
    collect_host_paths(&translated_input, &mut host_paths)?;
    let mut translated_args = args.to_vec();
    for argument in &translated_args {
        if argument.starts_with(r"\\") {
            return Err(format!(
                "Liatir cannot open files from a network location inside WSL2: {argument}. Copy the file to a drive on this computer and retry."
            ));
        }
        if is_mappable_windows_path(argument) {
            host_paths.push(argument.clone());
        }
    }
    let mut seen = HashSet::new();
    host_paths.retain(|path| seen.insert(path.clone()));
    let mapped_paths = if host_paths.is_empty() {
        Vec::new()
    } else {
        map_host_paths_to_wsl(&record.distribution, &host_paths)?
    };
    let mappings = host_paths
        .iter()
        .cloned()
        .zip(mapped_paths.iter().cloned())
        .collect::<HashMap<_, _>>();
    translate_value(&mut translated_input, &mappings);
    for argument in &mut translated_args {
        if let Some(mapped) = mappings.get(argument) {
            *argument = mapped.clone();
        }
    }
    let input_bytes = serde_json::to_vec(&translated_input).map_err(|error| error.to_string())?;
    if input_bytes.len() > MAX_INPUT_BYTES {
        return Err("The Runtime Component input is too large.".into());
    }

    let host_dir = host_runtime_dir(app, kind, runtime_id)?
        .join("runs")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&host_dir).map_err(|error| error.to_string())?;
    let script_path = host_dir.join("script.py");
    let input_path = host_dir.join("input.json");
    let mapping_path = host_dir.join("paths.json");
    let runner_path = host_dir.join("_liatir_wsl_python_runner.py");
    let launcher_path = host_dir.join("wsl-launch.sh");
    let canceller_path = host_dir.join("wsl-cancel.sh");
    let pid_path = host_dir.join("wsl.pid");
    let cancel_marker = host_dir.join("wsl-cancelled");
    std::fs::write(&script_path, script.as_bytes()).map_err(|error| error.to_string())?;
    std::fs::write(&input_path, input_bytes).map_err(|error| error.to_string())?;
    std::fs::write(&runner_path, PYTHON_RUNNER.as_bytes()).map_err(|error| error.to_string())?;
    std::fs::write(&launcher_path, LAUNCHER.as_bytes()).map_err(|error| error.to_string())?;
    std::fs::write(&canceller_path, CANCELLER.as_bytes()).map_err(|error| error.to_string())?;
    let path_pairs = host_paths
        .iter()
        .zip(mapped_paths.iter())
        .map(|(host, wsl)| serde_json::json!({ "host": host, "wsl": wsl }))
        .collect::<Vec<_>>();
    std::fs::write(
        &mapping_path,
        serde_json::to_vec(&path_pairs).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let run_paths = [
        script_path,
        input_path,
        mapping_path,
        runner_path,
        launcher_path,
        canceller_path,
        pid_path,
        cancel_marker.clone(),
    ]
    .map(|path| path.to_string_lossy().to_string());
    let mapped_run = map_host_paths_to_wsl(&record.distribution, &run_paths)?;
    let mut linux_command = vec![
        "/usr/bin/env".into(),
        "PYTHONUNBUFFERED=1".into(),
        format!("PATH={}/venv/bin:/usr/bin:/bin", record.runtime_dir),
        record.python_path.clone(),
        mapped_run[3].clone(),
        record.runtime_dir,
        mapped_run[1].clone(),
        mapped_run[2].clone(),
        mapped_run[0].clone(),
    ];
    linux_command.extend(translated_args);
    let mut launch = vec![
        "/bin/sh".into(),
        mapped_run[4].clone(),
        mapped_run[7].clone(),
        mapped_run[6].clone(),
    ];
    launch.extend(linux_command);
    let display_args = wsl_command_args(Some(&record.distribution), &launch);
    let cancel_args = wsl_command_args(
        Some(&record.distribution),
        &[
            "/bin/sh".into(),
            mapped_run[5].clone(),
            mapped_run[6].clone(),
        ],
    );
    Ok(PreparedRun {
        host_dir,
        display_args,
        cancel_args,
        cancel_marker,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_python(
    app: AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: String,
    script: String,
    args: Vec<String>,
    input_json: Value,
    workspace_id: Option<String>,
    label: String,
    job_kind: String,
    metadata: Value,
) -> Result<Value, String> {
    let run = prepare_run(&app, kind, &runtime_id, &script, &args, &input_json)?;
    let kill_command = JobKillCommand {
        program: "wsl.exe".into(),
        args: run.cancel_args,
        cancel_marker: Some(run.cancel_marker.to_string_lossy().to_string()),
    };
    let cleanup = run.host_dir.to_string_lossy().to_string();
    let result = lia_jobs_spawn_with_cleanup_and_kill_command(
        app,
        "wsl.exe".into(),
        run.display_args,
        None,
        workspace_id,
        None,
        Some(label),
        Some(job_kind),
        Some(metadata),
        None,
        cleanup.clone(),
        kill_command,
    )
    .await;
    if result.is_err() {
        let _ = std::fs::remove_dir_all(cleanup);
    }
    result
}

pub(crate) fn run_python(
    app: &AppHandle,
    kind: RuntimeComponentKind,
    runtime_id: &str,
    script: &str,
    args: &[String],
    input_json: &Value,
    timeout_seconds: Option<u64>,
) -> Result<PythonRunResult, String> {
    let run = prepare_run(app, kind, runtime_id, script, args, input_json)?;
    let started = Instant::now();
    let mut child = Command::new("wsl.exe")
        .args(&run.display_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the WSL2 Runtime Box: {error}"))?;
    let timeout = Duration::from_secs(timeout_seconds.unwrap_or(3600));
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(_) => break,
            None if started.elapsed() >= timeout => {
                let _ = std::fs::write(&run.cancel_marker, b"cancelled\n");
                let _ = Command::new("wsl.exe").args(&run.cancel_args).output();
                let _ = child.kill();
                let output = child
                    .wait_with_output()
                    .map_err(|error| error.to_string())?;
                let _ = std::fs::remove_dir_all(&run.host_dir);
                return Ok(PythonRunResult {
                    ok: false,
                    exit_code: None,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: format!(
                        "{}\nRuntime Component timed out after {} seconds",
                        String::from_utf8_lossy(&output.stderr),
                        timeout.as_secs()
                    ),
                    duration_ms: started.elapsed().as_millis(),
                });
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_dir_all(&run.host_dir);
    Ok(PythonRunResult {
        ok: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: started.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_absolute_linux_component_locations() {
        assert!(valid_wsl_path("/home/bio/.local/share/liatir/ai-runtimes/model"));
        assert!(!valid_wsl_path("home/bio/model"));
        assert!(!valid_wsl_path("/home/bio/../other"));
        assert!(!valid_wsl_path("/home/bio/./model"));
    }

    #[test]
    fn translates_only_exact_windows_file_values() {
        let mut value = serde_json::json!({
            "input": r"C:\data\input.vcf.gz",
            "label": "C: not a path",
            "nested": [r"D:\results\out.tsv"],
        });
        let mappings = HashMap::from([
            (r"C:\data\input.vcf.gz".to_string(), "/mnt/c/data/input.vcf.gz".to_string()),
            (r"D:\results\out.tsv".to_string(), "/mnt/d/results/out.tsv".to_string()),
        ]);
        translate_value(&mut value, &mappings);
        assert_eq!(value["input"], "/mnt/c/data/input.vcf.gz");
        assert_eq!(value["label"], "C: not a path");
        assert_eq!(value["nested"][0], "/mnt/d/results/out.tsv");
    }

    #[test]
    fn refuses_network_paths_before_starting_wsl2() {
        let mut paths = Vec::new();
        let error = collect_host_paths(
            &serde_json::json!({ "input": r"\\server\share\input.vcf.gz" }),
            &mut paths,
        )
        .unwrap_err();
        assert!(error.contains("network location"));
        assert!(paths.is_empty());
    }

    #[test]
    fn exports_every_embedded_key_for_consumer_reverification() {
        let raw = trust_document().unwrap();
        let keys = scrollcase_consumer::trust::parse_trusted_keys(raw.as_bytes()).unwrap();
        assert!(keys.iter().any(|key| key.key_id == "liatir-runtime-box-production-2026"));
        assert!(keys.iter().any(|key| key.key_id == "liatir-runtime-box-kms-2026"));
        if cfg!(debug_assertions) {
            assert!(keys.iter().any(|key| key.key_id == "liatir-runtime-box-development-2026"));
        }
    }
}
