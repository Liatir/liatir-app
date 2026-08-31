//! Static Scrollcase consumer used by the Windows app inside WSL2.
//!
//! The original four-argument command remains the bundled Native Tools entry point. Runtime
//! Components use explicit subcommands so the Windows app can keep Linux payloads on the WSL2
//! filesystem while preserving Scrollcase verification, self-test, atomic activation and rollback.

use scrollcase_consumer::{
    contract::targets::box_target_id,
    prepare::{
        attach_extracted_box, verify_and_extract_box, verify_extracted_payload, AttachOptions,
        EnvironmentReportOptions, PrepareOptions,
    },
    trust::TrustAnchors,
    verify::inspect_release_document,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const RUNTIME_BOX_TARGET: &str = "linux-x86_64-cpu";
const DISK_SPACE_MARGIN_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ACTIVATION_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    runtime_dir: String,
    python_path: String,
    size_bytes: u64,
    rollback_available: bool,
    activation: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RollbackState {
    runtime_dir: String,
    restored: bool,
    activation: Option<Value>,
}

fn digest(value: &str) -> Result<&str, String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(value)
    } else {
        Err("The Runtime Box archive digest is invalid.".into())
    }
}

fn identifier<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let valid = !value.is_empty()
        && value.len() <= 96
        && value.split(['-', '.']).all(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        });
    valid
        .then_some(value)
        .ok_or_else(|| format!("The Runtime Box {label} is invalid."))
}

fn component_root(kind: &str) -> Result<PathBuf, String> {
    if !matches!(kind, "ai-runtimes" | "tool-runtimes") {
        return Err("The Runtime Component kind is invalid.".into());
    }
    let home = std::env::var_os("HOME").ok_or("WSL2 did not provide a home directory.")?;
    Ok(PathBuf::from(home).join(".local/share/liatir").join(kind))
}

fn runtime_root(kind: &str, runtime_id: &str) -> Result<PathBuf, String> {
    Ok(component_root(kind)?.join(identifier(runtime_id, "runtime id")?))
}

fn native_tools_install_root(archive_digest: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("WSL2 did not provide a home directory.")?;
    Ok(PathBuf::from(home)
        .join(".local/share/liatir/native-tools")
        .join(digest(archive_digest)?))
}

fn prune_previous_native_tools(current: &Path) {
    let Some(parent) = current.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if path != current && digest(&name.to_string_lossy()).is_ok() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn run_native_tools(arguments: &[String]) -> Result<PathBuf, String> {
    let [release, trusted_key, archive, archive_digest] = arguments else {
        return Err(
            "Usage: native-tools-box-consumer <release> <trusted-key> <archive> <archive-sha256>"
                .into(),
        );
    };
    let release = Path::new(release);
    let trusted_key = Path::new(trusted_key);
    let archive = Path::new(archive);
    let root = native_tools_install_root(archive_digest)?;
    let environment = EnvironmentReportOptions::default();

    let prepared = if root.is_dir() {
        let options = AttachOptions {
            trust: TrustAnchors::KeyFile(trusted_key),
            root: &root,
            environment,
        };
        verify_extracted_payload(release, &options).map_err(|error| error.to_string())?;
        attach_extracted_box(release, &options)
    } else {
        verify_and_extract_box(
            release,
            &PrepareOptions {
                trust: TrustAnchors::KeyFile(trusted_key),
                archive: Some(archive),
                destination: &root,
                environment,
            },
        )
    }
    .map_err(|error| error.to_string())?;

    if prepared.box_id() != "native-tools"
        || prepared.runtime_id() != "native-tools"
        || prepared.target_id() != RUNTIME_BOX_TARGET
    {
        return Err("The signed box is not the Linux Native Tools box.".into());
    }
    prune_previous_native_tools(prepared.root());
    Ok(prepared.root().to_path_buf())
}

fn unique_staging(parent: &Path) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for attempt in 0..8u8 {
        let candidate = parent.join(format!(".s-{}-{nonce:x}-{attempt}", std::process::id()));
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Ok(_) => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not allocate Runtime Box staging inside WSL2.".into())
}

fn rollback_root(parent: &Path, runtime_id: &str) -> PathBuf {
    parent.join(".rollbacks").join(runtime_id)
}

fn newest_rollback(root: &Path) -> Result<Option<PathBuf>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let mut entries = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries.pop())
}

