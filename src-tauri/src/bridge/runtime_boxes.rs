//! Installation, activation and rollback of AI Runtime Boxes.
//!
//! An AI Runtime Box is a self-contained, pre-built Python environment (interpreter +
//! wheels + model glue) shipped as a zip archive, so heavy AI dependencies are installed
//! only when the user actually needs them instead of being bundled into the app.
//!
//! Nothing is trusted by default. The install path is a chain of checks where every step
//! must agree with the previous one:
//!
//! 1. fetch the *channel* document for `(box_id, host target)` — a signed list of releases;
//! 2. verify its Ed25519 signature against the keys compiled into this build;
//! 3. pick one release deterministically from the rollout percentages (staged rollout);
//! 4. fetch and verify the *release manifest*, then check it matches the request, the host
//!    and this Liatir version, and that it has not been revoked;
//! 5. download the archive and verify its SHA-256 and byte size against the signed manifest;
//! 6. extract into a staging directory and check the archive's own `box.json` still matches
//!    the signed release — this binds the archive *content* to the signed metadata;
//! 7. run a self-test (import the declared Python modules) with the box's own interpreter;
//! 8. only then swap staging into place, keeping the previous version for rollback.
//!
//! Activation is a directory rename, so a box is never observed half-installed: it is either
//! the old version or the new one.

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
    managed_bins::{
        available_space_for_path, extract_zip_with_expected_size, format_bytes, sha256_of_file,
        stream_download, DownloadRegistry, DISK_SPACE_MARGIN_BYTES,
    },
    python_env::env_dir,
};

/// Parent directory (under the app-managed storage scope) holding one directory per runtime.
const AI_RUNTIME_ROOT: &str = "ai-runtimes";
/// Hard cap for channel/release/revocation documents, so a hostile or broken registry
/// cannot make the app buffer an unbounded response into memory.
const MAX_CONTROL_DOCUMENT_BYTES: usize = 1024 * 1024;
// Trust anchors are baked into the binary at compile time rather than read from disk:
// a key the user could edit would defeat the point of signing.
const PRODUCTION_TRUST_KEY: &str =
    include_str!("../../../runtime-boxes/trust/production-public.json");
const DEVELOPMENT_TRUST_KEY: &str =
    include_str!("../../../runtime-boxes/trust/development-public.json");

/// Runtime IDs with an install/rollback/remove currently in flight.
///
/// Guarded by [`InstallGuard`]. The set is keyed by runtime ID, so two *different* runtimes
/// can still be installed concurrently — only same-runtime overlap is rejected.
static ACTIVE_INSTALLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// One Ed25519 public key the app is willing to accept signatures from.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustedKey {
    key_id: String,
    public_key_base64: String,
}

/// Several trusted keys in one document, which is what makes key rotation possible:
/// old and new key can be trusted at the same time during a changeover.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustedKeyBundle {
    keys: Vec<TrustedKey>,
}

/// A trust file may hold either a bare key or a bundle; `untagged` lets both parse
/// without a discriminator field, so older single-key files keep working.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TrustedKeyDocument {
    Single(TrustedKey),
    Bundle(TrustedKeyBundle),
}

/// Signing envelope shared by every control document (channel, release, revocations).
///
/// The signatures are computed over the *decoded* payload bytes, not over this wrapper,
/// so the envelope can be re-encoded without invalidating them. `payload_sha256` is a
/// cheap integrity check; the signature is the actual authenticity check.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedDocument {
    schema_version: u32,
    payload_encoding: String,
    payload_base64: String,
    payload_sha256: String,
    /// Multiple signatures are allowed; the document is accepted if *any one* of them
    /// verifies against a trusted key (see [`verify_signed_payload`]).
    signatures: Vec<DocumentSignature>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSignature {
    algorithm: String,
    key_id: String,
    signature_base64: String,
}

/// The hardware/OS profile a box is built for. A box is only installable when this
/// matches the host exactly (see [`current_target`] and [`verify_release_identity`]).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxTarget {
    platform: String,
    arch: String,
    /// Compute backend the box was built against, e.g. `metal` on macOS or `cpu`.
    accelerator: String,
    cuda_version: Option<String>,
}

