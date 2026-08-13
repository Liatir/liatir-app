//! Filesystem boundary for External Workflow runs.
//!
//! The engine receives only run-owned copies of local workflow code, config and
//! declared inputs. Output discovery is exact and confined to the run output
//! directory, so an engine cannot accidentally register unrelated files.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use std::{
    collections::HashMap,
    process::{Command, Output, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

const MAX_SOURCE_FILES: usize = 10_000;
const MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
#[cfg(target_os = "windows")]
const WSL_RUNTIME_SCHEMA_VERSION: u32 = 1;
#[cfg(target_os = "windows")]
const WSL_CONTROL_SCHEMA_VERSION: u32 = 1;

#[cfg(target_os = "windows")]
const WSL_CANCEL_PROGRAM: &str = r#"
set -eu
pid_file=$1
cancel_marker=$2
control_file=$3
token=$4

find_token_pid() {
  if [ -r "$pid_file" ]; then
    candidate=$(tr -d '\r\n' < "$pid_file")
    case "$candidate" in
      ''|*[!0-9]*) ;;
      *)
        if [ -r "/proc/$candidate/environ" ] && { tr '\000' '\n' < "/proc/$candidate/environ"; } 2>/dev/null | grep -Fqx "LIATIR_WSL_RUN_TOKEN=$token"; then
          printf '%s\n' "$candidate"
          return 0
        fi
        ;;
    esac
  fi

  for environment in /proc/[0-9]*/environ; do
    [ -r "$environment" ] || continue
    if { tr '\000' '\n' < "$environment"; } 2>/dev/null | grep -Fqx "LIATIR_WSL_RUN_TOKEN=$token"; then
      basename "$(dirname "$environment")"
      return 0
    fi
  done
  return 1
}

attempt=0
pid=''
while [ "$attempt" -lt 50 ]; do
  pid=$(find_token_pid || true)
  [ -n "$pid" ] && break
  [ -e "$control_file" ] || exit 0
  attempt=$((attempt + 1))
  sleep 0.1
done

if [ -z "$pid" ]; then
  rm -f "$pid_file" "$control_file"
  exit 0
fi

pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')
case "$pgid" in
  ''|*[!0-9]*) exit 65 ;;
esac

/bin/kill -TERM -- "-$pgid" 2>/dev/null || true
attempt=0
while [ "$attempt" -lt 50 ] && /bin/kill -0 -- "-$pgid" 2>/dev/null; do
  attempt=$((attempt + 1))
  sleep 0.1
done
/bin/kill -KILL -- "-$pgid" 2>/dev/null || true
attempt=0
while [ "$attempt" -lt 50 ] && /bin/kill -0 -- "-$pgid" 2>/dev/null; do
  attempt=$((attempt + 1))
  sleep 0.1