fn prune_rollbacks(root: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path != keep {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn activate_runtime(runtime: &Path, staging: &Path, runtime_id: &str) -> Result<bool, String> {
    let parent = runtime
        .parent()
        .ok_or("The Runtime Component directory has no parent.")?;
    let rollback = rollback_root(parent, runtime_id);
    fs::create_dir_all(&rollback).map_err(|error| error.to_string())?;
    let displaced = rollback.join(format!(
        "{}-{:020}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis()
    ));
    let had_current = runtime.is_dir();
    if had_current {
        fs::rename(runtime, &displaced).map_err(|error| {
            format!("Could not preserve the previous Runtime Box in WSL2: {error}")
        })?;
    }
    if let Err(error) = fs::rename(staging, runtime) {
        if had_current {
            let _ = fs::rename(&displaced, runtime);
        }
        return Err(format!(
            "Could not activate the Runtime Box in WSL2: {error}"
        ));
    }
    if had_current {
        prune_rollbacks(&rollback, &displaced);
    }
    Ok(had_current)
}

fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else {
                total = total
                    .checked_add(metadata.len())
                    .ok_or("Runtime Box size exceeds the supported range.")?;
            }
        }
    }
    Ok(total)
}

fn read_activation(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!("Could not read Runtime Box activation metadata in WSL2: {error}")
    })?;
    if metadata.len() == 0 || metadata.len() > MAX_ACTIVATION_BYTES {
        return Err("Runtime Box activation metadata in WSL2 has an invalid size.".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Runtime Box activation metadata in WSL2 is invalid: {error}"))
}

fn run_self_test(python: &Path, imports: &[String], timeout_seconds: u64) -> Result<(), String> {
    let script = imports
        .iter()
        .map(|name| format!("import {name}"))
        .collect::<Vec<_>>()
        .join("; ");
    let mut child = Command::new(python)
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the Runtime Box self-test in WSL2: {error}"))?;
    let started = Instant::now();
    let timeout = Duration::from_secs(timeout_seconds.clamp(10, 600));
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                return Err(format!(
                    "Runtime Box self-test failed in WSL2 with status {status}: {}",
                    stderr.trim()
                ));
            }
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Runtime Box self-test timed out in WSL2 after {} seconds.",
                    timeout.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn install_runtime(arguments: &[String]) -> Result<RuntimeState, String> {
    let [kind, expected_box, expected_component, expected_runtime, release_path, trusted_key, archive_path, archive_digest, expected_release_digest, activation_path] =
        arguments
    else {
        return Err("Usage: native-tools-box-consumer runtime-install <kind> <box-id> <component-id> <runtime-id> <release> <trusted-key> <archive> <archive-sha256> <release-payload-sha256> <activation>".into());
    };
    identifier(expected_box, "box id")?;
    identifier(expected_component, "component id")?;
    identifier(expected_runtime, "runtime id")?;
    digest(archive_digest)?;
    digest(expected_release_digest)?;
    let release_path = Path::new(release_path);
    let trusted_key = Path::new(trusted_key);
    let archive_path = Path::new(archive_path);
    let activation_path = Path::new(activation_path);
    let inspected = inspect_release_document(release_path, TrustAnchors::KeyFile(trusted_key))
        .map_err(|error| error.to_string())?;
    let release = &inspected.release;
    let target = box_target_id(&release.target).map_err(|error| error.to_string())?;
    if release.box_id != *expected_box
        || release.model_id != *expected_component
        || release.runtime_id != *expected_runtime
        || target != RUNTIME_BOX_TARGET
        || inspected.signed.payload_sha256 != *expected_release_digest
        || release.archive.sha256 != *archive_digest
        || !release
            .compatibility
            .host_environments
            .as_ref()
            .is_some_and(|items| items.iter().any(|item| item == "windows-wsl2"))
    {
        return Err("The signed Runtime Box is not the expected WSL2 component release.".into());
    }

    let runtime = runtime_root(kind, expected_runtime)?;
    let parent = runtime
        .parent()
        .ok_or("The Runtime Component directory has no parent.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if let Some(installed_size) = release.installed_size_bytes {
        let available = fs2::available_space(parent).map_err(|error| error.to_string())?;
        let required = installed_size.saturating_add(DISK_SPACE_MARGIN_BYTES);
        if available < required {
            return Err(format!(
                "WSL2 needs at least {required} free bytes to install this Runtime Box, but only {available} are available."
            ));
        }
    }
    let staging = unique_staging(parent)?;
    let install = (|| -> Result<RuntimeState, String> {
        let prepared = verify_and_extract_box(
            release_path,
            &PrepareOptions {
                trust: TrustAnchors::KeyFile(trusted_key),
                archive: Some(archive_path),
                destination: &staging,
                environment: EnvironmentReportOptions::default(),
            },
        )
        .map_err(|error| error.to_string())?;
        if prepared.box_id() != expected_box
            || prepared.runtime_id() != expected_runtime
            || prepared.target_id() != RUNTIME_BOX_TARGET
            || prepared.release_payload_sha256() != expected_release_digest
        {
            return Err(
                "The prepared WSL2 Runtime Box does not match the approved release.".into(),
            );
        }
        let python_entry = prepared.python_entry_point().to_string();
        let python = staging.join(&python_entry);
        run_self_test(
            &python,
            &release.self_test.python_imports,
            release.self_test.timeout_seconds,
        )?;
        let activation = read_activation(activation_path)?;
        fs::copy(activation_path, staging.join("runtime-box-activation.json")).map_err(
            |error| format!("Could not persist Runtime Box provenance in WSL2: {error}"),
        )?;
        let size_bytes = directory_size(&staging)?;
        let rollback_available = activate_runtime(&runtime, &staging, expected_runtime)?;
        Ok(RuntimeState {
            runtime_dir: runtime.to_string_lossy().to_string(),
            python_path: runtime.join(python_entry).to_string_lossy().to_string(),
            size_bytes,
            rollback_available,
            activation,
        })
    })();
    if install.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(staging);
    }
    install
}