/// Signed index of which releases a channel (e.g. `stable`) currently offers for one
/// `(box_id, target)` pair. This is the entry point of an install.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelManifest {
    schema_version: u32,
    kind: String,
    channel: String,
    box_id: String,
    target: RuntimeBoxTarget,
    /// Mixed into the cohort hash so the same installation does not land in the same
    /// bucket for every box, and so a rollout can be reshuffled by changing the salt.
    cohort_salt: String,
    /// Evaluated in order — see [`select_channel_release`].
    releases: Vec<ChannelRelease>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelRelease {
    version: String,
    release_manifest_url: String,
    /// Share of installations that should receive this release, 1..=100.
    rollout_percentage: u8,
}

/// The signed description of one concrete build of a box: what it is, what it needs,
/// where the archive lives, and how to prove the archive is the right one.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    schema_version: u32,
    kind: String,
    box_id: String,
    model_id: String,
    /// Identifies the installed directory; also the key used to serialise installs.
    runtime_id: String,
    version: String,
    target: RuntimeBoxTarget,
    compatibility: RuntimeBoxCompatibility,
    archive: RuntimeBoxArchive,
    /// Exact logical payload size before activation metadata and self-test caches are added.
    /// Optional so manifests published before this field was introduced remain installable.
    installed_size_bytes: Option<u64>,
    /// Path of the Python interpreter *inside* the archive, relative to its root.
    python_entry_point: String,
    model_cache_subdir: String,
    self_test: RuntimeBoxSelfTest,
    /// Build provenance kept as opaque JSON: it is signed and persisted with the box
    /// for auditing, but this module never interprets it.
    provenance: serde_json::Value,
}

/// Host requirements checked before downloading anything, so an incompatible box fails
/// fast with a readable message instead of after a multi-gigabyte download.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxCompatibility {
    min_liatir_version: String,
    max_liatir_version_exclusive: Option<String>,
    min_macos_version: Option<String>,
    min_ram_gb: Option<u64>,
}

/// Where the payload archive lives and what it must hash and weigh. Both `sha256` and
/// `size_bytes` come from the signed manifest and are enforced after download.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxArchive {
    format: String,
    url: String,
    sha256: String,
    size_bytes: u64,
}

/// Post-extraction smoke test: import these modules with the box's own interpreter.
/// A box that unpacks but cannot import its own dependencies never gets activated.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBoxSelfTest {
    python_imports: Vec<String>,
    timeout_seconds: u64,
}

/// Signed kill-list, letting a released box be withdrawn after the fact (e.g. because a
/// vulnerability or a broken build was discovered) without shipping a new app version.
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
    /// `None` revokes the version on every target; `Some` narrows it to one target.
    target: Option<RuntimeBoxTarget>,
    /// Surfaced verbatim to the user, so it should be human-readable.
    reason: String,
}

/// The `box.json` carried *inside* the archive. Compared field by field against the signed
/// release in [`validate_extracted_box`]: without it, a signed manifest could be paired with
/// a different (still correctly hashed) archive.
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

/// Returned to the frontend after a successful install.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxInstallResult {
    runtime_id: String,
    runtime_dir: String,
    /// Absolute path of the box's interpreter, ready to be spawned by the caller.
    python_path: String,
    version: String,
    size_bytes: u64,
    /// True when a previous version was displaced and can still be restored.
    rollback_available: bool,
}

/// Returned by a rollback. `restored` is `false` when there was simply nothing to roll
/// back to — that is a normal outcome, not an error.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxRollbackResult {
    runtime_id: String,
    runtime_dir: String,
    restored: bool,
}

/// RAII lock over one runtime ID.
///
/// Install, rollback and remove all mutate the same directory, so they must not overlap
/// for a given runtime. Holding the guard in a local binding means the ID is released on
/// [`Drop`] — including on early `?` returns and on panic.
struct InstallGuard {
    runtime_id: String,
}