done
/bin/kill -0 -- "-$pgid" 2>/dev/null && exit 66
rm -f "$pid_file" "$control_file"
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowStageInput {
    pub key: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowDeclaredOutput {
    pub key: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowStagedInput {
    pub key: String,
    pub original_path: String,
    pub staged_path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowRuntimeDependency {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowRuntimeInfo {
    pub backend: String,
    pub available: bool,
    pub platform: String,
    pub architecture: String,
    pub distribution: Option<String>,
    pub kernel_version: Option<String>,
    pub nextflow: ExternalWorkflowRuntimeDependency,
    pub java: ExternalWorkflowRuntimeDependency,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowEngineInput {
    pub key: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowExecutionLayout {
    pub backend: String,
    pub runtime: ExternalWorkflowRuntimeInfo,
    pub command: String,
    pub arguments_prefix: Vec<String>,
    pub launch_directory: String,
    pub work_directory: String,
    pub output_directory: String,
    pub source_main_script: Option<String>,
    pub staged_config_file: Option<String>,
    pub staged_inputs: Vec<ExternalWorkflowEngineInput>,
    pub params_file: String,
    pub log_file: String,
    pub trace_file: String,
    pub report_file: String,
    pub timeline_file: String,
    pub dag_file: String,
    pub resume_work_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowRunLayout {
    pub run_directory: String,
    pub launch_directory: String,
    pub work_directory: String,
    pub output_directory: String,
    pub source_snapshot: Option<String>,
    pub source_main_script: Option<String>,
    pub source_snapshot_sha256: Option<String>,
    pub staged_config_file: Option<String>,
    pub config_sha256: Option<String>,
    pub staged_inputs: Vec<ExternalWorkflowStagedInput>,
    pub params_file: String,
    pub log_file: String,
    pub trace_file: String,
    pub report_file: String,
    pub timeline_file: String,
    pub dag_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<ExternalWorkflowExecutionLayout>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WslPreparedRun {
    schema_version: u32,
    distribution: String,
    architecture: String,
    kernel_version: Option<String>,
    nextflow_path: String,
    launch_script: String,
    runner_script: String,
    launch_directory: String,
    pid_file: String,
    cancel_marker: String,
    control_file: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WslRunControl {
    schema_version: u32,
    backend: String,
    distribution: String,
    token: String,
    created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkflowCollectedOutput {
    pub key: String,
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

fn require_segment(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        return Err(format!(
            "{field} must contain only letters, numbers, underscores and hyphens"
        ));
    }
    Ok(())
}

fn safe_relative(base: &Path, relative: &str, field: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if relative.contains('*')
        || relative.contains('?')
        || relative.contains('[')
        || relative.contains(']')
        || relative.contains('{')
        || relative.contains('}')
    {
        return Err(format!("{field} must be an exact path without wildcards"));
    }

    let mut result = base.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "{field} must stay inside the workflow output directory"
                ));
            }
        }
    }
    Ok(result)
}

fn run_root(
    data_root: &Path,
    workspace_id: &str,
    definition_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    require_segment(workspace_id, "workspaceId")?;
    require_segment(definition_id, "definitionId")?;
    require_segment(run_id, "runId")?;
    Ok(data_root
        .join("workspaces")
        .join(workspace_id)
        .join("Results")
        .join("External-Workflows")
        .join(definition_id)
        .join(run_id))
}

#[cfg(target_os = "windows")]
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
fn unavailable_dependency() -> ExternalWorkflowRuntimeDependency {
    ExternalWorkflowRuntimeDependency {
        available: false,
        path: None,
        version: None,
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_nextflow_runtime() -> ExternalWorkflowRuntimeInfo {
    let nextflow_path = crate::bridge::deps::resolve_dependency_command("nextflow");
    let java_path = crate::bridge::deps::resolve_dependency_command("java");
    let nextflow = ExternalWorkflowRuntimeDependency {
        available: nextflow_path.is_some(),
        version: nextflow_path
            .as_deref()
            .and_then(crate::bridge::deps::try_get_version),
        path: nextflow_path,
    };
    let java = ExternalWorkflowRuntimeDependency {
        available: java_path.is_some(),
        version: java_path
            .as_deref()
            .and_then(crate::bridge::deps::try_get_version),
        path: java_path,
    };
    let available = nextflow.available && java.available;
    let missing = [
        (!nextflow.available).then_some("Nextflow"),
        (!java.available).then_some("Java"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    ExternalWorkflowRuntimeInfo {
        backend: "native".into(),
        available,
        platform: if cfg!(target_os = "macos") {
            "macos".into()
        } else {
            "linux".into()
        },
        architecture: std::env::consts::ARCH.into(),
        distribution: None,
        kernel_version: None,
        nextflow,
        java,
        error: (!available).then(|| {
            format!(
                "Install {} and make it available on PATH before running this External Workflow.",
                missing.join(" and ")
            )
        }),
    }
}

#[cfg(target_os = "windows")]
fn valid_wsl_distribution(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '_' | '-' | '.')
        })
}

#[cfg(target_os = "windows")]
fn wsl_command_args(distribution: Option<&str>, command: &[String]) -> Vec<String> {
    let mut args = Vec::with_capacity(command.len() + 3);
    if let Some(distribution) = distribution {
        args.push("--distribution".into());
        args.push(distribution.into());
    }
    args.push("--exec".into());
    args.extend(command.iter().cloned());
    args
}

#[cfg(target_os = "windows")]
fn run_wsl(distribution: Option<&str>, command: &[String]) -> Result<Output, String> {
    Command::new("wsl.exe")
        .args(wsl_command_args(distribution, command))
        .output()
        .map_err(|error| format!("Could not start WSL2 through wsl.exe: {error}"))
}

#[cfg(target_os = "windows")]
fn run_wsl_with_input(
    distribution: Option<&str>,
    command: &[String],
    input: &[u8],
) -> Result<Output, String> {
    let mut child = Command::new("wsl.exe")
        .args(wsl_command_args(distribution, command))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start WSL2 through wsl.exe: {error}"))?;
    let write_result = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open WSL2 standard input.".to_string())
        .and_then(|mut stdin| {
            stdin
                .write_all(input)
                .map_err(|error| format!("Could not send staged paths to WSL2: {error}"))
        });
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for WSL2 path conversion: {error}"))?;
    write_result?;
    Ok(output)
}

#[cfg(target_os = "windows")]
fn combined_output(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    }
}

#[cfg(target_os = "windows")]
fn failed_wsl_runtime(distribution: Option<String>, error: String) -> ExternalWorkflowRuntimeInfo {
    ExternalWorkflowRuntimeInfo {
        backend: "wsl2".into(),
        available: false,
        platform: "linux".into(),
        architecture: "unknown".into(),
        distribution,
        kernel_version: None,
        nextflow: unavailable_dependency(),
        java: unavailable_dependency(),
        error: Some(error),
    }
}

#[cfg(target_os = "windows")]
fn wsl_dependency_version(distribution: &str, path: &str, argument: &str) -> Option<String> {
    let output = run_wsl(
        Some(distribution),
        &[path.to_string(), argument.to_string()],
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    crate::bridge::deps::select_version_line(&combined_output(&output))
}

#[cfg(target_os = "windows")]
fn detect_nextflow_runtime() -> ExternalWorkflowRuntimeInfo {
    let configured_distribution = std::env::var("LIATIR_WSL_DISTRIBUTION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(distribution) = configured_distribution.as_deref() {
        if !valid_wsl_distribution(distribution) {
            return failed_wsl_runtime(
                Some(distribution.to_string()),
                "LIATIR_WSL_DISTRIBUTION contains unsupported characters.".into(),
            );
        }
    }

    let probe = r#"printf 'distribution=%s\n' "$WSL_DISTRO_NAME"
printf 'architecture=%s\n' "$(uname -m)"
printf 'kernel=%s\n' "$(uname -r)"
printf 'nextflow=%s\n' "$(command -v nextflow || true)"
printf 'java=%s\n' "$(command -v java || true)"
printf 'wslpath=%s\n' "$(command -v wslpath || true)"
printf 'setsid=%s\n' "$(command -v setsid || true)"
printf 'ps=%s\n' "$(command -v ps || true)"
printf 'grep=%s\n' "$(command -v grep || true)"
printf 'tr=%s\n' "$(command -v tr || true)"
if [ -x /bin/kill ]; then printf 'kill=%s\n' /bin/kill; else printf 'kill=\n'; fi"#;
    let output = match run_wsl(
        configured_distribution.as_deref(),
        &["/bin/sh".into(), "-lc".into(), probe.into()],
    ) {
        Ok(output) => output,
        Err(error) => return failed_wsl_runtime(configured_distribution, error),
    };
    if !output.status.success() {
        return failed_wsl_runtime(
            configured_distribution,
            format!("WSL2 runtime probe failed: {}", combined_output(&output)),
        );
    }

    let fields = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.to_string(), value.trim().to_string()))
        .collect::<HashMap<_, _>>();
    let distribution = fields
        .get("distribution")
        .filter(|value| valid_wsl_distribution(value))
        .cloned()
        .or(configured_distribution);
    let Some(distribution) = distribution else {
        return failed_wsl_runtime(
            None,
            "WSL2 did not report a valid distribution name.".into(),
        );
    };
    let architecture = fields
        .get("architecture")
        .cloned()
        .unwrap_or_else(|| "unknown".into());
    let kernel_version = fields
        .get("kernel")
        .cloned()
        .filter(|value| !value.is_empty());
    let nextflow_path = fields
        .get("nextflow")
        .cloned()
        .filter(|value| value.starts_with('/'));
    let java_path = fields
        .get("java")
        .cloned()
        .filter(|value| value.starts_with('/'));
    let nextflow = ExternalWorkflowRuntimeDependency {
        available: nextflow_path.is_some(),
        version: nextflow_path
            .as_deref()
            .and_then(|path| wsl_dependency_version(&distribution, path, "-version")),
        path: nextflow_path,
    };
    let java = ExternalWorkflowRuntimeDependency {
        available: java_path.is_some(),
        version: java_path
            .as_deref()
            .and_then(|path| wsl_dependency_version(&distribution, path, "-version")),
        path: java_path,
    };

    let mut problems = Vec::new();
    if architecture != "x86_64" {
        problems.push(format!(
            "the selected distribution reports {architecture}, not x86_64"
        ));
    }
    if !kernel_version
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("wsl2")
    {
        problems.push("the selected distribution is not running on a WSL2 kernel".into());
    }
    for utility in ["wslpath", "setsid", "ps", "grep", "tr", "kill"] {
        if !fields
            .get(utility)
            .is_some_and(|path| path.starts_with('/'))
        {
            problems.push(format!("{utility} is unavailable inside WSL2"));
        }
    }
    if !nextflow.available {
        problems.push("Nextflow is unavailable inside WSL2".into());
    }
    if !java.available {
        problems.push("Java is unavailable inside WSL2".into());
    }
    let available = problems.is_empty();
    ExternalWorkflowRuntimeInfo {
        backend: "wsl2".into(),
        available,
        platform: "linux".into(),
        architecture,
        distribution: Some(distribution.clone()),
        kernel_version,
        nextflow,
        java,
        error: (!available).then(|| {
            format!(
                "WSL2 distribution {distribution} is not ready: {}.",
                problems.join("; ")
            )
        }),
    }
}

fn require_nextflow_runtime() -> Result<ExternalWorkflowRuntimeInfo, String> {
    let runtime = detect_nextflow_runtime();
    if runtime.available {
        Ok(runtime)
    } else {
        Err(runtime
            .error
            .clone()
            .unwrap_or_else(|| "Nextflow runtime is unavailable.".into()))
    }
}

fn source_entry_allowed(entry: &DirEntry, source_root: &Path) -> bool {
    let Ok(relative) = entry.path().strip_prefix(source_root) else {
        return false;
    };
    if relative.as_os_str().is_empty() {
        return true;
    }
    let mut components = relative.components();
    let first = components.next().and_then(|component| match component {
        Component::Normal(value) => value.to_str(),
        _ => None,
    });
    if components.next().is_some() {
        return true;
    }
    !matches!(first, Some(".git" | ".nextflow" | "work"))
}

fn hash_and_copy_file(source: &Path, destination: &Path) -> Result<(u64, String), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Symbolic links are not allowed in workflow staging: {}",
            source.display()
        ));
    }
    if !metadata.is_file() {
        return Err(format!("Expected a regular file: {}", source.display()));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut output = fs::File::create(destination).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 65_536];
    let mut size = 0_u64;
    loop {
        let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        hasher.update(&buffer[..read]);
        size = size
            .checked_add(read as u64)
            .ok_or_else(|| "File size overflow during workflow staging".to_string())?;
    }
    output.sync_all().map_err(|error| error.to_string())?;
    fs::set_permissions(destination, metadata.permissions()).map_err(|error| error.to_string())?;
    Ok((size, format!("{:x}", hasher.finalize())))
}