fn current_runtime_state(kind: &str, runtime_id: &str) -> Result<RuntimeState, String> {
    let runtime = runtime_root(kind, runtime_id)?;
    let activation = read_activation(&runtime.join("runtime-box-activation.json"))?;
    let python_entry = activation
        .pointer("/release/pythonEntryPoint")
        .and_then(Value::as_str)
        .ok_or("Runtime Box activation metadata has no Python entry point.")?;
    if python_entry.starts_with('/')
        || python_entry
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Runtime Box activation metadata has an unsafe Python entry point.".into());
    }
    let python = runtime.join(python_entry);
    if !python.is_file() {
        return Err("The Runtime Box Python interpreter is missing in WSL2.".into());
    }
    let rollback = rollback_root(
        runtime
            .parent()
            .ok_or("The Runtime Component directory has no parent.")?,
        runtime_id,
    );
    Ok(RuntimeState {
        runtime_dir: runtime.to_string_lossy().to_string(),
        python_path: python.to_string_lossy().to_string(),
        size_bytes: directory_size(&runtime)?,
        rollback_available: newest_rollback(&rollback)?.is_some(),
        activation,
    })
}

fn rollback_runtime(kind: &str, runtime_id: &str) -> Result<RollbackState, String> {
    let runtime = runtime_root(kind, runtime_id)?;
    let parent = runtime
        .parent()
        .ok_or("The Runtime Component directory has no parent.")?;
    let rollback = rollback_root(parent, runtime_id);
    let Some(previous) = newest_rollback(&rollback)? else {
        return Ok(RollbackState {
            runtime_dir: runtime.to_string_lossy().to_string(),
            restored: false,
            activation: runtime
                .join("runtime-box-activation.json")
                .is_file()
                .then(|| read_activation(&runtime.join("runtime-box-activation.json")))
                .transpose()?,
        });
    };
    let failed = parent.join(format!(".failed-{}", std::process::id()));
    if failed.exists() {
        fs::remove_dir_all(&failed).map_err(|error| error.to_string())?;
    }
    if runtime.exists() {
        fs::rename(&runtime, &failed).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&previous, &runtime) {
        if failed.exists() {
            let _ = fs::rename(&failed, &runtime);
        }
        return Err(format!(
            "Could not roll back the Runtime Box in WSL2: {error}"
        ));
    }
    if failed.exists() {
        fs::remove_dir_all(failed).map_err(|error| error.to_string())?;
    }
    Ok(RollbackState {
        runtime_dir: runtime.to_string_lossy().to_string(),
        restored: true,
        activation: Some(read_activation(
            &runtime.join("runtime-box-activation.json"),
        )?),
    })
}

fn remove_runtime(kind: &str, runtime_id: &str) -> Result<(), String> {
    let runtime = runtime_root(kind, runtime_id)?;
    let parent = runtime
        .parent()
        .ok_or("The Runtime Component directory has no parent.")?;
    if runtime.exists() {
        fs::remove_dir_all(&runtime).map_err(|error| error.to_string())?;
    }
    let rollback = rollback_root(parent, runtime_id);
    if rollback.exists() {
        fs::remove_dir_all(rollback).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn print_json(value: &impl Serialize) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn run() -> Result<(), String> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    match arguments.first().map(String::as_str) {
        Some("runtime-install") => print_json(&install_runtime(&arguments[1..])?),
        Some("runtime-status") => {
            let [kind, runtime_id] = &arguments[1..] else {
                return Err(
                    "Usage: native-tools-box-consumer runtime-status <kind> <runtime-id>".into(),
                );
            };
            print_json(&current_runtime_state(kind, runtime_id)?)
        }
        Some("runtime-rollback") => {
            let [kind, runtime_id] = &arguments[1..] else {
                return Err(
                    "Usage: native-tools-box-consumer runtime-rollback <kind> <runtime-id>".into(),
                );
            };
            print_json(&rollback_runtime(kind, runtime_id)?)
        }
        Some("runtime-remove") => {
            let [kind, runtime_id] = &arguments[1..] else {
                return Err(
                    "Usage: native-tools-box-consumer runtime-remove <kind> <runtime-id>".into(),
                );
            };
            remove_runtime(kind, runtime_id)?;
            print_json(&serde_json::json!({ "removed": true }))
        }
        _ => {
            let root = run_native_tools(&arguments)?;
            println!("{}", root.display());
            Ok(())
        }
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