impl InstallGuard {
    /// Claims `runtime_id`, or fails if another operation on it is already running.
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

/// Lowercase hex SHA-256, matching the encoding used in the manifests.
fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Collects every signing key this build accepts.
///
/// Production keys are always trusted. Debug builds additionally trust the development key
/// and, if `LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE` is set, a key file from disk — which is how
/// a locally signed box can be tested without touching the production trust anchor. Both of
/// those extra sources are behind `cfg!(debug_assertions)` and therefore cannot widen trust
/// in a release build.
fn trusted_keys() -> Result<Vec<TrustedKey>, String> {
    fn parse_keys(raw: &str) -> Result<Vec<TrustedKey>, String> {
        match serde_json::from_str(raw).map_err(|error| error.to_string())? {
            TrustedKeyDocument::Single(key) => Ok(vec![key]),
            TrustedKeyDocument::Bundle(bundle) => Ok(bundle.keys),
        }
    }

    let mut keys = parse_keys(PRODUCTION_TRUST_KEY)?;
    if cfg!(debug_assertions) {
        keys.append(&mut parse_keys(DEVELOPMENT_TRUST_KEY)?);
        if let Ok(path) = std::env::var("LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE") {
            let raw = std::fs::read_to_string(&path)
                .map_err(|error| format!("cannot read debug Runtime Box trust key {path}: {error}"))?;
            keys.append(&mut parse_keys(&raw)
                .map_err(|error| format!("invalid debug Runtime Box trust key: {error}"))?);
        }
    }
    // Extra production keys can be injected at *compile* time (option_env! reads the build
    // environment, not the runtime one), which is what makes key rotation possible without
    // editing the checked-in trust files.
    if let Some(raw) = option_env!("LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON") {
        let mut production: Vec<TrustedKey> =
            serde_json::from_str(raw).map_err(|error| format!("invalid production Runtime Box trust keys: {error}"))?;
        keys.append(&mut production);
    }
    // Fail closed: with no key at all every box would otherwise be unverifiable.
    if keys.is_empty() {
        return Err("This Liatir build has no trusted AI Runtime Box signing keys".to_string());
    }
    Ok(keys)
}

/// Verifies a signed control document and deserialises its payload into `T`.
///
/// The payload is checksummed first (cheap, catches corruption) and then must carry at least
/// one Ed25519 signature that verifies against a trusted key. Signatures with an unknown
/// algorithm or an unknown key ID are skipped rather than rejected, so a document signed by
/// both an old and a new key still validates on builds that only know one of them.
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
        // Unknown key ID: not necessarily an attack, just a key this build does not carry.
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
    // Only parsed once the bytes are proven authentic, so no attacker-controlled JSON is
    // ever fed to the typed deserialiser.
    serde_json::from_slice(&payload).map_err(|error| format!("invalid signed Runtime Box payload: {error}"))
}

/// Every URL the registry hands us (channel, release manifest, archive) goes through here.
///
/// HTTPS is required so manifests and archives cannot be swapped in transit. Debug builds
/// additionally accept loopback HTTP, which is what lets the local test registry work.
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

/// Downloads a small signed control document.
///
/// Returns `Ok(None)` on HTTP 404 so callers can distinguish "the registry says this does not
/// exist" from a transport failure — [`ensure_not_revoked`] relies on that to treat a missing
/// revocation list as "nothing revoked".
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
    // The size cap is applied twice on purpose: the advertised Content-Length lets us bail out
    // before reading the body, but it can be absent or simply wrong, so the real length is
    // checked again after buffering.
    if response.content_length().unwrap_or(0) > MAX_CONTROL_DOCUMENT_BYTES as u64 {
        return Err("Runtime Box control document exceeds the size limit".to_string());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_CONTROL_DOCUMENT_BYTES {
        return Err("Runtime Box control document exceeds the size limit".to_string());
    }
    Ok(Some(bytes.to_vec()))
}

/// Describes the machine we are running on, in the same shape the manifests use.
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
        // Only the macOS GPU backend is claimed today; every other host asks for a CPU box.
        // CUDA is consequently never requested, hence the `None` below.
        accelerator: if cfg!(target_os = "macos") {
            "metal".to_string()
        } else {
            "cpu".to_string()
        },
        cuda_version: None,
    }
}