fn snapshot_source(
    source_main_script: &Path,
    destination: &Path,
) -> Result<(PathBuf, String), String> {
    let source_metadata = fs::symlink_metadata(source_main_script)
        .map_err(|error| format!("Could not read local workflow main script: {error}"))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        return Err(
            "The local workflow main script must be a regular file, not a symbolic link".into(),
        );
    }
    let main = source_main_script
        .canonicalize()
        .map_err(|error| format!("Could not read local workflow main script: {error}"))?;
    let metadata = fs::symlink_metadata(&main).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(
            "The local workflow main script must be a regular file, not a symbolic link".into(),
        );
    }
    let source_root = main
        .parent()
        .ok_or_else(|| "The local workflow main script has no parent directory".to_string())?
        .to_path_buf();
    if destination.starts_with(&source_root) {
        return Err("The local workflow source cannot contain its own Liatir run directory".into());
    }

    let mut entries = WalkDir::new(&source_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| source_entry_allowed(entry, &source_root))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.path().to_path_buf());
    let file_count = entries
        .iter()
        .filter(|entry| entry.file_type().is_file())
        .count();
    if file_count > MAX_SOURCE_FILES {
        return Err(format!(
            "Local workflow source contains {file_count} files; the safe staging limit is {MAX_SOURCE_FILES}"
        ));
    }

    let mut aggregate = Sha256::new();
    let mut total_bytes = 0_u64;
    for entry in entries {
        let relative = entry
            .path()
            .strip_prefix(&source_root)
            .map_err(|error| error.to_string())?;
        if relative.as_os_str().is_empty() {
            fs::create_dir_all(destination).map_err(|error| error.to_string())?;
            continue;
        }
        let target = destination.join(relative);
        if entry.file_type().is_symlink() {
            return Err(format!(
                "Symbolic links are not allowed in local workflow source: {}",
                relative.display()
            ));
        }
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if !entry.file_type().is_file() {
            return Err(format!(
                "Unsupported workflow source entry: {}",
                relative.display()
            ));
        }
        let (size, digest) = hash_and_copy_file(entry.path(), &target)?;
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or_else(|| "Workflow source size overflow".to_string())?;
        if total_bytes > MAX_SOURCE_BYTES {
            return Err(format!(
                "Local workflow source exceeds the safe staging limit of {} MiB",
                MAX_SOURCE_BYTES / 1024 / 1024
            ));
        }
        aggregate.update(relative.to_string_lossy().as_bytes());
        aggregate.update([0]);
        aggregate.update(digest.as_bytes());
        aggregate.update([0]);
    }

    let relative_main = main
        .strip_prefix(&source_root)
        .map_err(|error| error.to_string())?;
    Ok((
        destination.join(relative_main),
        format!("{:x}", aggregate.finalize()),
    ))
}

