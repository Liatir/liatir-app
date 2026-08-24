//! The signed Scrollcase box that carries Liatir's process-backed Native Tools.
//!
//! They share one locked box because they have one purpose: Liatir supplies
//! them without asking a user to install or maintain dependencies. The box is
//! built with the pinned Scrollcase CLI, verified and extracted with the pinned
//! Rust consumer, and runs entirely offline from application resources.
//!
//! Windows ships the Linux target and delegates the same verification and
//! extraction to a static Scrollcase consumer inside WSL2. The payload therefore
//! lands in a Linux filesystem with its executable layout intact; no custom
//! archive format or shell extractor exists beside Scrollcase.

use scrollcase_consumer::{
    contract::targets::box_target_id,
    prepare::{
        attach_extracted_box, verify_and_extract_box, verify_extracted_payload, AttachOptions,
        EnvironmentReportOptions, PrepareOptions,
    },
    trust::{parse_trusted_keys, TrustAnchors, TrustedKey},
    verify::{inspect_archive_for, inspect_release_document},
};
use serde::Serialize;
use serde_json::Value;
#[cfg(target_os = "windows")]
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

include!(concat!(env!("OUT_DIR"), "/native_tools_trust.rs"));

/// Tools the Native Tools box provides.
///
/// Kept in step with `NATIVE_TOOLS_BOX_TOOL_IDS` in `packages/liatir-core`;
/// `tests/unit/native-tools-scrollcase.test.ts` fails if the two drift apart.
///
/// `piscem` is in the box too, as the mapping engine simpleaf drives, but it is
/// not listed here: Liatir never launches it directly, and simpleaf finds it
/// through the box's own PATH.
pub(crate) const BUNDLED_TOOLS: [&str; 8] = [
    "samtools",
    "bcftools",
    "seqkit",
    "fastp",
    "bwa",
    "minimap2",
    "simpleaf",
    "alevin-fry",
];

const RESOURCE_DIR: &str = "native-tools";
const BOX_ID: &str = "native-tools";
const RUNTIME_ID: &str = "native-tools";
const WSL_CONSUMER: &str = "native-tools-box-consumer";

const SIMPLEAF_HOME_DIR: &str = "simpleaf-home";
const SIMPLEAF_HOME_VARIABLE: &str = "ALEVIN_FRY_HOME";

/// Serialises preparation. Two Jobs started together on a fresh installation
/// must not race to install the same immutable box destination.
static PREPARED_BOX: Mutex<Option<String>> = Mutex::new(None);
/// The simpleaf configuration directory already pointed at the prepared box.
static SIMPLEAF_HOME: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Avoid re-hashing the same immutable embedded archive for every dependency row.
static VERIFIED_ARCHIVE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone)]
struct Resources {
    archive: PathBuf,
    release: PathBuf,
    trusted_key: PathBuf,
    wsl_consumer: PathBuf,
}

/// The Scrollcase target this build ships, or `None` on an unsupported host.
pub(crate) fn target_id() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("macos-aarch64-cpu"),
        ("linux", "x86_64") => Some("linux-x86_64-cpu"),
        // Windows executes the Linux target through WSL2.
        ("windows", "x86_64") => Some("linux-x86_64-cpu"),
        _ => None,
    }
}

pub(crate) fn is_bundled_tool(name: &str) -> bool {
    BUNDLED_TOOLS.contains(&name)
}