/// Flattens a target into the slug used in registry URLs, e.g. `macos-aarch64-metal`.
fn target_id(target: &RuntimeBoxTarget) -> String {
    let cuda = target
        .cuda_version
        .as_ref()
        .map(|version| format!("-cuda{version}"))
        .unwrap_or_default();
    format!("{}-{}-{}{}", target.platform, target.arch, target.accelerator, cuda)
}

/// Rejects any path that could escape the directory it is joined onto.
///
/// Requiring every component to be `Component::Normal` rules out absolute paths, `..`
/// traversal, root and Windows prefixes in one check. Manifest-supplied paths (the interpreter
/// entry point, the model cache subdir) are joined onto the runtime directory, so without this
/// a malicious manifest could point anywhere on the filesystem.
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

/// Turns a version string into exactly three numbers so versions can be compared with `<`.
///
/// Splits on any non-digit and pads with zeros, so `1.2` becomes `[1, 2, 0]` and a trailing
/// pre-release tag is simply ignored. Anything unparseable degrades to `0` rather than erroring.
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

/// Checks the host against the manifest's requirements before any download starts.
///
/// The macOS and RAM probes shell out to `sw_vers` and `sysctl`. If a probe fails we cannot
/// conclude the host is unsuitable, so `is_some_and` lets the check pass rather than blocking
/// an install on a missing system tool — the requirement is only enforced when the host value
/// is actually known.
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

/// Stable random ID for this installation, created on first use and persisted.
///
/// It exists only to make staged rollouts deterministic: the same machine must keep landing in
/// the same cohort bucket across restarts, otherwise re-running an install could flip it onto a
/// different release.
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

/// Picks the release this installation is entitled to, implementing the staged rollout.
///
/// Hashing `(salt, installation id, version)` into a 0..99 bucket gives a decision that is
/// random across machines but fixed for any one machine, with no server round-trip. Releases
/// are tried in manifest order and the first whose bucket falls inside its percentage wins, so
/// the registry controls precedence by ordering (typically newest first, with a full-rollout
/// entry last as the fallback).
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
    // Reachable when no release is at 100%: this machine is simply not in any cohort yet.
    Err("No AI Runtime Box release is assigned to this installation".to_string())
}

/// Confirms a signed release actually is the thing we asked for, and that we can run it.
///
/// A valid signature only proves Liatir issued the manifest — not that it is the *right*
/// manifest. This re-checks it against the request (`box_id`, `model_id`), the host target and
/// the app version, and sanity-checks every field that later feeds a filesystem path, a URL or
/// a spawned command.
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
        || release.installed_size_bytes.is_some_and(|size| size == 0)
    {
        return Err("invalid AI Runtime Box archive metadata".to_string());
    }
    validate_control_url(&release.archive.url)?;
    safe_relative_path(&release.python_entry_point)?;
    safe_relative_path(&release.model_cache_subdir)?;
    // Import names are interpolated into a Python `-c` script, so restrict them to characters
    // that can only form a module path — no spaces, quotes or semicolons that could smuggle in
    // extra statements.
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

/// Fails the install if the chosen release appears on the signed revocation list.
///
/// A 404 means the registry publishes no revocations at all, which is treated as "nothing is
/// revoked". Note the consequence: the list is only consulted when it can be fetched, so this
/// blocks a *known-bad* box rather than guaranteeing freshness.
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
    // A revocation without a target applies to every target of that box version.
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

/// Cross-checks the unpacked archive against the signed release and returns its interpreter.
///
/// The download is already hash-verified, which proves the bytes are the ones the manifest
/// named. This proves the *contents* agree too: the archive's own `box.json` must describe the
/// same box, version and target, closing the gap where a correctly hashed archive is paired
/// with a manifest for something else. It also confirms the declared interpreter really exists
/// before anything is activated.
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