fn prepare_run_at(
    data_root: &Path,
    workspace_id: &str,
    definition_id: &str,
    run_id: &str,
    source_main_script: Option<&str>,
    input_files: &[ExternalWorkflowStageInput],
    config_file: Option<&str>,
) -> Result<ExternalWorkflowRunLayout, String> {
    let final_root = run_root(data_root, workspace_id, definition_id, run_id)?;
    if final_root.exists() {
        return Err(format!("External Workflow run already exists: {run_id}"));
    }
    let parent = final_root
        .parent()
        .ok_or_else(|| "External Workflow run directory has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary_root = parent.join(format!(".{run_id}.preparing-{}", Uuid::new_v4()));

    let prepared = (|| -> Result<ExternalWorkflowRunLayout, String> {
        let launch_directory = temporary_root.join("launch");
        let work_directory = temporary_root.join("work");
        let output_directory = temporary_root.join("outputs");
        let source_snapshot = temporary_root.join("source");
        let input_directory = temporary_root.join("inputs");
        let engine_directory = temporary_root.join("engine");
        for directory in [
            &launch_directory,
            &work_directory,
            &output_directory,
            &input_directory,
            &engine_directory,
        ] {
            fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        }

        let (staged_main, source_digest) = if let Some(path) = source_main_script {
            let (main, digest) = snapshot_source(Path::new(path), &source_snapshot)?;
            (Some(main), Some(digest))
        } else {
            (None, None)
        };

        let mut staged_inputs = Vec::with_capacity(input_files.len());
        let mut input_keys = HashSet::new();
        for input in input_files {
            require_segment(&input.key, "input key")?;
            if !input_keys.insert(input.key.clone()) {
                return Err(format!("Duplicate staged input key: {}", input.key));
            }
            let requested = Path::new(&input.path);
            let requested_metadata = fs::symlink_metadata(requested)
                .map_err(|error| format!("Could not read input {}: {error}", input.key))?;
            if requested_metadata.file_type().is_symlink() || !requested_metadata.is_file() {
                return Err(format!(
                    "Input {} must be a regular file, not a symbolic link",
                    input.key
                ));
            }
            let original = requested
                .canonicalize()
                .map_err(|error| format!("Could not read input {}: {error}", input.key))?;
            let file_name = original
                .file_name()
                .ok_or_else(|| format!("Input {} has no file name", input.key))?;
            let destination = input_directory.join(&input.key).join(file_name);
            let (size_bytes, sha256) = hash_and_copy_file(&original, &destination)?;
            staged_inputs.push(ExternalWorkflowStagedInput {
                key: input.key.clone(),
                original_path: original.to_string_lossy().to_string(),
                staged_path: destination.to_string_lossy().to_string(),
                size_bytes,
                sha256,
            });
        }

        let (staged_config_file, config_sha256) = if let Some(path) = config_file {
            let requested = Path::new(path);
            let requested_metadata = fs::symlink_metadata(requested)
                .map_err(|error| format!("Could not read Nextflow config file: {error}"))?;
            if requested_metadata.file_type().is_symlink() || !requested_metadata.is_file() {
                return Err(
                    "The Nextflow config file must be a regular file, not a symbolic link".into(),
                );
            }
            let original = requested
                .canonicalize()
                .map_err(|error| format!("Could not read Nextflow config file: {error}"))?;
            let file_name = original
                .file_name()
                .ok_or_else(|| "Nextflow config file has no file name".to_string())?;
            let destination = temporary_root.join("config").join(file_name);
            let (_, digest) = hash_and_copy_file(&original, &destination)?;
            (Some(destination), Some(digest))
        } else {
            (None, None)
        };

        let paths = ExternalWorkflowRunLayout {
            run_directory: temporary_root.to_string_lossy().to_string(),
            launch_directory: launch_directory.to_string_lossy().to_string(),
            work_directory: work_directory.to_string_lossy().to_string(),
            output_directory: output_directory.to_string_lossy().to_string(),
            source_snapshot: source_main_script
                .map(|_| source_snapshot.to_string_lossy().to_string()),
            source_main_script: staged_main.map(|path| path.to_string_lossy().to_string()),
            source_snapshot_sha256: source_digest,
            staged_config_file: staged_config_file.map(|path| path.to_string_lossy().to_string()),
            config_sha256,
            staged_inputs,
            params_file: engine_directory
                .join("params.json")
                .to_string_lossy()
                .to_string(),
            log_file: engine_directory
                .join("nextflow.log")
                .to_string_lossy()
                .to_string(),
            trace_file: engine_directory
                .join("trace.txt")
                .to_string_lossy()
                .to_string(),
            report_file: engine_directory
                .join("report.html")
                .to_string_lossy()
                .to_string(),
            timeline_file: engine_directory
                .join("timeline.html")
                .to_string_lossy()
                .to_string(),
            dag_file: engine_directory
                .join("dag.html")
                .to_string_lossy()
                .to_string(),
            execution: None,
        };

        fs::rename(&temporary_root, &final_root).map_err(|error| error.to_string())?;
        let replace_root = |path: String| {
            let suffix = Path::new(&path)
                .strip_prefix(&temporary_root)
                .expect("prepared path must be below temporary run root");
            final_root.join(suffix).to_string_lossy().to_string()
        };
        Ok(ExternalWorkflowRunLayout {
            run_directory: final_root.to_string_lossy().to_string(),
            launch_directory: replace_root(paths.launch_directory),
            work_directory: replace_root(paths.work_directory),
            output_directory: replace_root(paths.output_directory),
            source_snapshot: paths.source_snapshot.map(&replace_root),
            source_main_script: paths.source_main_script.map(&replace_root),
            source_snapshot_sha256: paths.source_snapshot_sha256,
            staged_config_file: paths.staged_config_file.map(&replace_root),
            config_sha256: paths.config_sha256,
            staged_inputs: paths
                .staged_inputs
                .into_iter()
                .map(|input| ExternalWorkflowStagedInput {
                    staged_path: replace_root(input.staged_path),
                    ..input
                })
                .collect(),
            params_file: replace_root(paths.params_file),
            log_file: replace_root(paths.log_file),
            trace_file: replace_root(paths.trace_file),
            report_file: replace_root(paths.report_file),
            timeline_file: replace_root(paths.timeline_file),
            dag_file: replace_root(paths.dag_file),
            execution: None,
        })
    })();

    if prepared.is_err() {
        let _ = fs::remove_dir_all(&temporary_root);
    }
    prepared
}

fn validate_resume_work_directory(
    data_root: &Path,
    workspace_id: &str,
    definition_id: &str,
    requested: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(requested) = requested else {
        return Ok(None);
    };
    require_segment(workspace_id, "workspaceId")?;
    require_segment(definition_id, "definitionId")?;
    let requested_path = Path::new(requested);
    if !requested_path.is_absolute() {
        return Err("Resume workDirectory must be an absolute path from a past run.".into());
    }
    let metadata = fs::symlink_metadata(requested_path)
        .map_err(|error| format!("Could not read resume workDirectory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Resume workDirectory must be a real directory, not a symbolic link.".into());
    }
    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve resume workDirectory: {error}"))?;
    let definition_root = data_root
        .join("workspaces")
        .join(workspace_id)
        .join("Results")
        .join("External-Workflows")
        .join(definition_id)
        .canonicalize()
        .map_err(|error| format!("Could not resolve the saved workflow run directory: {error}"))?;
    if !canonical_requested.starts_with(&definition_root)
        || canonical_requested
            .file_name()
            .and_then(|value| value.to_str())
            != Some("work")
    {
        return Err(
            "Resume workDirectory must be the work directory of a past run of this saved workflow."
                .into(),
        );
    }
    Ok(Some(requested.to_string()))
}

#[cfg(not(target_os = "windows"))]
fn attach_execution_layout(
    layout: &mut ExternalWorkflowRunLayout,
    runtime: ExternalWorkflowRuntimeInfo,
    resume_work_directory: Option<String>,
) -> Result<(), String> {
    if runtime.backend != "native" {
        return Err("The native External Workflow backend received an invalid runtime.".into());
    }
    layout.execution = Some(ExternalWorkflowExecutionLayout {
        backend: "native".into(),
        runtime,
        command: "nextflow".into(),
        arguments_prefix: Vec::new(),
        launch_directory: layout.launch_directory.clone(),
        work_directory: layout.work_directory.clone(),
        output_directory: layout.output_directory.clone(),
        source_main_script: layout.source_main_script.clone(),
        staged_config_file: layout.staged_config_file.clone(),
        staged_inputs: layout
            .staged_inputs
            .iter()
            .map(|input| ExternalWorkflowEngineInput {
                key: input.key.clone(),
                path: input.staged_path.clone(),
            })
            .collect(),
        params_file: layout.params_file.clone(),
        log_file: layout.log_file.clone(),
        trace_file: layout.trace_file.clone(),
        report_file: layout.report_file.clone(),
        timeline_file: layout.timeline_file.clone(),
        dag_file: layout.dag_file.clone(),
        resume_work_directory,
    });
    Ok(())
}

#[cfg(target_os = "windows")]
fn map_host_paths_to_wsl(distribution: &str, host_paths: &[String]) -> Result<Vec<String>, String> {
    for path in host_paths {
        if path
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
        {
            return Err(
                "A staged Windows path contains a character that WSL cannot map safely.".into(),
            );
        }
        if !Path::new(path).is_absolute() {
            return Err(format!(
                "Only absolute Windows paths can cross into WSL2: {path}"
            ));
        }
    }
    // `wslpath` accepts one path at a time. The fixed shell program reads validated paths from
    // standard input so Windows/WSL argument parsing never gets a chance to split spaces.
    let command = vec![
        "/bin/sh".into(),
        "-c".into(),
        "while IFS= read -r path; do\n  wslpath -a -u \"$path\" || exit $?\ndone".into(),
    ];
    let mut input = host_paths.join("\n");
    input.push('\n');
    let output = run_wsl_with_input(Some(distribution), &command, input.as_bytes())?;
    if !output.status.success() {
        return Err(format!(
            "WSL2 path conversion failed: {}",
            combined_output(&output)
        ));
    }
    let mapped = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect::<Vec<_>>();
    if mapped.len() != host_paths.len()
        || mapped
            .iter()
            .any(|path| !path.starts_with('/') || path.contains('\0'))
    {
        return Err("WSL2 returned an invalid path mapping for the staged run.".into());
    }
    Ok(mapped)
}

#[cfg(target_os = "windows")]
fn attach_execution_layout(
    layout: &mut ExternalWorkflowRunLayout,
    runtime: ExternalWorkflowRuntimeInfo,
    resume_work_directory: Option<String>,
) -> Result<(), String> {
    if runtime.backend != "wsl2" {
        return Err("The Windows External Workflow backend requires WSL2.".into());
    }
    let distribution = runtime
        .distribution
        .clone()
        .ok_or_else(|| "The WSL2 runtime did not provide a distribution.".to_string())?;
    let nextflow_path = runtime
        .nextflow
        .path
        .clone()
        .ok_or_else(|| "Nextflow is unavailable inside WSL2.".to_string())?;
    let engine_directory = Path::new(&layout.params_file)
        .parent()
        .ok_or_else(|| "External Workflow engine directory is invalid.".to_string())?;
    let launch_script_host = engine_directory
        .join("wsl-launch.sh")
        .to_string_lossy()
        .to_string();
    let runner_script_host = engine_directory
        .join("wsl-runner.sh")
        .to_string_lossy()
        .to_string();
    let pid_file_host = engine_directory
        .join("wsl-engine.pid")
        .to_string_lossy()
        .to_string();
    let cancel_marker_host = engine_directory
        .join("wsl-cancelled")
        .to_string_lossy()
        .to_string();
    let control_file_host = engine_directory
        .join("wsl-control.json")
        .to_string_lossy()
        .to_string();

    let mut host_paths = vec![
        layout.launch_directory.clone(),
        layout.work_directory.clone(),
        layout.output_directory.clone(),
        layout.params_file.clone(),
        layout.log_file.clone(),
        layout.trace_file.clone(),
        layout.report_file.clone(),
        layout.timeline_file.clone(),
        layout.dag_file.clone(),
        launch_script_host.clone(),
        runner_script_host.clone(),
        pid_file_host.clone(),
        cancel_marker_host.clone(),
        control_file_host.clone(),
    ];
    host_paths.extend(layout.source_main_script.iter().cloned());
    host_paths.extend(layout.staged_config_file.iter().cloned());
    host_paths.extend(
        layout
            .staged_inputs
            .iter()
            .map(|input| input.staged_path.clone()),
    );
    host_paths.extend(resume_work_directory.iter().cloned());
    let mapped_paths = map_host_paths_to_wsl(&distribution, &host_paths)?;
    let mapped = host_paths
        .into_iter()
        .zip(mapped_paths)
        .collect::<HashMap<_, _>>();
    let require_mapped = |host: &str| {
        mapped
            .get(host)
            .cloned()
            .ok_or_else(|| format!("Missing WSL2 path mapping for {host}"))
    };
    let launch_script = require_mapped(&launch_script_host)?;
    let prepared = WslPreparedRun {
        schema_version: WSL_RUNTIME_SCHEMA_VERSION,
        distribution: distribution.clone(),
        architecture: runtime.architecture.clone(),
        kernel_version: runtime.kernel_version.clone(),
        nextflow_path,
        launch_script: launch_script.clone(),
        runner_script: require_mapped(&runner_script_host)?,
        launch_directory: require_mapped(&layout.launch_directory)?,
        pid_file: require_mapped(&pid_file_host)?,
        cancel_marker: require_mapped(&cancel_marker_host)?,
        control_file: require_mapped(&control_file_host)?,
    };
    let runtime_record = engine_directory.join("wsl-runtime.json");
    fs::write(
        &runtime_record,
        serde_json::to_vec_pretty(&prepared).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not persist the WSL2 run layout: {error}"))?;

    layout.execution = Some(ExternalWorkflowExecutionLayout {
        backend: "wsl2".into(),
        runtime,
        command: "wsl.exe".into(),
        arguments_prefix: vec![
            "--distribution".into(),
            distribution,
            "--exec".into(),
            "/bin/sh".into(),
            launch_script,
        ],
        launch_directory: prepared.launch_directory.clone(),
        work_directory: require_mapped(&layout.work_directory)?,
        output_directory: require_mapped(&layout.output_directory)?,
        source_main_script: layout
            .source_main_script
            .as_deref()
            .map(require_mapped)
            .transpose()?,
        staged_config_file: layout
            .staged_config_file
            .as_deref()
            .map(require_mapped)
            .transpose()?,
        staged_inputs: layout
            .staged_inputs
            .iter()
            .map(|input| {
                Ok(ExternalWorkflowEngineInput {
                    key: input.key.clone(),
                    path: require_mapped(&input.staged_path)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        params_file: require_mapped(&layout.params_file)?,
        log_file: require_mapped(&layout.log_file)?,
        trace_file: require_mapped(&layout.trace_file)?,
        report_file: require_mapped(&layout.report_file)?,
        timeline_file: require_mapped(&layout.timeline_file)?,
        dag_file: require_mapped(&layout.dag_file)?,
        resume_work_directory: resume_work_directory
            .as_deref()
            .map(require_mapped)
            .transpose()?,
    });
    Ok(())
}

fn collect_outputs_at(
    data_root: &Path,
    workspace_id: &str,
    definition_id: &str,
    run_id: &str,
    outputs: &[ExternalWorkflowDeclaredOutput],
) -> Result<Vec<ExternalWorkflowCollectedOutput>, String> {
    let root = run_root(data_root, workspace_id, definition_id, run_id)?;
    let output_root = root.join("outputs");
    let canonical_output_root = output_root
        .canonicalize()
        .map_err(|error| format!("External Workflow output directory is unavailable: {error}"))?;
    let mut keys = HashSet::new();
    let mut collected = Vec::with_capacity(outputs.len());

    for output in outputs {
        require_segment(&output.key, "output key")?;
        if !keys.insert(output.key.clone()) {
            return Err(format!("Duplicate declared output key: {}", output.key));
        }
        let expected = safe_relative(&output_root, &output.relative_path, "output relativePath")?;
        let metadata = fs::symlink_metadata(&expected).map_err(|_| {
            format!(
                "Declared workflow output was not produced: {}",
                output.relative_path
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Declared workflow output must be a regular file: {}",
                output.relative_path
            ));
        }
        let canonical = expected.canonicalize().map_err(|error| error.to_string())?;
        if !canonical.starts_with(&canonical_output_root) {
            return Err(format!(
                "Declared workflow output escapes the run output directory: {}",
                output.relative_path
            ));
        }
        let mut file = fs::File::open(&canonical).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 65_536];
        let mut size_bytes = 0_u64;
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            size_bytes = size_bytes
                .checked_add(read as u64)
                .ok_or_else(|| "Workflow output size overflow".to_string())?;
        }
        collected.push(ExternalWorkflowCollectedOutput {
            key: output.key.clone(),
            path: canonical.to_string_lossy().to_string(),
            size_bytes,
            sha256: format!("{:x}", hasher.finalize()),
        });
    }
    Ok(collected)
}

#[cfg(target_os = "windows")]
fn shell_quote(value: &str) -> Result<String, String> {
    if value.contains('\0') {
        return Err("A WSL2 launch value contains a null character.".into());
    }
    Ok(format!("'{}'", value.replace('\'', "'\"'\"'")))
}

#[cfg(target_os = "windows")]
fn wsl_cancel_arguments(prepared: &WslPreparedRun, token: &str) -> Vec<String> {
    wsl_command_args(
        Some(&prepared.distribution),
        &[
            "/bin/sh".into(),
            "-c".into(),
            WSL_CANCEL_PROGRAM.into(),
            "liatir-wsl-cancel".into(),
            prepared.pid_file.clone(),
            prepared.cancel_marker.clone(),
            prepared.control_file.clone(),
            token.into(),
        ],
    )
}

#[cfg(target_os = "windows")]
fn validate_wsl_prepared_run(root: &Path, prepared: &WslPreparedRun) -> Result<(), String> {
    if prepared.schema_version != WSL_RUNTIME_SCHEMA_VERSION {
        return Err("The staged WSL2 runtime record has an unsupported schema version.".into());
    }
    if !valid_wsl_distribution(&prepared.distribution) {
        return Err("The staged WSL2 runtime record has an invalid distribution.".into());
    }
    for path in [
        &prepared.nextflow_path,
        &prepared.launch_script,
        &prepared.runner_script,
        &prepared.launch_directory,
        &prepared.pid_file,
        &prepared.cancel_marker,
        &prepared.control_file,
    ] {
        if !path.starts_with('/') || path.chars().any(|character| character == '\0') {
            return Err("The staged WSL2 runtime record contains an invalid Linux path.".into());
        }
    }

    let engine = root.join("engine");
    let expected_hosts = vec![
        engine.join("wsl-launch.sh").to_string_lossy().to_string(),
        engine.join("wsl-runner.sh").to_string_lossy().to_string(),
        root.join("launch").to_string_lossy().to_string(),
        engine.join("wsl-engine.pid").to_string_lossy().to_string(),
        engine.join("wsl-cancelled").to_string_lossy().to_string(),
        engine
            .join("wsl-control.json")
            .to_string_lossy()
            .to_string(),
    ];
    let expected = map_host_paths_to_wsl(&prepared.distribution, &expected_hosts)?;
    if expected
        != [
            prepared.launch_script.clone(),
            prepared.runner_script.clone(),
            prepared.launch_directory.clone(),
            prepared.pid_file.clone(),
            prepared.cancel_marker.clone(),
            prepared.control_file.clone(),
        ]
    {
        return Err("The staged WSL2 runtime record does not belong to this run.".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_wsl_prepared_run(root: &Path) -> Result<WslPreparedRun, String> {
    let path = root.join("engine/wsl-runtime.json");
    let raw = fs::read(&path)
        .map_err(|error| format!("Could not read the staged WSL2 runtime record: {error}"))?;
    let prepared: WslPreparedRun = serde_json::from_slice(&raw)
        .map_err(|error| format!("The staged WSL2 runtime record is invalid: {error}"))?;
    validate_wsl_prepared_run(root, &prepared)?;
    Ok(prepared)
}

#[cfg(target_os = "windows")]
fn write_synced(path: &Path, contents: &[u8], create_new: bool) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true).truncate(true);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    file.write_all(contents)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Could not sync {}: {error}", path.display()))
}

#[cfg(target_os = "windows")]
fn prepare_wsl_launch(root: &Path, prepared: &WslPreparedRun) -> Result<(String, String), String> {
    let engine = root.join("engine");
    let launch_script_host = engine.join("wsl-launch.sh");
    let runner_script_host = engine.join("wsl-runner.sh");
    let pid_file_host = engine.join("wsl-engine.pid");
    let cancel_marker_host = engine.join("wsl-cancelled");
    let control_file_host = engine.join("wsl-control.json");
    if control_file_host.exists() {
        return Err("This External Workflow run already has an active WSL2 process.".into());
    }
    let _ = fs::remove_file(&pid_file_host);
    let _ = fs::remove_file(&cancel_marker_host);

    let token = Uuid::new_v4().to_string();
    let runner = r#"#!/bin/sh
set -eu
pid_file=$1
cancel_marker=$2
token=$3
nextflow=$4
shift 4
printf '%s\n' "$$" > "$pid_file"
if [ -e "$cancel_marker" ]; then
  exit 130
fi
exec env LIATIR_WSL_RUN_TOKEN="$token" NXF_ANSI_LOG=false "$nextflow" "$@"
"#;
    let launch = format!(
        "#!/bin/sh\nset -eu\ncleanup() {{ rm -f {pid_file} {control_file}; }}\ntrap cleanup EXIT\ntrap 'exit 143' HUP INT TERM\nif [ -e {cancel_marker} ]; then exit 130; fi\ncd {launch_directory}\nset +e\nsetsid --wait /bin/sh {runner_script} {pid_file} {cancel_marker} {token} {nextflow} \"$@\"\nstatus=$?\nset -e\nexit \"$status\"\n",
        pid_file = shell_quote(&prepared.pid_file)?,
        control_file = shell_quote(&prepared.control_file)?,
        cancel_marker = shell_quote(&prepared.cancel_marker)?,
        launch_directory = shell_quote(&prepared.launch_directory)?,
        runner_script = shell_quote(&prepared.runner_script)?,
        token = shell_quote(&token)?,
        nextflow = shell_quote(&prepared.nextflow_path)?,
    );
    write_synced(&runner_script_host, runner.as_bytes(), false)?;
    write_synced(&launch_script_host, launch.as_bytes(), false)?;
    let control = WslRunControl {
        schema_version: WSL_CONTROL_SCHEMA_VERSION,
        backend: "wsl2".into(),
        distribution: prepared.distribution.clone(),
        token: token.clone(),
        created_at_ms: now_ms(),
    };
    let control_json = serde_json::to_vec_pretty(&control).map_err(|error| error.to_string())?;
    write_synced(&control_file_host, &control_json, true)?;
    Ok((token, cancel_marker_host.to_string_lossy().to_string()))
}

#[cfg(target_os = "windows")]
fn merge_wsl_job_metadata(
    metadata: Option<Value>,
    prepared: &WslPreparedRun,
    control_file: &Path,
    run_id: &str,
) -> Result<Value, String> {
    let mut object = match metadata.unwrap_or_else(|| Value::Object(Default::default())) {
        Value::Object(object) => object,
        _ => return Err("External Workflow Job metadata must be an object.".into()),
    };
    object.insert("executionBackend".into(), Value::String("wsl2".into()));
    object.insert("executionPlatform".into(), Value::String("linux".into()));
    object.insert(
        "executionArchitecture".into(),
        Value::String(prepared.architecture.clone()),
    );
    object.insert(
        "wslDistribution".into(),
        Value::String(prepared.distribution.clone()),
    );
    object.insert(
        "wslKernelVersion".into(),
        prepared
            .kernel_version
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    object.insert(
        "wslControlFile".into(),
        Value::String(control_file.to_string_lossy().to_string()),
    );
    object.insert(
        "externalWorkflowRunId".into(),
        Value::String(run_id.to_string()),
    );
    Ok(Value::Object(object))
}

#[cfg(target_os = "windows")]
fn cleanup_orphaned_wsl_runs_windows(data_root: &Path) -> (u32, Vec<String>) {
    let workspaces = data_root.join("workspaces");
    if !workspaces.exists() {
        return (0, Vec::new());
    }
    let mut reconciled = 0_u32;
    let mut errors = Vec::new();
    for entry in WalkDir::new(&workspaces).max_depth(8).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                errors.push(error.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file()
            || entry.file_name().to_str() != Some("wsl-control.json")
            || entry
                .path()
                .parent()
                .and_then(Path::file_name)
                .and_then(|value| value.to_str())
                != Some("engine")
        {
            continue;
        }
        let control_path = entry.path();
        let raw = match fs::read(control_path) {
            Ok(raw) => raw,
            Err(error) => {
                errors.push(format!("read {}: {error}", control_path.display()));
                continue;
            }
        };
        let control: WslRunControl = match serde_json::from_slice(&raw) {
            Ok(control) => control,
            Err(error) => {
                errors.push(format!("invalid {}: {error}", control_path.display()));
                continue;
            }
        };
        if control.schema_version != WSL_CONTROL_SCHEMA_VERSION
            || control.backend != "wsl2"
            || !valid_wsl_distribution(&control.distribution)
            || Uuid::parse_str(&control.token).is_err()
        {
            errors.push(format!(
                "invalid WSL2 control identity: {}",
                control_path.display()
            ));
            continue;
        }
        let Some(engine) = control_path.parent() else {
            continue;
        };
        let marker_host = engine.join("wsl-cancelled");
        if let Err(error) = fs::write(&marker_host, b"cancelled\n") {
            errors.push(format!("write {}: {error}", marker_host.display()));
            continue;
        }
        let host_paths = vec![
            engine.join("wsl-engine.pid").to_string_lossy().to_string(),
            marker_host.to_string_lossy().to_string(),
            control_path.to_string_lossy().to_string(),
        ];
        let mapped = match map_host_paths_to_wsl(&control.distribution, &host_paths) {
            Ok(mapped) => mapped,
            Err(error) => {
                errors.push(format!("map {}: {error}", control_path.display()));
                continue;
            }
        };
        let prepared = WslPreparedRun {
            schema_version: WSL_RUNTIME_SCHEMA_VERSION,
            distribution: control.distribution.clone(),
            architecture: String::new(),
            kernel_version: None,
            nextflow_path: String::new(),
            launch_script: String::new(),
            runner_script: String::new(),
            launch_directory: String::new(),
            pid_file: mapped[0].clone(),
            cancel_marker: mapped[1].clone(),
            control_file: mapped[2].clone(),
        };
        match Command::new("wsl.exe")
            .args(wsl_cancel_arguments(&prepared, &control.token))
            .output()
        {
            Ok(output) if output.status.success() => {
                let _ = fs::remove_file(control_path);
                reconciled += 1;
            }
            Ok(output) => errors.push(format!(
                "cancel {}: {}",
                control_path.display(),
                combined_output(&output)
            )),
            Err(error) => errors.push(format!("cancel {}: {error}", control_path.display())),
        }
    }
    (reconciled, errors)
}

pub(crate) fn cleanup_orphaned_wsl_runs(data_root: &Path) -> (u32, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        cleanup_orphaned_wsl_runs_windows(data_root)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = data_root;
        (0, Vec::new())
    }
}

/// Report the supported execution backend and the exact engine dependencies it can see.
#[tauri::command]
pub async fn lia_external_workflow_runtime_info() -> Result<ExternalWorkflowRuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(detect_nextflow_runtime)
        .await
        .map_err(|error| format!("External Workflow runtime probe failed: {error}"))
}

/// Start Nextflow through the run-owned WSL2 launcher on native Windows.
#[tauri::command]
pub async fn lia_external_workflow_spawn_nextflow(
    app: AppHandle,
    workspace_id: String,
    definition_id: String,
    run_id: String,
    args: Vec<String>,
    label: Option<String>,
    kind: Option<String>,
    metadata: Option<Value>,
) -> Result<Value, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            app,
            workspace_id,
            definition_id,
            run_id,
            args,
            label,
            kind,
            metadata,
        );
        Err("The WSL2 Nextflow backend is available only in the native Windows app.".into())
    }
    #[cfg(target_os = "windows")]
    {
        if args.len() > 512 || args.iter().map(String::len).sum::<usize>() > 128 * 1024 {
            return Err("The Nextflow command exceeds the safe WSL2 argument limit.".into());
        }
        let data_root = crate::bridge::fs::base_dir(&app, true);
        let root = run_root(&data_root, &workspace_id, &definition_id, &run_id)?;
        let prepared = read_wsl_prepared_run(&root)?;
        let engine = root.join("engine");
        let control_file = engine.join("wsl-control.json");
        let (token, cancel_marker) = prepare_wsl_launch(&root, &prepared)?;
        let metadata = merge_wsl_job_metadata(metadata, &prepared, &control_file, &run_id)?;
        let mut display_args = vec![
            "--distribution".into(),
            prepared.distribution.clone(),
            "--exec".into(),
            "/bin/sh".into(),
            prepared.launch_script.clone(),
        ];
        display_args.extend(args);
        let kill_command = crate::bridge::jobs::JobKillCommand {
            program: "wsl.exe".into(),
            args: wsl_cancel_arguments(&prepared, &token),
            cancel_marker: Some(cancel_marker),
        };
        let result = crate::bridge::jobs::lia_jobs_spawn_with_kill_command(
            app,
            "wsl.exe".into(),
            display_args,
            None,
            Some(workspace_id),
            None,
            label,
            kind.or_else(|| Some("external-workflow".into())),
            Some(metadata),
            None,
            kill_command,
        )
        .await;
        if result.is_err() {
            let _ = fs::remove_file(control_file);
        }
        result
    }
}

/// Create an isolated, immutable-by-convention run snapshot inside workspace Results.
#[tauri::command]
pub async fn lia_external_workflow_prepare_run(
    app: AppHandle,
    workspace_id: String,
    definition_id: String,
    run_id: String,
    source_main_script: Option<String>,
    input_files: Vec<ExternalWorkflowStageInput>,
    config_file: Option<String>,
    resume_work_directory: Option<String>,
) -> Result<ExternalWorkflowRunLayout, String> {
    let data_root = crate::bridge::fs::base_dir(&app, true);
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = require_nextflow_runtime()?;
        let resume_work_directory = validate_resume_work_directory(
            &data_root,
            &workspace_id,
            &definition_id,
            resume_work_directory.as_deref(),
        )?;
        let mut layout = prepare_run_at(
            &data_root,
            &workspace_id,
            &definition_id,
            &run_id,
            source_main_script.as_deref(),
            &input_files,
            config_file.as_deref(),
        )?;
        if let Err(error) = attach_execution_layout(&mut layout, runtime, resume_work_directory) {
            let _ = fs::remove_dir_all(&layout.run_directory);
            return Err(error);
        }
        Ok(layout)
    })
    .await
    .map_err(|error| format!("External Workflow staging task failed: {error}"))?
}

