//! Filesystem boundary for External Workflow runs.
//!
//! The engine receives only run-owned copies of local workflow code, config and
//! declared inputs. Output discovery is exact and confined to the run output
//! directory, so an engine cannot accidentally register unrelated files.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
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
                return Err(format!("{field} must stay inside the workflow output directory"));
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
        return Err(format!("Symbolic links are not allowed in workflow staging: {}", source.display()));
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
    let file_count = entries.iter().filter(|entry| entry.file_type().is_file()).count();
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
            return Err(format!("Unsupported workflow source entry: {}", relative.display()));
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
    Ok((destination.join(relative_main), format!("{:x}", aggregate.finalize())))
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
            source_snapshot: source_main_script.map(|_| source_snapshot.to_string_lossy().to_string()),
            source_main_script: staged_main.map(|path| path.to_string_lossy().to_string()),
            source_snapshot_sha256: source_digest,
            staged_config_file: staged_config_file.map(|path| path.to_string_lossy().to_string()),
            config_sha256,
            staged_inputs,
            params_file: engine_directory.join("params.json").to_string_lossy().to_string(),
            log_file: engine_directory.join("nextflow.log").to_string_lossy().to_string(),
            trace_file: engine_directory.join("trace.txt").to_string_lossy().to_string(),
            report_file: engine_directory.join("report.html").to_string_lossy().to_string(),
            timeline_file: engine_directory.join("timeline.html").to_string_lossy().to_string(),
            dag_file: engine_directory.join("dag.html").to_string_lossy().to_string(),
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
        })
    })();

    if prepared.is_err() {
        let _ = fs::remove_dir_all(&temporary_root);
    }
    prepared
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
        let metadata = fs::symlink_metadata(&expected)
            .map_err(|_| format!("Declared workflow output was not produced: {}", output.relative_path))?;
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
) -> Result<ExternalWorkflowRunLayout, String> {
    let data_root = crate::bridge::fs::base_dir(&app, true);
    tauri::async_runtime::spawn_blocking(move || {
        prepare_run_at(
            &data_root,
            &workspace_id,
            &definition_id,
            &run_id,
            source_main_script.as_deref(),
            &input_files,
            config_file.as_deref(),
        )
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
        std::env::temp_dir().join(format!("liatir-external-workflow-{name}-{}", Uuid::new_v4()))
    }

    #[test]
    fn stages_source_and_inputs_without_mutating_originals() {
        let root = fixture_root("stage");
        let data = root.join("data");
        let source = root.join("source");
        fs::create_dir_all(source.join("modules")).unwrap();
        fs::write(source.join("main.nf"), "include { HELLO } from './modules/hello'\n").unwrap();
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
        assert_eq!(fs::read_to_string(layout.source_main_script.unwrap()).unwrap(), fs::read_to_string(source.join("main.nf")).unwrap());
        assert!(!Path::new(layout.source_snapshot.as_ref().unwrap()).join(".git").exists());
        assert_eq!(fs::read_to_string(&layout.staged_inputs[0].staged_path).unwrap(), "original");
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