/// Runs the box's own interpreter and imports the modules the manifest declares.
///
/// This is the difference between "the zip unpacked" and "the environment actually works":
/// a truncated wheel or a native library built for the wrong architecture only shows up on
/// import. The child is polled instead of blocked on so a hung import can be killed once the
/// timeout (clamped to 10..=600s) expires.
fn run_self_test(python_path: &Path, self_test: &RuntimeBoxSelfTest) -> Result<(), String> {
    // Import names were restricted to module-path characters in verify_release_identity.
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

/// Total size of the installed box, reported to the UI. Symlinks are not followed, so linked
/// content is never counted twice (and a symlink loop cannot hang the walk).
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

#[derive(Debug, PartialEq, Eq)]
struct RuntimeBoxDiskPlan {
    archive_remaining_bytes: u64,
    installed_size_bytes: u64,
    current_runtime_bytes: u64,
    rollback_bytes: u64,
    peak_managed_bytes: u64,
    required_additional_bytes: u64,
}

/// Calculate peak disk use without double-counting files already present on the volume.
fn runtime_box_disk_plan(
    archive_size_bytes: u64,
    installed_size_bytes: u64,
    archive_bytes_on_disk: u64,
    current_runtime_bytes: u64,
    rollback_bytes: u64,
) -> RuntimeBoxDiskPlan {
    let archive_remaining_bytes = archive_size_bytes.saturating_sub(archive_bytes_on_disk);
    RuntimeBoxDiskPlan {
        archive_remaining_bytes,
        installed_size_bytes,
        current_runtime_bytes,
        rollback_bytes,
        peak_managed_bytes: current_runtime_bytes
            .saturating_add(rollback_bytes)
            .saturating_add(archive_size_bytes)
            .saturating_add(installed_size_bytes),
        required_additional_bytes: archive_remaining_bytes
            .saturating_add(installed_size_bytes)
            .saturating_add(DISK_SPACE_MARGIN_BYTES),
    }
}

fn existing_dir_size(path: &Path) -> Result<u64, String> {
    if path.is_dir() { dir_size(path) } else { Ok(0) }
}

fn validate_runtime_box_disk_plan(
    plan: &RuntimeBoxDiskPlan,
    available: u64,
) -> Result<(), String> {
    if available < plan.required_additional_bytes {
        return Err(format!(
            "Not enough disk space to install this AI Model: {} additional space is required, but only {} is free. The current runtime and rollback ({}) are preserved.",
            format_bytes(plan.required_additional_bytes),
            format_bytes(available),
            format_bytes(plan.current_runtime_bytes.saturating_add(plan.rollback_bytes)),
        ));
    }
    Ok(())
}

/// Fail before network transfer when the signed extracted size cannot fit beside the archive,
/// current runtime and retained rollback generation.
fn ensure_runtime_box_disk_space(
    runtime_parent: &Path,
    runtime_dir: &Path,
    rollback_dir: &Path,
    release: &ReleaseManifest,
    archive_bytes_on_disk: u64,
) -> Result<RuntimeBoxDiskPlan, String> {
    let installed_size_bytes = release
        .installed_size_bytes
        .ok_or_else(|| "signed installed size is unavailable".to_string())?;
    let plan = runtime_box_disk_plan(
        release.archive.size_bytes,
        installed_size_bytes,
        archive_bytes_on_disk,
        existing_dir_size(runtime_dir)?,
        existing_dir_size(rollback_dir)?,
    );
    let Some(available) = available_space_for_path(runtime_parent) else {
        return Ok(plan);
    };
    validate_runtime_box_disk_plan(&plan, available)?;
    Ok(plan)
}

/// Where a displaced version is parked. Kept as a dot-directory *beside* the runtime dirs, on
/// the same filesystem, so activation can be a rename rather than a copy.
fn rollback_root(runtime_parent: &Path, runtime_id: &str) -> PathBuf {
    runtime_parent.join(".runtime-box-rollback").join(runtime_id)
}

/// Most recently archived version, by modification time — the one a rollback restores.
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

/// Keeps only the newest archived version and deletes the rest.
///
/// Runtime boxes are large, so history is capped at one generation: enough to undo the install
/// that just happened, without letting old environments accumulate on disk.
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

/// Swaps the validated staging directory into place, archiving whatever was there.
///
/// Both steps are renames, which are atomic within a filesystem, so the runtime directory is
/// never seen partially written. If the second rename fails the first is undone, leaving the
/// previous version installed rather than no version at all.
///
/// Returns whether a previous version was displaced, which becomes `rollback_available`.
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
    // The UUID keeps the backup name unique even when the same version is reinstalled.
    let backup = rollback.join(format!("{}-{}", release.version, Uuid::new_v4()));
    let had_previous = runtime_dir.exists();
    if had_previous {
        std::fs::rename(runtime_dir, &backup)
            .map_err(|error| format!("cannot stage previous AI runtime for rollback: {error}"))?;
    }
    if let Err(error) = std::fs::rename(staging, runtime_dir) {
        // Put the old version back before reporting the failure.
        if had_previous {
            let _ = std::fs::rename(&backup, runtime_dir);
        }
        return Err(format!("cannot activate AI Runtime Box: {error}"));
    }
    prune_rollbacks(&rollback)?;
    Ok(had_previous)
}