/// Resolve and fingerprint only exact outputs declared by the saved definition.
#[tauri::command]
pub async fn lia_external_workflow_collect_outputs(
    app: AppHandle,
    workspace_id: String,
    definition_id: String,
    run_id: String,
    outputs: Vec<ExternalWorkflowDeclaredOutput>,
) -> Result<Vec<ExternalWorkflowCollectedOutput>, String> {
    let data_root = crate::bridge::fs::base_dir(&app, true);
    tauri::async_runtime::spawn_blocking(move || {
        collect_outputs_at(&data_root, &workspace_id, &definition_id, &run_id, &outputs)
    })
    .await
    .map_err(|error| format!("External Workflow output collection task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "liatir-external-workflow-{name}-{}",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn stages_source_and_inputs_without_mutating_originals() {
        let root = fixture_root("stage");
        let data = root.join("data");
        let source = root.join("source");
        fs::create_dir_all(source.join("modules")).unwrap();
        fs::write(
            source.join("main.nf"),
            "include { HELLO } from './modules/hello'\n",
        )
        .unwrap();
        fs::write(source.join("modules/hello.nf"), "workflow HELLO {}\n").unwrap();
        fs::create_dir_all(source.join(".git")).unwrap();
        fs::write(source.join(".git/ignored"), "not source evidence").unwrap();
        let input = root.join("sample.txt");
        fs::write(&input, "original").unwrap();

        let layout = prepare_run_at(
            &data,
            "workspace-a",
            "workflow-a",
            "run-a",
            Some(source.join("main.nf").to_str().unwrap()),
            &[ExternalWorkflowStageInput {
                key: "sample".into(),
                path: input.to_string_lossy().to_string(),
            }],
            None,
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&input).unwrap(), "original");
        assert_eq!(
            fs::read_to_string(layout.source_main_script.unwrap()).unwrap(),
            fs::read_to_string(source.join("main.nf")).unwrap()
        );
        assert!(!Path::new(layout.source_snapshot.as_ref().unwrap())
            .join(".git")
            .exists());
        assert_eq!(
            fs::read_to_string(&layout.staged_inputs[0].staged_path).unwrap(),
            "original"
        );
        assert_eq!(layout.staged_inputs[0].sha256.len(), 64);
        assert_eq!(layout.source_snapshot_sha256.unwrap().len(), 64);

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_at_the_staging_boundary() {
        use std::os::unix::fs::symlink;

        let root = fixture_root("symlink");
        let data = root.join("data");
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("real.nf"), "workflow {}\n").unwrap();
        symlink(source.join("real.nf"), source.join("main.nf")).unwrap();

        let error = prepare_run_at(
            &data,
            "workspace-a",
            "workflow-a",
            "run-a",
            Some(source.join("main.nf").to_str().unwrap()),
            &[],
            None,
        )
        .unwrap_err();
        assert!(error.contains("symbolic link"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn collects_only_exact_declared_outputs() {
        let root = fixture_root("outputs");
        let run = run_root(&root, "workspace-a", "workflow-a", "run-a").unwrap();
        fs::create_dir_all(run.join("outputs/nested")).unwrap();
        fs::write(run.join("outputs/nested/result.txt"), "result").unwrap();

        let collected = collect_outputs_at(
            &root,
            "workspace-a",
            "workflow-a",
            "run-a",
            &[ExternalWorkflowDeclaredOutput {
                key: "result".into(),
                relative_path: "nested/result.txt".into(),
            }],
        )
        .unwrap();
        assert_eq!(collected[0].size_bytes, 6);
        assert_eq!(collected[0].sha256.len(), 64);

        let traversal = collect_outputs_at(
            &root,
            "workspace-a",
            "workflow-a",
            "run-a",
            &[ExternalWorkflowDeclaredOutput {
                key: "escape".into(),
                relative_path: "../outside.txt".into(),
            }],
        )
        .unwrap_err();
        assert!(traversal.contains("stay inside"));

        fs::remove_dir_all(root).unwrap();
    }
}
