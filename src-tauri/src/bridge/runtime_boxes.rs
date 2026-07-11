use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::AppHandle;
use url::Url;
use uuid::Uuid;

use super::{
    app_storage::{resolve_app_path, write_text_atomic},
    managed_bins::{extract_zip, stream_download, DownloadRegistry},
    python_env::env_dir,
};

const AI_RUNTIME_ROOT: &str = "ai-runtimes";
const MAX_CONTROL_DOCUMENT_BYTES: usize = 1024 * 1024;
const DEVELOPMENT_TRUST_KEY: &str =
    include_str!("../../../runtime-boxes/trust/development-public.json");

static ACTIVE_INSTALLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustedKey {
    key_id: String,
    public_key_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedDocument {
    schema_version: u32,
    payload_encoding: String,
    payload_base64: String,
    payload_sha256: String,
    signatures: Vec<DocumentSignature>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSignature {
    algorithm: String,
    key_id: String,
    signature_base64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxTarget {
    platform: String,
    arch: String,
    accelerator: String,
    cuda_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelManifest {
    schema_version: u32,
    kind: String,
    channel: String,
    box_id: String,
    target: RuntimeBoxTarget,
    cohort_salt: String,
    releases: Vec<ChannelRelease>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelRelease {
    version: String,
    release_manifest_url: String,
    rollout_percentage: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    schema_version: u32,
    kind: String,
    box_id: String,
    model_id: String,
    runtime_id: String,
    version: String,
    target: RuntimeBoxTarget,
    compatibility: RuntimeBoxCompatibility,
    archive: RuntimeBoxArchive,
    python_entry_point: String,
    model_cache_subdir: String,
    self_test: RuntimeBoxSelfTest,
    provenance: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxCompatibility {
    min_liatir_version: String,
    max_liatir_version_exclusive: Option<String>,
    min_macos_version: Option<String>,
    min_ram_gb: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxArchive {
    format: String,
    url: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxSelfTest {
    python_imports: Vec<String>,
    timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevocationsManifest {
    schema_version: u32,
    kind: String,
    revocations: Vec<RuntimeBoxRevocation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxRevocation {
    box_id: String,
    version: String,
    target: Option<RuntimeBoxTarget>,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedBoxMetadata {
    schema_version: u32,
    box_id: String,
    model_id: String,
    runtime_id: String,
    version: String,
    target: RuntimeBoxTarget,
    python_entry_point: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxInstallResult {
    runtime_id: String,
    runtime_dir: String,
    python_path: String,
    version: String,
    size_bytes: u64,
    rollback_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxRollbackResult {
    runtime_id: String,
    runtime_dir: String,
    restored: bool,
}

struct InstallGuard {
    runtime_id: String,
}

impl InstallGuard {
    fn acquire(runtime_id: &str) -> Result<Self, String> {
        let installs = ACTIVE_INSTALLS.get_or_init(|| Mutex::new(HashSet::new()));
        let mut active = installs.lock().map_err(|_| "runtime install state poisoned".to_string())?;
        if !active.insert(runtime_id.to_string()) {
            return Err(format!("AI Runtime Box installation is already active for {runtime_id}"));
        }
        Ok(Self {
            runtime_id: runtime_id.to_string(),
        })
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        if let Some(installs) = ACTIVE_INSTALLS.get() {
            if let Ok(mut active) = installs.lock() {
                active.remove(&self.runtime_id);
            }
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn trusted_keys() -> Result<Vec<TrustedKey>, String> {
    let mut keys = Vec::new();
    if cfg!(debug_assertions) {
        keys.push(serde_json::from_str(DEVELOPMENT_TRUST_KEY).map_err(|error| error.to_string())?);
        if let Ok(path) = std::env::var("LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE") {
            let raw = std::fs::read_to_string(&path)
                .map_err(|error| format!("cannot read debug Runtime Box trust key {path}: {error}"))?;
            keys.push(
                serde_json::from_str(&raw)
                    .map_err(|error| format!("invalid debug Runtime Box trust key: {error}"))?,
            );
        }
    }
    if let Some(raw) = option_env!("LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON") {
        let mut production: Vec<TrustedKey> =
            serde_json::from_str(raw).map_err(|error| format!("invalid production Runtime Box trust keys: {error}"))?;
        keys.append(&mut production);
    }
    if keys.is_empty() {
        return Err("This Liatir build has no trusted AI Runtime Box signing keys".to_string());
    }
    Ok(keys)
}

fn verify_signed_payload<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, String> {
    let document: SignedDocument = serde_json::from_slice(bytes)
        .map_err(|error| format!("invalid signed Runtime Box document: {error}"))?;
    if document.schema_version != 1 || document.payload_encoding != "base64-json-utf8" {
        return Err("unsupported signed Runtime Box document".to_string());
    }
    let payload = BASE64
        .decode(document.payload_base64)
        .map_err(|error| format!("invalid signed payload encoding: {error}"))?;
    if sha256_hex(&payload) != document.payload_sha256.to_lowercase() {
        return Err("signed Runtime Box payload checksum mismatch".to_string());
    }
    let keys = trusted_keys()?;
    let mut verified = false;
    for document_signature in document.signatures {
        if document_signature.algorithm != "ed25519" {
            continue;
        }
        let Some(key) = keys.iter().find(|candidate| candidate.key_id == document_signature.key_id) else {
            continue;
        };
        let public_bytes = BASE64
            .decode(&key.public_key_base64)
            .map_err(|error| format!("invalid trusted public key: {error}"))?;
        let public_array: [u8; 32] = public_bytes
            .try_into()
            .map_err(|_| "trusted Ed25519 public key must contain 32 bytes".to_string())?;
        let verifying_key = VerifyingKey::from_bytes(&public_array).map_err(|error| error.to_string())?;
        let signature_bytes = BASE64
            .decode(&document_signature.signature_base64)
            .map_err(|error| format!("invalid Runtime Box signature encoding: {error}"))?;
        let signature = Signature::from_slice(&signature_bytes).map_err(|error| error.to_string())?;
        if verifying_key.verify(&payload, &signature).is_ok() {
            verified = true;
            break;
        }
    }
    if !verified {
        return Err("AI Runtime Box document is not signed by a trusted Liatir key".to_string());
    }
    serde_json::from_slice(&payload).map_err(|error| format!("invalid signed Runtime Box payload: {error}"))
}

fn validate_control_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("invalid Runtime Box URL: {error}"))?;
    if url.scheme() == "https" {
        return Ok(url);
    }
    if cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
    {
        return Ok(url);
    }
    Err("AI Runtime Box URLs must use HTTPS; debug builds also allow loopback HTTP".to_string())
}

async fn fetch_control_document(url: &str) -> Result<Option<Vec<u8>>, String> {
    validate_control_url(url)?;
    let response = reqwest::Client::builder()
        .user_agent("Liatir Runtime Box/1")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Runtime Box registry request failed: {error}"))?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("Runtime Box registry returned HTTP {}", response.status()));
    }
    if response.content_length().unwrap_or(0) > MAX_CONTROL_DOCUMENT_BYTES as u64 {
        return Err("Runtime Box control document exceeds the size limit".to_string());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_CONTROL_DOCUMENT_BYTES {
        return Err("Runtime Box control document exceeds the size limit".to_string());
    }
    Ok(Some(bytes.to_vec()))
}

fn current_target() -> RuntimeBoxTarget {
    RuntimeBoxTarget {
        platform: match std::env::consts::OS {
            "macos" => "macos".to_string(),
            value => value.to_string(),
        },
        arch: match std::env::consts::ARCH {
            "aarch64" => "aarch64".to_string(),
            value => value.to_string(),
        },
        accelerator: if cfg!(target_os = "macos") {
            "metal".to_string()
        } else {
            "cpu".to_string()
        },
        cuda_version: None,
    }
}

fn target_id(target: &RuntimeBoxTarget) -> String {
    let cuda = target
        .cuda_version
        .as_ref()
        .map(|version| format!("-cuda{version}"))
        .unwrap_or_default();
    format!("{}-{}-{}{}", target.platform, target.arch, target.accelerator, cuda)
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() {
        return Err("Runtime Box path cannot be empty".to_string());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("Runtime Box path must be relative: {value}"));
    }
    if path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err(format!("unsafe Runtime Box path: {value}"));
    }
    Ok(path.to_path_buf())
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .chain(std::iter::repeat(0))
        .take(3)
        .collect()
}

fn check_compatibility(compatibility: &RuntimeBoxCompatibility) -> Result<(), String> {
    let app = version_parts(env!("CARGO_PKG_VERSION"));
    if app < version_parts(&compatibility.min_liatir_version) {
        return Err(format!(
            "This AI Runtime Box requires Liatir {} or newer",
            compatibility.min_liatir_version
        ));
    }
    if let Some(maximum) = compatibility.max_liatir_version_exclusive.as_deref() {
        if app >= version_parts(maximum) {
            return Err(format!("This AI Runtime Box requires a Liatir version older than {maximum}"));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(minimum) = compatibility.min_macos_version.as_deref() {
        let installed = Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string());
        if installed.as_deref().map(version_parts).is_some_and(|version| version < version_parts(minimum)) {
            return Err(format!("This AI Runtime Box requires macOS {minimum} or newer"));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(minimum_gb) = compatibility.min_ram_gb {
        let installed_bytes = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8_lossy(&output.stdout).trim().parse::<u64>().ok());
        if installed_bytes.is_some_and(|bytes| bytes < minimum_gb * 1024 * 1024 * 1024) {
            return Err(format!("This AI Runtime Box requires at least {minimum_gb} GB of memory"));
        }
    }
    Ok(())
}

fn installation_id(app: &AppHandle) -> Result<String, String> {
    let path = resolve_app_path(app, "runtime-box-installation-id")?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let id = Uuid::new_v4().to_string();
    write_text_atomic(&path, &format!("{id}\n"))?;
    Ok(id)
}

fn select_channel_release<'a>(
    manifest: &'a ChannelManifest,
    installation_id: &str,
) -> Result<&'a ChannelRelease, String> {
    for release in &manifest.releases {
        if release.rollout_percentage == 0 || release.rollout_percentage > 100 {
            return Err("Runtime Box channel contains an invalid rollout percentage".to_string());
        }
        let cohort = Sha256::digest(format!(
            "{}:{installation_id}:{}",
            manifest.cohort_salt, release.version
        ));
        if (u16::from_be_bytes([cohort[0], cohort[1]]) % 100) < release.rollout_percentage as u16 {
            return Ok(release);
        }
    }
    Err("No AI Runtime Box release is assigned to this installation".to_string())
}

fn verify_release_identity(
    release: &ReleaseManifest,
    box_id: &str,
    model_id: &str,
    target: &RuntimeBoxTarget,
) -> Result<(), String> {
    if release.schema_version != 1 || release.kind != "liatir.runtime-box.release" {
        return Err("invalid AI Runtime Box release manifest".to_string());
    }
    if release.box_id != box_id || release.model_id != model_id {
        return Err("AI Runtime Box release identity does not match the requested model".to_string());
    }
    if &release.target != target {
        return Err(format!(
            "AI Runtime Box target {} does not match this host {}",
            target_id(&release.target),
            target_id(target)
        ));
    }
    if release.archive.format != "zip"
        || release.archive.sha256.len() != 64
        || release.archive.size_bytes == 0
    {
        return Err("invalid AI Runtime Box archive metadata".to_string());
    }
    validate_control_url(&release.archive.url)?;
    safe_relative_path(&release.python_entry_point)?;
    safe_relative_path(&release.model_cache_subdir)?;
    if release.self_test.python_imports.is_empty()
        || release.self_test.python_imports.iter().any(|name| {
            name.is_empty()
                || !name
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '.')
        })
    {
        return Err("invalid AI Runtime Box self-test imports".to_string());
    }
    check_compatibility(&release.compatibility)
}

async fn ensure_not_revoked(
    registry_base_url: &str,
    release: &ReleaseManifest,
) -> Result<(), String> {
    let url = format!("{}/revocations", registry_base_url.trim_end_matches('/'));
    let Some(bytes) = fetch_control_document(&url).await? else {
        return Ok(());
    };
    let manifest: RevocationsManifest = verify_signed_payload(&bytes)?;
    if manifest.schema_version != 1 || manifest.kind != "liatir.runtime-box.revocations" {
        return Err("invalid AI Runtime Box revocation document".to_string());
    }
    if let Some(revocation) = manifest.revocations.into_iter().find(|item| {
        item.box_id == release.box_id
            && item.version == release.version
            && item.target.as_ref().is_none_or(|target| target == &release.target)
    }) {
        return Err(format!(
            "AI Runtime Box {} {} was revoked: {}",
            release.box_id, release.version, revocation.reason
        ));
    }
    Ok(())
}

fn validate_extracted_box(staging: &Path, release: &ReleaseManifest) -> Result<PathBuf, String> {
    let metadata_path = staging.join("box.json");
    let metadata: ExtractedBoxMetadata = serde_json::from_slice(
        &std::fs::read(&metadata_path)
            .map_err(|error| format!("cannot read extracted box.json: {error}"))?,
    )
    .map_err(|error| format!("invalid extracted box.json: {error}"))?;
    if metadata.schema_version != 1
        || metadata.box_id != release.box_id
        || metadata.model_id != release.model_id
        || metadata.runtime_id != release.runtime_id
        || metadata.version != release.version
        || metadata.target != release.target
        || metadata.python_entry_point != release.python_entry_point
    {
        return Err("extracted AI Runtime Box metadata does not match the signed release".to_string());
    }
    let python_path = staging.join(safe_relative_path(&release.python_entry_point)?);
    if !python_path.is_file() {
        return Err(format!("AI Runtime Box interpreter is missing: {}", python_path.display()));
    }
    Ok(python_path)
}

fn run_self_test(python_path: &Path, self_test: &RuntimeBoxSelfTest) -> Result<(), String> {
    let script = self_test
        .python_imports
        .iter()
        .map(|name| format!("import {name}"))
        .collect::<Vec<_>>()
        .join("; ");
    let mut child = Command::new(python_path)
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("cannot start AI Runtime Box self-test: {error}"))?;
    let started = Instant::now();
    let timeout = Duration::from_secs(self_test.timeout_seconds.clamp(10, 600));
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => {
                return Err(format!("AI Runtime Box self-test failed with status {status}"));
            }
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "AI Runtime Box self-test timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        }
    }
    Ok(total)
}

fn rollback_root(runtime_parent: &Path, runtime_id: &str) -> PathBuf {
    runtime_parent.join(".runtime-box-rollback").join(runtime_id)
}

fn newest_rollback(root: &Path) -> Result<Option<PathBuf>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let mut candidates = std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    Ok(candidates.pop())
}

fn prune_rollbacks(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let mut candidates = std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    while candidates.len() > 1 {
        let oldest = candidates.remove(0);
        std::fs::remove_dir_all(oldest).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn activate_runtime(
    runtime_dir: &Path,
    staging: &Path,
    release: &ReleaseManifest,
) -> Result<bool, String> {
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    let rollback = rollback_root(parent, &release.runtime_id);
    std::fs::create_dir_all(&rollback).map_err(|error| error.to_string())?;
    let backup = rollback.join(format!("{}-{}", release.version, Uuid::new_v4()));
    let had_previous = runtime_dir.exists();
    if had_previous {
        std::fs::rename(runtime_dir, &backup)
            .map_err(|error| format!("cannot stage previous AI runtime for rollback: {error}"))?;
    }
    if let Err(error) = std::fs::rename(staging, runtime_dir) {
        if had_previous {
            let _ = std::fs::rename(&backup, runtime_dir);
        }
        return Err(format!("cannot activate AI Runtime Box: {error}"));
    }
    prune_rollbacks(&rollback)?;
    Ok(had_previous)
}

#[tauri::command]
pub async fn lia_ai_runtime_box_install(
    app: AppHandle,
    downloads: tauri::State<'_, DownloadRegistry>,
    box_id: String,
    model_id: String,
    channel: String,
    registry_base_url: String,
    download_id: String,
) -> Result<RuntimeBoxInstallResult, String> {
    if download_id.is_empty()
        || download_id.len() > 160
        || !download_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("invalid AI Runtime Box download id".to_string());
    }
    let registry_base_url = if cfg!(debug_assertions) {
        std::env::var("LIATIR_RUNTIME_BOX_REGISTRY_URL").unwrap_or(registry_base_url)
    } else {
        registry_base_url
    };
    validate_control_url(&registry_base_url)?;
    let target = current_target();
    let channel_url = format!(
        "{}/channels/{}/{}/{}",
        registry_base_url.trim_end_matches('/'),
        channel,
        box_id,
        target_id(&target)
    );
    let channel_bytes = fetch_control_document(&channel_url)
        .await?
        .ok_or_else(|| format!("No {channel} AI Runtime Box is available for {}", target_id(&target)))?;
    let channel_manifest: ChannelManifest = verify_signed_payload(&channel_bytes)?;
    if channel_manifest.schema_version != 1
        || channel_manifest.kind != "liatir.runtime-box.channel"
        || channel_manifest.channel != channel
        || channel_manifest.box_id != box_id
        || channel_manifest.target != target
    {
        return Err("AI Runtime Box channel does not match this request and host".to_string());
    }
    let selected = select_channel_release(&channel_manifest, &installation_id(&app)?)?;
    let release_bytes = fetch_control_document(&selected.release_manifest_url)
        .await?
        .ok_or_else(|| "AI Runtime Box release manifest was not found".to_string())?;
    let release: ReleaseManifest = verify_signed_payload(&release_bytes)?;
    verify_release_identity(&release, &box_id, &model_id, &target)?;
    if release.version != selected.version {
        return Err("AI Runtime Box release version does not match its signed channel".to_string());
    }
    ensure_not_revoked(&registry_base_url, &release).await?;
    let _install_guard = InstallGuard::acquire(&release.runtime_id)?;

    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &release.runtime_id)?;
    let runtime_parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    std::fs::create_dir_all(runtime_parent).map_err(|error| error.to_string())?;
    let downloads_dir = runtime_parent.join(".runtime-box-downloads");
    std::fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let archive_path = downloads_dir.join(format!(
        "{}-{}-{}.zip",
        release.box_id, release.version, release.archive.sha256
    ));
    let cancellation = downloads.register(&download_id);
    let download_result = stream_download(
        &app,
        &download_id,
        &release.archive.url,
        &archive_path.to_string_lossy(),
        Some(&release.archive.sha256),
        &cancellation,
    )
    .await;
    downloads.unregister(&download_id);
    download_result?;
    if std::fs::metadata(&archive_path)
        .map_err(|error| error.to_string())?
        .len()
        != release.archive.size_bytes
    {
        let _ = std::fs::remove_file(&archive_path);
        return Err("AI Runtime Box archive size does not match the signed release".to_string());
    }

    let staging = runtime_parent.join(format!(".{}.{}.staging", release.runtime_id, Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let install_result = (|| -> Result<RuntimeBoxInstallResult, String> {
        extract_zip(&archive_path.to_string_lossy(), &staging.to_string_lossy())?;
        let python_path = validate_extracted_box(&staging, &release)?;
        run_self_test(&python_path, &release.self_test)?;
        write_text_atomic(
            &staging.join("runtime-box-activation.json"),
            &format!("{}\n", serde_json::to_string_pretty(&release).map_err(|error| error.to_string())?),
        )?;
        let size_bytes = dir_size(&staging)?;
        let rollback_available = activate_runtime(&runtime_dir, &staging, &release)?;
        Ok(RuntimeBoxInstallResult {
            runtime_id: release.runtime_id.clone(),
            runtime_dir: runtime_dir.to_string_lossy().to_string(),
            python_path: runtime_dir
                .join(safe_relative_path(&release.python_entry_point)?)
                .to_string_lossy()
                .to_string(),
            version: release.version.clone(),
            size_bytes,
            rollback_available,
        })
    })();
    if install_result.is_err() && staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    if install_result.is_ok() {
        let _ = std::fs::remove_file(&archive_path);
    }
    install_result
}

#[tauri::command]
pub async fn lia_ai_runtime_box_rollback(
    app: AppHandle,
    runtime_id: String,
) -> Result<RuntimeBoxRollbackResult, String> {
    let _install_guard = InstallGuard::acquire(&runtime_id)?;
    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &runtime_id)?;
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    let root = rollback_root(parent, &runtime_id);
    let Some(previous) = newest_rollback(&root)? else {
        return Ok(RuntimeBoxRollbackResult {
            runtime_id,
            runtime_dir: runtime_dir.to_string_lossy().to_string(),
            restored: false,
        });
    };
    let failed = parent.join(format!(".{runtime_id}.{}.failed", Uuid::new_v4()));
    if runtime_dir.exists() {
        std::fs::rename(&runtime_dir, &failed).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&previous, &runtime_dir) {
        if failed.exists() {
            let _ = std::fs::rename(&failed, &runtime_dir);
        }
        return Err(format!("cannot roll back AI Runtime Box: {error}"));
    }
    if failed.exists() {
        let _ = std::fs::remove_dir_all(failed);
    }
    Ok(RuntimeBoxRollbackResult {
        runtime_id,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        restored: true,
    })
}

#[tauri::command]
pub async fn lia_ai_runtime_box_remove(
    app: AppHandle,
    runtime_id: String,
    box_id: String,
) -> Result<bool, String> {
    let _install_guard = InstallGuard::acquire(&runtime_id)?;
    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &runtime_id)?;
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    if runtime_dir.exists() {
        std::fs::remove_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    }
    let rollback = rollback_root(parent, &runtime_id);
    if rollback.exists() {
        std::fs::remove_dir_all(rollback).map_err(|error| error.to_string())?;
    }
    let downloads = parent.join(".runtime-box-downloads");
    if downloads.is_dir() {
        for entry in std::fs::read_dir(&downloads).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            let matches_box = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&format!("{box_id}-")));
            if matches_box && path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(true)
}