/// Installs an AI Runtime Box: resolve → verify → download → stage → self-test → activate.
///
/// Runs the full chain described at the top of this module. Every failure leaves the previously
/// installed version untouched, and `download_id` lets the frontend track progress and cancel
/// the transfer through the shared [`DownloadRegistry`].
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
    // The download ID becomes part of an event name and a progress key, so restrict it to a
    // bounded, well-known alphabet rather than trusting the caller.
    if download_id.is_empty()
        || download_id.len() > 160
        || !download_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("invalid AI Runtime Box download id".to_string());
    }
    // Debug builds may be pointed at a local test registry; release builds always use the URL
    // the caller passed, so the environment cannot redirect a production install.
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
    // Signed *and* addressed to us: a valid document served from the wrong URL (or for another
    // box or target) is still rejected.
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
    // Ties the release back to the channel that offered it, so a signed manifest for a
    // different version cannot be substituted at the release-manifest URL.
    if release.version != selected.version {
        return Err("AI Runtime Box release version does not match its signed channel".to_string());
    }
    ensure_not_revoked(&registry_base_url, &release).await?;
    // Held for the rest of the function; released on Drop, including on any `?` below.
    let _install_guard = InstallGuard::acquire(&release.runtime_id)?;

    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &release.runtime_id)?;
    let runtime_parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    std::fs::create_dir_all(runtime_parent).map_err(|error| error.to_string())?;
    let downloads_dir = runtime_parent.join(".runtime-box-downloads");
    std::fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    // Content-addressed filename: two releases never collide, and a stale partial file from a
    // different version can never be mistaken for this one.
    let archive_path = downloads_dir.join(format!(
        "{}-{}-{}.zip",
        release.box_id, release.version, release.archive.sha256
    ));
    let mut archive_ready = false;
    if archive_path.is_file() {
        let metadata = std::fs::metadata(&archive_path).map_err(|error| error.to_string())?;
        archive_ready = metadata.len() == release.archive.size_bytes
            && sha256_of_file(&archive_path.to_string_lossy())? == release.archive.sha256;
        if !archive_ready {
            std::fs::remove_file(&archive_path).map_err(|error| error.to_string())?;
        }
    }
    let part_path = PathBuf::from(format!("{}.part", archive_path.to_string_lossy()));
    if part_path.is_file()
        && std::fs::metadata(&part_path).map_err(|error| error.to_string())?.len()
            > release.archive.size_bytes
    {
        std::fs::remove_file(&part_path).map_err(|error| error.to_string())?;
    }
    let archive_bytes_on_disk = if archive_ready {
        release.archive.size_bytes
    } else {
        std::fs::metadata(&part_path).map(|metadata| metadata.len()).unwrap_or(0)
    };
    // Legacy Geneformer/scGPT releases have no signed extracted size. They retain the existing
    // download-only preflight; new releases receive the complete peak-space gate.
    if release.installed_size_bytes.is_some() {
        ensure_runtime_box_disk_space(
            runtime_parent,
            &runtime_dir,
            &rollback_root(runtime_parent, &release.runtime_id),
            &release,
            archive_bytes_on_disk,
        )?;
    }
    if !archive_ready {
        let cancellation = downloads.register(&download_id);
        // stream_download enforces the SHA-256 while writing, so the archive on disk is already
        // known to hash to the value in the signed manifest.
        let download_result = stream_download(
            &app,
            &download_id,
            &release.archive.url,
            &archive_path.to_string_lossy(),
            Some(&release.archive.sha256),
            &cancellation,
        )
        .await;
        // Unregister before propagating, otherwise a failed download would leak its registry entry.
        downloads.unregister(&download_id);
        download_result?;
    }
    if std::fs::metadata(&archive_path)
        .map_err(|error| error.to_string())?
        .len()
        != release.archive.size_bytes
    {
        let _ = std::fs::remove_file(&archive_path);
        return Err("AI Runtime Box archive size does not match the signed release".to_string());
    }

    // Unpack next to the final location (same filesystem, so activation can rename) but under a
    // unique hidden name, so a half-extracted box is never mistaken for an installed one.
    let staging = runtime_parent.join(format!(".{}.{}.staging", release.runtime_id, Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    // Closure so every failure between here and activation funnels into one cleanup path below,
    // instead of repeating "delete staging" at each `?`.
    let install_result = (|| -> Result<RuntimeBoxInstallResult, String> {
        extract_zip_with_expected_size(
            &archive_path.to_string_lossy(),
            &staging.to_string_lossy(),
            release.installed_size_bytes,
        )?;
        if let Some(expected) = release.installed_size_bytes {
            let actual = dir_size(&staging)?;
            if actual != expected {
                return Err("AI Runtime Box extracted size does not match the signed release".to_string());
            }
        }
        let python_path = validate_extracted_box(&staging, &release)?;
        run_self_test(&python_path, &release.self_test)?;
        // Persist the signed release inside the box: the installed directory then carries its
        // own provenance, readable later without contacting the registry.
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
    // Failed attempt: drop the staged tree so a retry starts clean.
    if install_result.is_err() && staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    // Success: the extracted box is what matters now, so reclaim the archive's disk space. The
    // archive is deliberately kept on failure, so a retry can reuse the completed download.
    if install_result.is_ok() {
        let _ = std::fs::remove_file(&archive_path);
    }
    install_result
}

/// Restores the previously installed version of a runtime.
///
/// The escape hatch for a box that installs and self-tests cleanly but misbehaves in real use.
/// Mirrors [`activate_runtime`]: the current version is moved aside first, the archived one is
/// renamed into place, and a failure at that point puts the current version back.
///
/// Finding nothing to restore is reported as `restored: false`, not as an error.
#[tauri::command]
pub async fn lia_ai_runtime_box_rollback(
    app: AppHandle,
    runtime_id: String,
) -> Result<RuntimeBoxRollbackResult, String> {
    // Same lock as install: a rollback must not race an install of the same runtime.
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
    // Park the version being rolled back rather than deleting it up front: it is still needed
    // if the restore rename fails.
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
    // Restore succeeded, so the bad version can go.
    if failed.exists() {
        let _ = std::fs::remove_dir_all(failed);
    }
    Ok(RuntimeBoxRollbackResult {
        runtime_id,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        restored: true,
    })
}

/// Uninstalls a runtime and reclaims everything it occupies on disk.
///
/// Removes three things, because a box lives in three places: the active runtime directory, its
/// rollback archive, and any cached download. `box_id` is needed on top of `runtime_id` because
/// cached archives are named after the box, not the runtime.
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
    // Dropping the rollback archive too: keeping it would strand a version that can no longer
    // be rolled back to, since the runtime itself is gone.
    let rollback = rollback_root(parent, &runtime_id);
    if rollback.exists() {
        std::fs::remove_dir_all(rollback).map_err(|error| error.to_string())?;
    }
    // Sweep leftover archives from interrupted installs of this box (see the content-addressed
    // `{box_id}-{version}-{sha256}.zip` name used above).
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom};

    fn release_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "kind": "liatir.runtime-box.release",
            "boxId": "fixture",
            "modelId": "liatir-fixture",
            "runtimeId": "fixture-runtime",
            "version": "1.0.0",
            "target": { "platform": "macos", "arch": "aarch64", "accelerator": "metal" },
            "compatibility": { "minLiatirVersion": "0.0.0" },
            "archive": {
                "format": "zip",
                "url": "https://assets.models.liatir.com/fixture.zip",
                "sha256": "a".repeat(64),
                "sizeBytes": 10
            },
            "pythonEntryPoint": "venv/bin/python",
            "modelCacheSubdir": "model-cache/fixture",
            "selfTest": { "pythonImports": ["json"], "timeoutSeconds": 10 },
            "provenance": {}
        })
    }

    #[test]
    fn legacy_release_without_installed_size_remains_deserializable() {
        let legacy: ReleaseManifest = serde_json::from_value(release_json()).unwrap();
        assert_eq!(legacy.installed_size_bytes, None);

        let mut current = release_json();
        current["installedSizeBytes"] = serde_json::json!(25);
        let current: ReleaseManifest = serde_json::from_value(current).unwrap();
        assert_eq!(current.installed_size_bytes, Some(25));
    }

    #[test]
    fn disk_plan_accounts_for_archive_payload_runtime_and_rollback() {
        let plan = runtime_box_disk_plan(1_000, 5_000, 400, 700, 300);
        assert_eq!(plan.archive_remaining_bytes, 600);
        assert_eq!(plan.installed_size_bytes, 5_000);
        assert_eq!(plan.current_runtime_bytes, 700);
        assert_eq!(plan.rollback_bytes, 300);
        assert_eq!(plan.peak_managed_bytes, 7_000);
        assert_eq!(plan.required_additional_bytes, 5_600 + DISK_SPACE_MARGIN_BYTES);
        assert!(validate_runtime_box_disk_plan(&plan, plan.required_additional_bytes).is_ok());
        assert!(validate_runtime_box_disk_plan(&plan, plan.required_additional_bytes - 1)
            .unwrap_err()
            .contains("Not enough disk space to install this AI Model"));
    }

    /// The focused foundation validator supplies a deterministic Zip64 archive containing one
    /// logical file larger than 4 GiB. Sparse extraction proves the production helper can unpack
    /// it without requiring another 4 GiB of physical test storage.
    #[test]
    #[ignore = "run through npm run runtime-box:test:foundation"]
    fn runtime_box_large_archive_fixture() {
        let archive = std::env::var("LIATIR_RUNTIME_BOX_LARGE_FIXTURE")
            .expect("large Runtime Box fixture path is required");
        let expected = (u32::MAX as u64) + 2;
        let rejected = std::env::temp_dir().join(format!(
            "liatir-runtime-box-large-rejected-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&rejected).unwrap();
        assert!(extract_zip_with_expected_size(
            &archive,
            &rejected.to_string_lossy(),
            Some(expected - 1),
        )
        .unwrap_err()
        .contains("does not match the signed Runtime Box release"));
        assert_eq!(std::fs::read_dir(&rejected).unwrap().count(), 0);
        std::fs::remove_dir_all(rejected).unwrap();

        let destination = std::env::temp_dir().join(format!(
            "liatir-runtime-box-large-extract-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&destination).unwrap();
        extract_zip_with_expected_size(&archive, &destination.to_string_lossy(), Some(expected))
            .unwrap();

        let output = destination.join("huge-zero-fixture.bin");
        assert_eq!(std::fs::metadata(&output).unwrap().len(), expected);
        let mut file = std::fs::File::open(output).unwrap();
        file.seek(SeekFrom::End(-1)).unwrap();
        let mut final_byte = [1u8; 1];
        file.read_exact(&mut final_byte).unwrap();
        assert_eq!(final_byte, [0]);

        std::fs::remove_dir_all(destination).unwrap();
    }
}