fn resource_root(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(directory) = app.path().resource_dir() {
        let candidate = directory.join(RESOURCE_DIR);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    #[cfg(debug_assertions)]
    {
        let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_DIR);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn resources(app: &AppHandle) -> Option<Resources> {
    let root = resource_root(app)?;
    let stem = format!("native-tools-{}", target_id()?);
    let resources = Resources {
        archive: root.join(format!("{stem}.zip")),
        release: root.join(format!("{stem}.release.json")),
        trusted_key: root.join(format!("{stem}.trusted-key.json")),
        wsl_consumer: root.join(WSL_CONSUMER),
    };
    let common_present = [
        &resources.archive,
        &resources.release,
        &resources.trusted_key,
    ]
    .iter()
    .all(|path| path.is_file());
    let platform_present = !cfg!(target_os = "windows") || resources.wsl_consumer.is_file();
    (common_present && platform_present).then_some(resources)
}

fn metadata() -> Option<Value> {
    serde_json::from_str(EMBEDDED_NATIVE_TOOLS_METADATA).ok()
}

fn trusted_keys() -> Result<Vec<TrustedKey>, String> {
    if EMBEDDED_NATIVE_TOOLS_TRUST.is_empty() {
        return Err("This build has no compiled-in Native Tools trust anchor.".into());
    }
    parse_trusted_keys(EMBEDDED_NATIVE_TOOLS_TRUST.as_bytes()).map_err(|error| error.to_string())
}

fn inspected_release(
    resource: &Resources,
) -> Result<scrollcase_consumer::verify::InspectedRelease, String> {
    let keys = trusted_keys()?;
    let inspected = inspect_release_document(&resource.release, TrustAnchors::Keys(&keys))
        .map_err(|error| error.to_string())?;
    let expected_target = target_id().ok_or("No Native Tools box is built for this host.")?;
    let actual_target =
        box_target_id(&inspected.release.target).map_err(|error| error.to_string())?;
    if inspected.release.box_id != BOX_ID
        || inspected.release.runtime_id != RUNTIME_ID
        || actual_target != expected_target
    {
        return Err("The signed resource is not the Native Tools box for this host.".into());
    }
    Ok(inspected)
}

fn signed_archive_digest(resource: &Resources) -> Result<String, String> {
    Ok(inspected_release(resource)?.release.archive.sha256)
}

fn verified_archive_digest(resource: &Resources) -> Result<String, String> {
    let inspected = inspected_release(resource)?;
    let digest = inspected.release.archive.sha256.clone();
    let mut verified = VERIFIED_ARCHIVE
        .lock()
        .map_err(|_| "Native Tools archive verification lock poisoned")?;
    if verified.as_deref() == Some(&digest) {
        return Ok(digest);
    }
    inspect_archive_for(inspected, Some(&resource.archive)).map_err(|error| error.to_string())?;
    *verified = Some(digest.clone());
    Ok(digest)
}

fn verify_platform_resources(resource: &Resources) -> Result<String, String> {
    let digest = verified_archive_digest(resource)?;
    #[cfg(target_os = "windows")]
    {
        if EMBEDDED_WSL_CONSUMER_SHA256.is_empty() {
            return Err("This build has no compiled-in WSL2 consumer identity.".into());
        }
        let bytes = std::fs::read(&resource.wsl_consumer)
            .map_err(|error| format!("Cannot read the WSL2 Scrollcase consumer: {error}"))?;
        let actual = format!("{:x}", Sha256::digest(bytes));
        if actual != EMBEDDED_WSL_CONSUMER_SHA256 {
            return Err(
                "The WSL2 Scrollcase consumer does not match this application build.".into(),
            );
        }
    }
    Ok(digest)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolsEnvironment {
    /// `native`, `wsl2`, or `none` when this host has no box target.
    pub execution: String,
    pub available: bool,
    pub target_id: Option<String>,
    pub tools: Vec<String>,
    /// Product metadata compiled from the same tracked source included in the box.
    pub metadata: Option<Value>,
    pub error: Option<String>,
}

/// Report what the application is actually carrying, for the Dependencies screen.
#[tauri::command]
pub fn lia_native_tools_environment(app: AppHandle) -> NativeToolsEnvironment {
    let Some(target) = target_id() else {
        return NativeToolsEnvironment {
            execution: "none".into(),
            available: false,
            target_id: None,
            tools: vec![],
            metadata: None,
            error: Some(format!(
                "No Native Tools Scrollcase box is built for {}/{}.",
                std::env::consts::OS,
                std::env::consts::ARCH
            )),
        };
    };
    let metadata = metadata();
    let verification = resources(&app)
        .ok_or_else(|| "The bundled Native Tools Scrollcase box is missing from this build.".into())
        .and_then(|resources| verify_platform_resources(&resources).map(|_| ()));
    NativeToolsEnvironment {
        execution: if cfg!(target_os = "windows") {
            "wsl2"
        } else {
            "native"
        }
        .into(),
        available: metadata.is_some() && verification.is_ok(),
        target_id: Some(target.into()),
        tools: BUNDLED_TOOLS
            .iter()
            .map(|name| (*name).to_string())
            .collect(),
        error: verification.err(),
        metadata,
    }
}

/// Report a bundled tool to the dependency check without running or extracting it.
pub(crate) fn bundled_dependency(
    app: &AppHandle,
    binary: &str,
) -> Option<(Option<String>, String)> {
    if !is_bundled_tool(binary) {
        return None;
    }
    let resources = resources(app)?;
    verify_platform_resources(&resources).ok()?;
    let version = metadata()?
        .get("tools")?
        .as_array()?
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some(binary))?
        .get("version")?
        .as_str()?
        .to_string();
    Some((host_binary_path(app, binary), version))
}

#[cfg(not(target_os = "windows"))]
fn host_binary_path(app: &AppHandle, binary: &str) -> Option<String> {
    let path = prepared_root(app)
        .ok()?
        .join("venv")
        .join("bin")
        .join(binary);
    path.exists().then(|| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn host_binary_path(_app: &AppHandle, _binary: &str) -> Option<String> {
    None
}

/// What the Jobs backend should actually execute.
pub(crate) struct ResolvedCommand {
    pub program: String,
    pub args: Vec<String>,
    pub environment: Vec<(String, String)>,
}

#[cfg(not(target_os = "windows"))]
fn native_environment(root: &Path) -> Vec<(String, String)> {
    let bin = root.join("venv/bin");
    let mut path = bin.to_string_lossy().to_string();
    if let Some(inherited) = std::env::var_os("PATH") {
        path.push(':');
        path.push_str(&inherited.to_string_lossy());
    }
    let library_variable = if cfg!(target_os = "macos") {
        "DYLD_LIBRARY_PATH"
    } else {
        "LD_LIBRARY_PATH"
    };
    vec![
        ("PATH".into(), path),
        (
            library_variable.into(),
            root.join("venv/lib").to_string_lossy().to_string(),
        ),
        (
            SIMPLEAF_HOME_VARIABLE.into(),
            simpleaf_home(root).to_string_lossy().to_string(),
        ),
    ]
}

/// simpleaf reads the piscem and alevin-fry paths from a JSON file in this directory and
/// refuses to start without it. Kept beside the extracted boxes rather than inside one: the
/// box root is content-addressed and immutable, and its parent already belongs to Liatir.
/// `prune_previous_boxes` only deletes directories named by a digest, so this one survives a
/// box upgrade — and `ensure_simpleaf_home` rewrites the file for the current root anyway.
#[cfg(not(target_os = "windows"))]
fn simpleaf_home(root: &Path) -> PathBuf {
    match root.parent() {
        Some(parent) => parent.join(SIMPLEAF_HOME_DIR),
        None => root.join(SIMPLEAF_HOME_DIR),
    }
}

/// Point simpleaf at the engines inside *this* box, once per application run.
///
/// The recorded paths name a specific box root, so they go stale the moment the application
/// ships a new box. Rewriting them on first use costs one short process and removes the
/// failure mode entirely, which is worth more than the milliseconds saved by trusting them.
#[cfg(not(target_os = "windows"))]
fn ensure_simpleaf_home(root: &Path) -> Result<(), String> {
    let mut recorded = SIMPLEAF_HOME
        .lock()
        .map_err(|_| "simpleaf configuration lock poisoned")?;
    let home = simpleaf_home(root);
    if recorded.as_deref() == Some(home.as_path()) {
        return Ok(());
    }
    std::fs::create_dir_all(&home)
        .map_err(|error| format!("Liatir could not create simpleaf's configuration directory: {error}"))?;
    let output = std::process::Command::new(root.join("venv/bin/simpleaf"))
        .arg("set-paths")
        .envs(native_environment(root))
        .output()
        .map_err(|error| format!("Liatir could not configure simpleaf: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Liatir could not configure simpleaf: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    *recorded = Some(home);
    Ok(())
}

/// Resolve a spawn request against the verified Native Tools box.
pub(crate) fn resolve(
    app: &AppHandle,
    cmd: &str,
    args: &[String],
) -> Result<Option<ResolvedCommand>, String> {
    if !is_bundled_tool(cmd) || resources(app).is_none() {
        return Ok(None);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let root = ensure_prepared(app)?;
        let binary = root.join("venv").join("bin").join(cmd);
        if !binary.is_file() {
            return Err(format!(
                "{cmd} belongs to the Native Tools box but is missing from {}.",
                binary.display()
            ));
        }
        if cmd == "simpleaf" {
            ensure_simpleaf_home(&root)?;
        }
        Ok(Some(ResolvedCommand {
            program: binary.to_string_lossy().to_string(),
            args: args.to_vec(),
            environment: native_environment(&root),
        }))
    }

    #[cfg(target_os = "windows")]
    {
        wsl_plan::reject_unreachable_paths(args)?;
        let distribution = windows::distribution()?;
        let prefix = windows::ensure_prepared(app, &distribution)?;
        if cmd == "simpleaf" {
            windows::ensure_simpleaf_home(&distribution, &prefix)?;
        }
        let positions = wsl_plan::path_argument_positions(args);
        let mapped = if positions.is_empty() {
            Vec::new()
        } else {
            let hosts: Vec<String> = positions.iter().map(|index| args[*index].clone()).collect();
            crate::helpers::wsl::map_host_paths_to_wsl(&distribution, &hosts)?
        };
        let args = wsl_plan::substitute_mapped_paths(args, &positions, &mapped)?;
        Ok(Some(wsl_plan::tool_command(
            &distribution,
            &prefix,
            cmd,
            &args,
        )))
    }
}

/// Verify and prepare the box off the startup path. A tool run retries and
/// surfaces the same error if preparation failed here.
pub fn prepare_in_background(app: &AppHandle) {
    if target_id().is_none() || resources(app).is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "windows"))]
        let outcome = ensure_prepared(&app).map(|_| ());
        #[cfg(target_os = "windows")]
        let outcome = windows::distribution()
            .and_then(|distribution| windows::ensure_prepared(&app, &distribution))
            .map(|_| ());
        if let Err(error) = outcome {
            eprintln!("[native-tools] Scrollcase box not ready: {error}");
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn prepared_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resources = resources(app)
        .ok_or("The bundled Native Tools Scrollcase box is missing from this installation.")?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(RESOURCE_DIR)
        .join(signed_archive_digest(&resources)?))
}

#[cfg(not(target_os = "windows"))]
fn ensure_prepared(app: &AppHandle) -> Result<PathBuf, String> {
    let mut prepared_in_process = PREPARED_BOX
        .lock()
        .map_err(|_| "Native Tools preparation lock poisoned")?;
    if let Some(root) = prepared_in_process.as_ref() {
        return Ok(PathBuf::from(root));
    }
    let resources = resources(app)
        .ok_or("The bundled Native Tools Scrollcase box is missing from this installation.")?;
    let digest = signed_archive_digest(&resources)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(RESOURCE_DIR)
        .join(&digest);
    let keys = trusted_keys()?;

    let prepared = if root.is_dir() {
        let options = AttachOptions {
            trust: TrustAnchors::Keys(&keys),
            root: &root,
            environment: EnvironmentReportOptions::default(),
        };
        verify_extracted_payload(&resources.release, &options)
            .map_err(|error| error.to_string())?;
        attach_extracted_box(&resources.release, &options)
    } else {
        verify_and_extract_box(
            &resources.release,
            &PrepareOptions {
                trust: TrustAnchors::Keys(&keys),
                archive: Some(&resources.archive),
                destination: &root,
                environment: EnvironmentReportOptions::default(),
            },
        )
    }
    .map_err(|error| error.to_string())?;
    if prepared.box_id() != BOX_ID
        || prepared.runtime_id() != RUNTIME_ID
        || prepared.target_id() != target_id().unwrap_or_default()
    {
        return Err("The prepared box is not the Native Tools box for this host.".into());
    }
    prune_previous_boxes(prepared.root());
    let prepared_root = prepared.root().to_path_buf();
    *VERIFIED_ARCHIVE
        .lock()
        .map_err(|_| "Native Tools archive verification lock poisoned")? = Some(digest);
    *prepared_in_process = Some(prepared_root.to_string_lossy().to_string());
    Ok(prepared_root)
}

/// Old box versions are removed only after a complete verified box has been
/// prepared in this fresh application process.
#[cfg(not(target_os = "windows"))]
fn prune_previous_boxes(current: &Path) {
    let Some(parent) = current.parent() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_digest = name.len() == 64
            && name
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if path != current && is_digest {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod wsl_plan {
    use super::ResolvedCommand;
    use crate::helpers::wsl::{is_mappable_windows_path, wsl_command_args};

    pub(super) fn path_argument_positions(args: &[String]) -> Vec<usize> {
        args.iter()
            .enumerate()
            .filter(|(_, value)| is_mappable_windows_path(value))
            .map(|(index, _)| index)
            .collect()
    }

    pub(super) fn reject_unreachable_paths(args: &[String]) -> Result<(), String> {
        match args.iter().find(|value| value.starts_with(r"\\")) {
            None => Ok(()),
            Some(argument) => Err(format!(
                "Liatir cannot open files from a network location on Windows: {argument}\n\
                 Copy the file to a drive on this computer, such as C:, and run the tool again."
            )),
        }
    }

    pub(super) fn substitute_mapped_paths(
        args: &[String],
        positions: &[usize],
        mapped: &[String],
    ) -> Result<Vec<String>, String> {
        if positions.len() != mapped.len() {
            return Err("WSL2 returned a different number of paths than were sent.".into());
        }
        let mut result = args.to_vec();
        for (slot, index) in positions.iter().enumerate() {
            result[*index] = mapped[slot].clone();
        }
        Ok(result)
    }

    /// simpleaf's configuration directory inside WSL2, beside the extracted boxes.
    ///
    /// The Linux mirror of [`super::simpleaf_home`]: the consumer prepares the box at
    /// `<parent>/<digest>`, so the sibling directory is Liatir's and is writable by the same
    /// user that runs the tools.
    pub(super) fn simpleaf_home(prefix: &str) -> String {
        match prefix.rsplit_once('/') {
            Some((parent, _)) if !parent.is_empty() => {
                format!("{parent}/{}", super::SIMPLEAF_HOME_DIR)
            }
            _ => format!("{prefix}/{}", super::SIMPLEAF_HOME_DIR),
        }
    }

    pub(super) fn tool_command(
        distribution: &str,
        prefix: &str,
        cmd: &str,
        args: &[String],
    ) -> ResolvedCommand {
        let mut command = vec![
            "/usr/bin/env".into(),
            format!("LD_LIBRARY_PATH={prefix}/venv/lib"),
            // simpleaf launches piscem and alevin-fry by name; both are in the box beside it.
            format!("PATH={prefix}/venv/bin:/usr/bin:/bin"),
            format!(
                "{}={}",
                super::SIMPLEAF_HOME_VARIABLE,
                simpleaf_home(prefix)
            ),
            format!("{prefix}/venv/bin/{cmd}"),
        ];
        command.extend(args.iter().cloned());
        ResolvedCommand {
            program: "wsl.exe".into(),
            args: wsl_command_args(Some(distribution), &command),
            environment: Vec::new(),
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{
        resources, signed_archive_digest, verify_platform_resources, PREPARED_BOX, SIMPLEAF_HOME,
        VERIFIED_ARCHIVE,
    };
    use crate::helpers::wsl::{
        combined_output, map_host_paths_to_wsl, run_wsl, valid_wsl_distribution,
    };
    use tauri::AppHandle;

    pub(super) fn distribution() -> Result<String, String> {
        if let Ok(pinned) = std::env::var("LIATIR_WSL_DISTRIBUTION") {
            let pinned = pinned.trim().to_string();
            if !pinned.is_empty() {
                if !valid_wsl_distribution(&pinned) {
                    return Err("LIATIR_WSL_DISTRIBUTION contains unsupported characters.".into());
                }
                return Ok(pinned);
            }
        }
        let output = run_wsl(
            None,
            &[
                "/bin/sh".into(),
                "-c".into(),
                "printf '%s' \"$WSL_DISTRO_NAME\"".into(),
            ],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Liatir needs WSL2 to run its bioinformatics tools on Windows, and could not start it: {}",
                combined_output(&output)
            ));
        }
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !valid_wsl_distribution(&name) {
            return Err(
                "WSL2 is installed but did not report a usable default distribution.".into(),
            );
        }
        Ok(name)
    }

    pub(super) fn ensure_prepared(app: &AppHandle, distribution: &str) -> Result<String, String> {
        let mut prepared_in_process = PREPARED_BOX
            .lock()
            .map_err(|_| "Native Tools preparation lock poisoned")?;
        if let Some(root) = prepared_in_process.as_ref() {
            return Ok(root.clone());
        }
        let resources = resources(app)
            .ok_or("The bundled Native Tools Scrollcase box is missing from this installation.")?;
        verify_platform_resources(&resources)?;
        let digest = signed_archive_digest(&resources)?;
        let mapped = map_host_paths_to_wsl(
            distribution,
            &[
                resources.wsl_consumer.to_string_lossy().to_string(),
                resources.release.to_string_lossy().to_string(),
                resources.trusted_key.to_string_lossy().to_string(),
                resources.archive.to_string_lossy().to_string(),
            ],
        )?;
        let output = run_wsl(
            Some(distribution),
            &[
                mapped[0].clone(),
                mapped[1].clone(),
                mapped[2].clone(),
                mapped[3].clone(),
                digest,
            ],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Liatir could not prepare its Native Tools Scrollcase box inside WSL2: {}",
                combined_output(&output)
            ));
        }
        let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !prefix.starts_with('/') {
            return Err("WSL2 did not report where the Native Tools box was prepared.".into());
        }
        *VERIFIED_ARCHIVE
            .lock()
            .map_err(|_| "Native Tools archive verification lock poisoned")? = Some(digest);
        *prepared_in_process = Some(prefix.clone());
        Ok(prefix)
    }

    /// Point simpleaf at the engines inside *this* box, once per application run.
    ///
    /// The WSL2 half of [`super::ensure_simpleaf_home`], and stale for the same reason: the
    /// recorded paths name one box root, which a shipped upgrade replaces.
    pub(super) fn ensure_simpleaf_home(distribution: &str, prefix: &str) -> Result<(), String> {
        let mut recorded = SIMPLEAF_HOME
            .lock()
            .map_err(|_| "simpleaf configuration lock poisoned")?;
        let home = super::wsl_plan::simpleaf_home(prefix);
        if recorded.as_ref().map(|path| path.to_string_lossy().to_string()).as_deref() == Some(home.as_str()) {
            return Ok(());
        }
        let output = run_wsl(
            Some(distribution),
            &[
                "/bin/sh".into(),
                "-c".into(),
                format!(
                    "mkdir -p '{home}' && LD_LIBRARY_PATH='{prefix}/venv/lib' PATH='{prefix}/venv/bin:/usr/bin:/bin' {}='{home}' '{prefix}/venv/bin/simpleaf' set-paths",
                    super::SIMPLEAF_HOME_VARIABLE
                ),
            ],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Liatir could not configure simpleaf inside WSL2: {}",
                combined_output(&output)
            ));
        }
        *recorded = Some(std::path::PathBuf::from(home));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_only_the_tools_the_box_actually_builds() {
        assert!(is_bundled_tool("samtools"));
        assert!(is_bundled_tool("bwa"));
        assert!(is_bundled_tool("simpleaf"));
        assert!(is_bundled_tool("alevin-fry"));
        // FastQC runs as WASM in-process and SnpEff is a Java runtime.
        assert!(!is_bundled_tool("fastqc"));
        assert!(!is_bundled_tool("snpeff"));
        assert!(!is_bundled_tool("java"));
        assert!(!is_bundled_tool("nextflow"));
        // piscem is in the box, as simpleaf's mapping engine — never launched on its own.
        assert!(!is_bundled_tool("piscem"));
    }

    #[test]
    fn keeps_simpleaf_configuration_beside_the_boxes_rather_than_inside_one() {
        let root = Path::new("/data/native-tools/abcdef");
        assert_eq!(
            simpleaf_home(root),
            Path::new("/data/native-tools/simpleaf-home"),
        );
        assert_eq!(
            wsl_plan::simpleaf_home("/home/bio/.local/share/liatir/native-tools/abcdef"),
            "/home/bio/.local/share/liatir/native-tools/simpleaf-home",
        );
        // The box environment carries it, so every simpleaf invocation finds its engines.
        assert!(native_environment(root)
            .iter()
            .any(|(name, value)| name == "ALEVIN_FRY_HOME"
                && value == "/data/native-tools/simpleaf-home"));
    }

    #[test]
    fn translates_the_file_arguments_and_nothing_else() {
        let args: Vec<String> = ["mem", "-t", "8", r"C:\bio\ref.fa", r"C:\bio\R1.fastq"]
            .iter()
            .map(|value| value.to_string())
            .collect();
        let positions = wsl_plan::path_argument_positions(&args);
        assert_eq!(positions, vec![3, 4]);
        let mapped = vec![
            "/mnt/c/bio/ref.fa".to_string(),
            "/mnt/c/bio/R1.fastq".to_string(),
        ];
        let translated = wsl_plan::substitute_mapped_paths(&args, &positions, &mapped).unwrap();
        assert_eq!(
            translated,
            vec!["mem", "-t", "8", "/mnt/c/bio/ref.fa", "/mnt/c/bio/R1.fastq"],
        );
    }

    #[test]
    fn refuses_a_network_location_liatir_cannot_reach() {
        let args = vec![
            "stats".to_string(),
            r"\\server\share\reads.fastq".to_string(),
        ];
        let error = wsl_plan::reject_unreachable_paths(&args).unwrap_err();
        assert!(error.contains(r"\\server\share\reads.fastq"));
        assert!(error.contains("Copy the file to a drive on this computer"));
        assert!(wsl_plan::reject_unreachable_paths(&[r"\\?\C:\bio\ref.fa".to_string()]).is_err());
    }

    #[test]
    fn leaves_a_filter_expression_alone() {
        let args: Vec<String> = ["view", "-i", "QUAL>20 && DP>10", r"C:\bio\calls.vcf"]
            .iter()
            .map(|value| value.to_string())
            .collect();
        assert_eq!(wsl_plan::path_argument_positions(&args), vec![3]);
    }

    #[test]
    fn refuses_a_mapping_that_does_not_line_up_with_what_was_sent() {
        let args = vec![r"C:\a".to_string(), r"C:\b".to_string()];
        let positions = wsl_plan::path_argument_positions(&args);
        assert!(
            wsl_plan::substitute_mapped_paths(&args, &positions, &["/mnt/c/a".into()]).is_err()
        );
    }

    #[test]
    fn runs_the_tool_from_the_scrollcase_payload_inside_the_distribution() {
        let command = wsl_plan::tool_command(
            "Ubuntu-24.04",
            "/home/bio/.local/share/liatir/native-tools/abc",
            "samtools",
            &["sort".to_string(), "/mnt/c/bio/reads.bam".to_string()],
        );
        assert_eq!(command.program, "wsl.exe");
        assert_eq!(
            command.args,
            vec![
                "--distribution",
                "Ubuntu-24.04",
                "--exec",
                "/usr/bin/env",
                "LD_LIBRARY_PATH=/home/bio/.local/share/liatir/native-tools/abc/venv/lib",
                "PATH=/home/bio/.local/share/liatir/native-tools/abc/venv/bin:/usr/bin:/bin",
                "ALEVIN_FRY_HOME=/home/bio/.local/share/liatir/native-tools/simpleaf-home",
                "/home/bio/.local/share/liatir/native-tools/abc/venv/bin/samtools",
                "sort",
                "/mnt/c/bio/reads.bam",
            ],
        );
    }

    #[test]
    fn ships_the_linux_box_to_windows_and_a_native_box_elsewhere() {
        assert_eq!(
            target_id().is_some(),
            matches!(
                (std::env::consts::OS, std::env::consts::ARCH),
                ("macos", "aarch64") | ("linux", "x86_64") | ("windows", "x86_64"),
            )
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn rust_consumer_prepares_and_runs_the_built_box_when_present() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let Some(target) = target_id() else { return };
        let resource_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native-tools");
        let stem = format!("native-tools-{target}");
        let release = resource_root.join(format!("{stem}.release.json"));
        let archive = resource_root.join(format!("{stem}.zip"));
        if !release.is_file() || !archive.is_file() {
            return;
        }
        let keys = trusted_keys().expect("compiled Native Tools trust");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("liatir-native-tools-test-{unique}"));
        let prepared = verify_and_extract_box(
            &release,
            &PrepareOptions {
                trust: TrustAnchors::Keys(&keys),
                archive: Some(&archive),
                destination: &root,
                environment: EnvironmentReportOptions::default(),
            },
        )
        .expect("Rust Scrollcase preparation");
        let binary = prepared.root().join("venv/bin/seqkit");
        let output = std::process::Command::new(binary)
            .arg("version")
            .envs(native_environment(prepared.root()))
            .output()
            .expect("run SeqKit from prepared Scrollcase box");
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.status.success(), "{combined}");
        assert!(combined.contains("2.13.0"), "{combined}");
        std::fs::remove_dir_all(root).expect("remove test-owned prepared box");
    }
}
