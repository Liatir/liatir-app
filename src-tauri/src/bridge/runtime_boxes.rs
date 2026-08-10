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
//! 6. let Scrollcase re-verify the signed release and archive, safely extract into staging,
//!    check `box.json` agreement and return a preparation receipt bound to the release payload;
//! 7. run a self-test (import the declared Python modules) with the box's own interpreter;
//! 8. only then swap staging into place, keeping the previous version for rollback.
//!
//! Activation is a directory rename, so a box is never observed half-installed: it is either
//! the old version or the new one.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
// Scrollcase owns the generic box format: signed-envelope verification, target identity and
// the safe-path rule. Liatir keeps the product lifecycle around it — registry, revocation,
// disk planning, activation, rollback and removal. Persisted anti-replay is a separate slice.
use scrollcase_consumer::{
    contract::{
        documents::SignedDocument,
        targets::{assert_python_entry_point, box_target_adapter, box_target_id},
    },
    filesystem::payload_size as scrollcase_payload_size,
    path::safe_relative_path as scrollcase_safe_relative_path,
    prepare::{verify_and_extract_box, EnvironmentReportOptions, PrepareOptions},
    release::{Compatibility as BoxCompatibility, ReleaseManifest as BoxRelease, SelfTest},
    trust::{parse_trusted_keys, verify_signed_document, TrustAnchors, TrustedKey},
};
use tauri::AppHandle;
use url::Url;
use uuid::Uuid;

use super::{
    ai_hardware::{nvidia_capability, total_memory_bytes},
    app_storage::{resolve_app_path, write_text_atomic},
    managed_bins::{
        available_space_for_path, format_bytes, rename_with_retry,
        sha256_of_file, stream_download, DownloadRegistry, DISK_SPACE_MARGIN_BYTES,
    },
    python_env::env_dir,
};

/// Parent directory (under the app-managed storage scope) holding one directory per runtime.
const AI_RUNTIME_ROOT: &str = "ai-runtimes";
/// Hard cap for channel/release/revocation documents, so a hostile or broken registry
/// cannot make the app buffer an unbounded response into memory.
const MAX_CONTROL_DOCUMENT_BYTES: usize = 1024 * 1024;
/// `minRamGb` is a shared wire-contract value expressed in decimal gigabytes.
const BYTES_PER_DECIMAL_GIGABYTE: u64 = 1_000_000_000;
/// Scrollcase v2 is the only Runtime Box wire format accepted by this build.
const RUNTIME_BOX_SCHEMA_VERSION: u32 = 2;
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

/// The hardware/OS profile a box is built for. A box is only installable when this
/// matches the detected native host and passes signed release verification.
///
/// This is Scrollcase's generic wire type under a Liatir name: the shape is part of the box
/// format, not a Liatir decision, and taking it from the package also rejects unknown fields
/// rather than silently discarding them.
type RuntimeBoxTarget = scrollcase_consumer::contract::targets::BoxTarget;

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

/// The signed description of one concrete build of a box.
///
/// This is the box format's own type. Liatir's releases carry two constraints the format does not
/// define — `minLiatirVersion` and `maxLiatirVersionExclusive` — which the format deliberately
/// permits and carries in [`BoxCompatibility::additional`]; evaluating them is Liatir's job, in
/// [`check_compatibility`].
type ReleaseManifest = BoxRelease;

/// The product constraint every Liatir release must declare, held in the box format's
/// open-ended `additional` map because it is Liatir's vocabulary and not the format's.
const MIN_LIATIR_VERSION: &str = "minLiatirVersion";
/// Upper bound of the same constraint. Optional.
const MAX_LIATIR_VERSION_EXCLUSIVE: &str = "maxLiatirVersionExclusive";

/// One published target candidate supplied by the shared AI Model catalog.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxTargetCandidate {
    target: RuntimeBoxTarget,
    host_environments: Vec<String>,
    min_ram_gb: Option<f64>,
    min_nvidia_driver_version: Option<String>,
}

/// Native facts used to choose one candidate without relying on mutable global selection state.
#[derive(Debug, Clone)]
struct RuntimeBoxHostCapabilities {
    platform: String,
    arch: String,
    total_memory_bytes: Option<u64>,
    nvidia_driver_version: Option<String>,
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

/// Durable provenance stored inside an activated Runtime Box and copied to AI Job metadata.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoxActivationMetadata {
    schema_version: u32,
    selected_target: RuntimeBoxTarget,
    release: ReleaseManifest,
    /// Exact verified envelope, including signatures and payload bytes.
    signed_release: Option<serde_json::Value>,
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
    activation: RuntimeBoxActivationMetadata,
}

/// Reads and validates durable Runtime Box provenance for AI Job/Result attribution.
///
/// Schema-v1 installations remain removable through filesystem ownership, but are never parsed
/// or dispatched. V2 activation envelopes are re-verified against the compiled trust roots before
/// every run.
pub(crate) fn runtime_box_activation_metadata(
    app: &AppHandle,
    runtime_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let runtime_dir = env_dir(app, AI_RUNTIME_ROOT, runtime_id)?;
    let path = runtime_dir.join("runtime-box-activation.json");
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("cannot read AI Runtime Box activation metadata: {error}"))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid AI Runtime Box activation metadata: {error}"))?;

    if value.get("release").is_none()
        || value.get("schemaVersion").and_then(serde_json::Value::as_u64)
            != Some(u64::from(RUNTIME_BOX_SCHEMA_VERSION))
    {
        return Err(
            "AI Runtime Box format is unsupported; remove and reinstall this Runtime Box"
                .to_string(),
        );
    }
    let activation: RuntimeBoxActivationMetadata = serde_json::from_value(value)
        .map_err(|error| format!("invalid AI Runtime Box activation metadata: {error}"))?;
    if activation.selected_target != activation.release.target {
        return Err("AI Runtime Box activation target does not match its release".to_string());
    }
    let document = activation.signed_release.as_ref().ok_or_else(|| {
        "AI Runtime Box activation metadata is missing its signed release".to_string()
    })?;
    let signed_bytes = serde_json::to_vec(document).map_err(|error| error.to_string())?;
    let verified: ReleaseManifest = verify_signed_payload(&signed_bytes)?;
    if serde_json::to_value(&verified).map_err(|error| error.to_string())?
        != serde_json::to_value(&activation.release).map_err(|error| error.to_string())?
    {
        return Err(
            "AI Runtime Box activation release does not match its signed metadata".to_string(),
        );
    }

    serde_json::to_value(activation)
        .map(Some)
        .map_err(|error| error.to_string())
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
        let mut active = installs
            .lock()
            .map_err(|_| "runtime install state poisoned".to_string())?;
        if !active.insert(runtime_id.to_string()) {
            return Err(format!(
                "AI Runtime Box installation is already active for {runtime_id}"
            ));
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

/// A signed release envelope materialized only while Scrollcase prepares one box.
///
/// The public preparation API is path-based. Keeping ownership in a guard makes normal errors and
/// unwinding clean the file without adding another persistent source of release state.
struct TemporaryReleaseDocument {
    path: PathBuf,
}

impl TemporaryReleaseDocument {
    fn write(path: PathBuf, content: &str) -> Result<Self, String> {
        write_text_atomic(&path, content)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryReleaseDocument {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// The Liatir-owned ordering around Scrollcase preparation.
///
/// Scrollcase guarantees that its own trust and archive checks precede extraction. Liatir owns the
/// product checks around that operation: a verified release must pass channel/revocation policy and
/// the peak-disk gate before its archive is allowed to reach the extractor. Keeping that order as a
/// state machine makes the security boundary executable rather than a comment beside a long
/// command handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeBoxInstallPhase {
    Started,
    ReleaseVerified,
    ProductPolicyChecked,
    DiskChecked,
    ArchiveVerified,
    Extracted,
}

struct RuntimeBoxInstallOrder {
    phase: RuntimeBoxInstallPhase,
}

impl RuntimeBoxInstallOrder {
    fn new() -> Self {
        Self {
            phase: RuntimeBoxInstallPhase::Started,
        }
    }

    fn advance(
        &mut self,
        expected: RuntimeBoxInstallPhase,
        next: RuntimeBoxInstallPhase,
    ) -> Result<(), String> {
        if self.phase != expected {
            return Err(format!(
                "internal AI Runtime Box install order error: expected {expected:?}, found {:?}",
                self.phase
            ));
        }
        self.phase = next;
        Ok(())
    }

    fn release_verified(&mut self) -> Result<(), String> {
        self.advance(
            RuntimeBoxInstallPhase::Started,
            RuntimeBoxInstallPhase::ReleaseVerified,
        )
    }

    fn product_policy_checked(&mut self) -> Result<(), String> {
        self.advance(
            RuntimeBoxInstallPhase::ReleaseVerified,
            RuntimeBoxInstallPhase::ProductPolicyChecked,
        )
    }

    fn disk_checked(&mut self) -> Result<(), String> {
        self.advance(
            RuntimeBoxInstallPhase::ProductPolicyChecked,
            RuntimeBoxInstallPhase::DiskChecked,
        )
    }

    fn archive_verified(&mut self) -> Result<(), String> {
        self.advance(
            RuntimeBoxInstallPhase::DiskChecked,
            RuntimeBoxInstallPhase::ArchiveVerified,
        )
    }

    /// Runs the extractor only after every Liatir-owned precondition has advanced in order.
    fn extract<T>(&mut self, prepare: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        if self.phase != RuntimeBoxInstallPhase::ArchiveVerified {
            return Err(format!(
                "internal AI Runtime Box install order error: extraction requires {:?}, found {:?}",
                RuntimeBoxInstallPhase::ArchiveVerified,
                self.phase
            ));
        }
        let prepared = prepare()?;
        self.phase = RuntimeBoxInstallPhase::Extracted;
        Ok(prepared)
    }
}

/// Collects every signing key this build accepts.
///
/// Production keys are always trusted. Debug builds additionally trust the development key
/// and, if `LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE` is set, a key file from disk — which is how
/// a locally signed box can be tested without touching the production trust anchor. Both of
/// those extra sources are behind `cfg!(debug_assertions)` and therefore cannot widen trust
/// in a release build.
///
/// Every source goes through Scrollcase's own `parse_trusted_keys`, so a bare key and a
/// `{ "keys": [...] }` bundle mean the same thing wherever they appear. Reading the trust
/// format a second time here is how a signer and the app that must trust it identically
/// come to disagree about which keys are valid.
fn trusted_keys() -> Result<Vec<TrustedKey>, String> {
    fn parse_keys(raw: &str) -> Result<Vec<TrustedKey>, String> {
        parse_trusted_keys(raw.as_bytes()).map_err(|error| error.to_string())
    }

    let mut keys = parse_keys(PRODUCTION_TRUST_KEY)?;
    if cfg!(debug_assertions) {
        keys.append(&mut parse_keys(DEVELOPMENT_TRUST_KEY)?);
        if let Ok(path) = std::env::var("LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE") {
            let raw = std::fs::read_to_string(&path).map_err(|error| {
                format!("cannot read debug Runtime Box trust key {path}: {error}")
            })?;
            keys.append(
                &mut parse_keys(&raw)
                    .map_err(|error| format!("invalid debug Runtime Box trust key: {error}"))?,
            );
        }
    }
    // Extra production keys can be injected at *compile* time (option_env! reads the build
    // environment, not the runtime one), which is what makes key rotation possible without
    // editing the checked-in trust files.
    if let Some(raw) = option_env!("LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON") {
        keys.append(
            &mut parse_keys(raw)
                .map_err(|error| format!("invalid production Runtime Box trust keys: {error}"))?,
        );
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
    // Schema version is checked here, from the parsed integer, before the crate sees the
    // document. A v1 or unknown box must produce Liatir's own stable unsupported-format
    // state, which drives product-owned cleanup; it must never depend on matching an
    // upstream error string.
    if document.schema_version != RUNTIME_BOX_SCHEMA_VERSION {
        return Err("unsupported signed Runtime Box document".to_string());
    }
    let keys = trusted_keys()?;
    let verified = verify_signed_document(&document, &keys).map_err(|error| {
        format!("AI Runtime Box document is not signed by a trusted Liatir key: {error}")
    })?;
    // Only parsed once the bytes are proven authentic, so no attacker-controlled JSON is
    // ever fed to the typed deserialiser.
    serde_json::from_slice(&verified.bytes)
        .map_err(|error| format!("invalid signed Runtime Box payload: {error}"))
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
        return Err(format!(
            "Runtime Box registry returned HTTP {}",
            response.status()
        ));
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

/// Describes the native machine facts used for per-install target selection.
fn current_host_capabilities() -> RuntimeBoxHostCapabilities {
    let nvidia = nvidia_capability();
    RuntimeBoxHostCapabilities {
        platform: match std::env::consts::OS {
            "macos" => "macos".to_string(),
            value => value.to_string(),
        },
        arch: match std::env::consts::ARCH {
            "aarch64" => "aarch64".to_string(),
            value => value.to_string(),
        },
        total_memory_bytes: total_memory_bytes(),
        nvidia_driver_version: nvidia.map(|capability| capability.driver_version),
    }
}

/// True when a dotted numeric version is safe to compare component by component.
fn is_numeric_version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

/// Selects the first published native target compatible with this exact host.
///
/// CUDA candidates must declare and satisfy a minimum NVIDIA driver. A later CPU candidate is a
/// deliberate fallback; Linux payloads marked only for windows-wsl2 are never selected here.
fn select_target_candidate<'a>(
    candidates: &'a [RuntimeBoxTargetCandidate],
    host: &RuntimeBoxHostCapabilities,
) -> Result<&'a RuntimeBoxTargetCandidate, String> {
    if candidates.is_empty() {
        return Err("This AI Model has no published Runtime Box targets".to_string());
    }
    for candidate in candidates {
        let candidate_id = target_id(&candidate.target)?;
        if candidate.host_environments.is_empty()
            || candidate
                .host_environments
                .iter()
                .any(|environment| environment != "native" && environment != "windows-wsl2")
        {
            return Err(format!(
                "Published Runtime Box target {candidate_id} has invalid host environment metadata"
            ));
        }
        // NaN and infinity are rejected alongside zero: none of them express a requirement, and
        // a comparison against NaN would otherwise silently pass every host.
        if candidate
            .min_ram_gb
            .is_some_and(|memory| !memory.is_finite() || memory <= 0.0)
        {
            return Err(format!(
                "Published Runtime Box target {candidate_id} has an invalid memory requirement"
            ));
        }
        if candidate.target.accelerator == "cuda" {
            if !candidate
                .min_nvidia_driver_version
                .as_deref()
                .is_some_and(is_numeric_version)
            {
                return Err(format!(
                    "Published CUDA Runtime Box target {candidate_id} is missing a valid minimum NVIDIA driver"
                ));
            }
        } else if candidate.min_nvidia_driver_version.is_some() {
            return Err(format!(
                "Non-CUDA Runtime Box target {candidate_id} cannot require an NVIDIA driver"
            ));
        }
    }

    let platform_candidates = candidates
        .iter()
        .filter(|candidate| candidate.target.platform == host.platform)
        .collect::<Vec<_>>();
    if platform_candidates.is_empty() {
        return Err(format!(
            "This AI Model does not have a published Runtime Box for {}",
            match host.platform.as_str() {
                "macos" => "macOS",
                "windows" => "Windows",
                "linux" => "Linux",
                value => value,
            }
        ));
    }
    let architecture_candidates = platform_candidates
        .into_iter()
        .filter(|candidate| candidate.target.arch == host.arch)
        .collect::<Vec<_>>();
    if architecture_candidates.is_empty() {
        return Err(format!(
            "This AI Model does not have a published Runtime Box for {} {}",
            host.platform, host.arch
        ));
    }
    let native_candidates = architecture_candidates
        .into_iter()
        .filter(|candidate| {
            candidate
                .host_environments
                .iter()
                .any(|environment| environment == "native")
        })
        .collect::<Vec<_>>();
    if native_candidates.is_empty() {
        return Err(format!(
            "This AI Model has no native Runtime Box for {} {}; WSL2 targets are not selected",
            host.platform, host.arch
        ));
    }

    let mut required_memory_gb = None;
    let mut required_driver = None;
    let mut candidates_after_memory_check = 0usize;
    for candidate in native_candidates {
        if let (Some(minimum_gb), Some(installed_bytes)) =
            (candidate.min_ram_gb, host.total_memory_bytes)
        {
            if installed_bytes < required_memory_bytes(minimum_gb) {
                required_memory_gb = Some(required_memory_gb.unwrap_or(0.0f64).max(minimum_gb));
                continue;
            }
        }
        candidates_after_memory_check += 1;

        match candidate.target.accelerator.as_str() {
            "cuda" => {
                let minimum = candidate.min_nvidia_driver_version.as_deref().unwrap();
                required_driver = Some(minimum);
                let Some(installed) = host.nvidia_driver_version.as_deref() else {
                    continue;
                };
                if version_parts(installed) < version_parts(minimum) {
                    continue;
                }
            }
            "metal" if host.platform != "macos" => continue,
            "cpu" | "metal" => {}
            _ => continue,
        }
        return Ok(candidate);
    }

    if candidates_after_memory_check == 0 {
        if let (Some(minimum_gb), Some(installed_bytes)) =
            (required_memory_gb, host.total_memory_bytes)
        {
            return Err(format!(
                "This AI Model needs at least {minimum_gb} GB of memory, but this computer has {} GB",
                format_memory_gigabytes(installed_bytes)
            ));
        }
    }
    if let Some(minimum) = required_driver {
        return match host.nvidia_driver_version.as_deref() {
            Some(installed) => Err(format!(
                "This AI Model needs NVIDIA driver {minimum} or newer, but this computer has {installed}; no compatible CPU Runtime Box is published"
            )),
            None => Err(format!(
                "This AI Model needs an NVIDIA GPU with driver {minimum} or newer; no compatible CPU Runtime Box is published"
            )),
        };
    }
    Err(format!(
        "No published Runtime Box target is compatible with {} {}",
        host.platform, host.arch
    ))
}

/// Flattens a validated target into the slug used in registry URLs.
///
/// The rule belongs to the box format, so Scrollcase computes it. Only the wording is
/// Liatir's: this message can reach a non-technical user, and it must name the product
/// concept rather than the packaging tool.
fn target_id(target: &RuntimeBoxTarget) -> Result<String, String> {
    // "box target" also rewrites the plural "box targets" in the CUDA-version message.
    box_target_id(target).map_err(|error| error.message().replace("box target", "Runtime Box target"))
}

/// Rejects any path that could escape the directory it is joined onto.
///
/// Manifest-supplied paths (the interpreter entry point, the model cache subdir) are joined
/// onto the runtime directory, so without this a malicious manifest could point anywhere on
/// the filesystem. The rule is the box format's, so Scrollcase owns it — including the
/// Windows-prefix and drive-relative cases that a component walk on Unix does not see.
fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    scrollcase_safe_relative_path(value)
        .map(PathBuf::from)
        .map_err(|error| format!("unsafe Runtime Box path: {}", error.message()))
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

/// Converts the shared decimal-gigabyte requirement to the native byte probe unit.
///
/// Rounded *up*: a fractional requirement must never be satisfied by a host that is short of it,
/// which is what truncation would allow. A non-finite or non-positive value cannot express a
/// requirement at all and yields zero, leaving the check to the validation that rejects it.
fn required_memory_bytes(gigabytes: f64) -> u64 {
    let bytes = gigabytes * BYTES_PER_DECIMAL_GIGABYTE as f64;
    if !bytes.is_finite() || bytes <= 0.0 {
        return 0;
    }
    bytes.ceil().min(u64::MAX as f64) as u64
}

/// Formats probed memory without rounding an undersized host up to the requirement.
fn format_memory_gigabytes(bytes: u64) -> String {
    let tenths = bytes.saturating_mul(10) / BYTES_PER_DECIMAL_GIGABYTE;
    format!("{}.{:01}", tenths / 10, tenths % 10)
}

/// Reads one of Liatir's own constraints out of the box format's open-ended block.
///
/// A constraint that is present but not a string is a malformed release, not an absent
/// constraint: silently skipping it would install a box whose requirement was never checked.
fn liatir_constraint<'a>(
    compatibility: &'a BoxCompatibility,
    name: &str,
) -> Result<Option<&'a str>, String> {
    match compatibility.additional.get(name) {
        None => Ok(None),
        Some(serde_json::Value::String(value)) if !value.is_empty() => Ok(Some(value)),
        Some(_) => Err(format!(
            "This AI Runtime Box declares an unreadable {name} requirement"
        )),
    }
}

/// Checks the host against the manifest's requirements before any download starts.
///
/// Native probes are enforced when they return a fact. An unavailable memory probe remains
/// unknown rather than being treated as zero, while an explicit NVIDIA minimum must be proven.
///
/// This is also where the box format hands Liatir its own half of the contract. The format
/// carries constraints it does not define but never evaluates them, and requires that an
/// application refuse a box whose constraints it cannot evaluate — so an unrecognised entry is
/// rejected here rather than ignored. Ignoring one would install a box on a host the publisher
/// had explicitly excluded.
fn check_compatibility(
    compatibility: &BoxCompatibility,
    host: &RuntimeBoxHostCapabilities,
) -> Result<(), String> {
    for name in compatibility.additional.keys() {
        if name != MIN_LIATIR_VERSION && name != MAX_LIATIR_VERSION_EXCLUSIVE {
            return Err(format!(
                "This AI Runtime Box declares a requirement this version of Liatir cannot check ({name})"
            ));
        }
    }
    let app = version_parts(env!("CARGO_PKG_VERSION"));
    // Required: a release that names no minimum has not been through Liatir's publishing path.
    let minimum = liatir_constraint(compatibility, MIN_LIATIR_VERSION)?.ok_or_else(|| {
        "This AI Runtime Box does not declare which Liatir versions it supports".to_string()
    })?;
    if app < version_parts(minimum) {
        return Err(format!(
            "This AI Runtime Box requires Liatir {minimum} or newer"
        ));
    }
    if let Some(maximum) = liatir_constraint(compatibility, MAX_LIATIR_VERSION_EXCLUSIVE)? {
        if app >= version_parts(maximum) {
            return Err(format!(
                "This AI Runtime Box requires a Liatir version older than {maximum}"
            ));
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
        if installed
            .as_deref()
            .map(version_parts)
            .is_some_and(|version| version < version_parts(minimum))
        {
            return Err(format!(
                "This AI Runtime Box requires macOS {minimum} or newer"
            ));
        }
    }
    if let Some(minimum_gb) = compatibility.min_ram_gb {
        let installed_bytes = host.total_memory_bytes;
        if installed_bytes.is_some_and(|bytes| bytes < required_memory_bytes(minimum_gb)) {
            return Err(format!(
                "This AI Runtime Box requires at least {minimum_gb} GB of memory"
            ));
        }
    }
    if let Some(minimum) = compatibility.min_nvidia_driver_version.as_deref() {
        if !is_numeric_version(minimum) {
            return Err("This AI Runtime Box has an invalid NVIDIA driver requirement".to_string());
        }
        let installed = host.nvidia_driver_version.as_deref().ok_or_else(|| {
            format!("This AI Runtime Box requires an NVIDIA GPU with driver {minimum} or newer")
        })?;
        if version_parts(installed) < version_parts(minimum) {
            return Err(format!(
                "This AI Runtime Box requires NVIDIA driver {minimum} or newer, but this computer has {installed}"
            ));
        }
    }
    if compatibility
        .host_environments
        .as_ref()
        .is_some_and(|environments| {
            !environments
                .iter()
                .any(|environment| environment == "native")
        })
    {
        return Err(
            "This AI Runtime Box is not validated for native desktop execution".to_string(),
        );
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
    host: &RuntimeBoxHostCapabilities,
) -> Result<(), String> {
    release
        .validate()
        .map_err(|error| format!("invalid AI Runtime Box release manifest: {}", error.message()))?;
    if release.kind != "liatir.runtime-box.release" {
        return Err("invalid AI Runtime Box release manifest".to_string());
    }
    if release.box_id != box_id || release.model_id != model_id {
        return Err(
            "AI Runtime Box release identity does not match the requested model".to_string(),
        );
    }
    if &release.target != target {
        let release_target_id = target_id(&release.target)?;
        let host_target_id = target_id(target)?;
        return Err(format!(
            "AI Runtime Box target {} does not match this host {}",
            release_target_id, host_target_id
        ));
    }
    if release.target.accelerator == "cuda" {
        if !release
            .compatibility
            .min_nvidia_driver_version
            .as_deref()
            .is_some_and(is_numeric_version)
        {
            return Err(
                "A CUDA AI Runtime Box release must declare a minimum NVIDIA driver".to_string(),
            );
        }
    } else if release.compatibility.min_nvidia_driver_version.is_some() {
        return Err("Only CUDA AI Runtime Box releases may require an NVIDIA driver".to_string());
    }
    validate_control_url(&release.archive.url)?;
    let adapter = box_target_adapter(&release.target)
        .map_err(|error| format!("invalid AI Runtime Box target: {}", error.message()))?;
    assert_python_entry_point(adapter, &release.python_entry_point).map_err(|error| {
        format!(
            "invalid AI Runtime Box interpreter path: {}",
            error.message()
        )
    })?;
    safe_relative_path(&release.model_cache_subdir)?;
    // Import names are interpolated into a Python `-c` script, so restrict them to characters
    // that can only form a module path — no spaces, quotes or semicolons that could smuggle in
    // extra statements.
    if release.self_test.python_imports.is_empty()
        || release.self_test.python_imports.iter().any(|name| {
            name.is_empty()
                || !name.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '_' || character == '.'
                })
        })
    {
        return Err("invalid AI Runtime Box self-test imports".to_string());
    }
    check_compatibility(&release.compatibility, host)
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
    if manifest.schema_version != RUNTIME_BOX_SCHEMA_VERSION
        || manifest.kind != "liatir.runtime-box.revocations"
    {
        return Err("invalid AI Runtime Box revocation document".to_string());
    }
    // A revocation without a target applies to every target of that box version.
    if let Some(revocation) = manifest.revocations.into_iter().find(|item| {
        item.box_id == release.box_id
            && item.version == release.version
            && item
                .target
                .as_ref()
                .is_none_or(|target| target == &release.target)
    }) {
        return Err(format!(
            "AI Runtime Box {} {} was revoked: {}",
            release.box_id, release.version, revocation.reason
        ));
    }
    Ok(())
}

/// Runs the box's own interpreter and imports the modules the manifest declares.
///
/// This is the difference between "the zip unpacked" and "the environment actually works":
/// a truncated wheel or a native library built for the wrong architecture only shows up on
/// import. The child is polled instead of blocked on so a hung import can be killed once the
/// timeout (clamped to 10..=600s) expires.
fn run_self_test(python_path: &Path, self_test: &SelfTest) -> Result<(), String> {
    // Import names were restricted to module-path characters in verify_release_identity.
    let script = self_test
        .python_imports
        .iter()
        .map(|name| format!("import {name}"))
        .collect::<Vec<_>>()
        .join("; ");
    // Capture stderr so a failing import reports the Python traceback (which module and why)
    // instead of only an exit code. The self-test emits a few lines at most, well under the pipe
    // buffer, so reading it after the child exits cannot deadlock the bounded poll below.
    let mut child = Command::new(python_path)
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot start AI Runtime Box self-test: {error}"))?;
    let started = Instant::now();
    let timeout = Duration::from_secs(self_test.timeout_seconds.clamp(10, 600));
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => {
                return Err(format!(
                    "AI Runtime Box self-test failed with status {status}{}",
                    self_test_stderr_suffix(&mut child)
                ));
            }
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "AI Runtime Box self-test timed out after {} seconds{}",
                    timeout.as_secs(),
                    self_test_stderr_suffix(&mut child)
                ));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// Reads the self-test's captured stderr for a failure message. Returns `": <tail>"` when there is
/// output, or an empty string otherwise. Bounded to the tail because a Python traceback ends with
/// the actual exception line, and a pathological box must not be able to flood the error.
fn self_test_stderr_suffix(child: &mut std::process::Child) -> String {
    const MAX_CHARS: usize = 4096;
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut buffer = Vec::new();
    if std::io::Read::read_to_end(&mut stderr, &mut buffer).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&buffer);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let start = trimmed.len().saturating_sub(MAX_CHARS);
    let start = (start..=trimmed.len())
        .find(|&index| trimmed.is_char_boundary(index))
        .unwrap_or(0);
    format!(": {}", &trimmed[start..])
}

/// Total size of the installed box, reported to the UI and compared against the size the signed
/// release declares.
///
/// Delegated to Scrollcase because the *builder* sizes the payload with this same rule when it
/// writes `installedSizeBytes`: measuring it a second time here is how the two come to disagree
/// and fail an honest box. Links are counted at their own few bytes and never followed — since
/// Scrollcase 0.6.0 a payload carries links instead of materialising them, so skipping them
/// would report less than the signed release declares.
fn dir_size(path: &Path) -> Result<u64, String> {
    scrollcase_payload_size(path)
        .map_err(|error| format!("cannot size the AI Runtime Box: {}", error.message()))
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
    if path.is_dir() {
        dir_size(path)
    } else {
        Ok(0)
    }
}

fn validate_runtime_box_disk_plan(plan: &RuntimeBoxDiskPlan, available: u64) -> Result<(), String> {
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
    runtime_parent
        .join(".runtime-box-rollback")
        .join(runtime_id)
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

/// Keeps only the archived version created by the current activation and deletes the rest.
///
/// Runtime boxes are large, so history is capped at one generation: enough to undo the install
/// that just happened, without letting old environments accumulate on disk. The retained path is
/// passed explicitly because filesystem modification times can tie on fast consecutive installs.
fn prune_rollbacks(root: &Path, retained: Option<&Path>) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let candidates = std::fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    for candidate in candidates {
        if retained.is_some_and(|path| path == candidate) {
            continue;
        }
        std::fs::remove_dir_all(candidate).map_err(|error| error.to_string())?;
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
        rename_with_retry(runtime_dir, &backup)
            .map_err(|error| format!("cannot stage previous AI runtime for rollback: {error}"))?;
    }
    // The self-test just executed this box's interpreter from `staging`, so on Windows a
    // transient antivirus or child-process lock can still be clearing; retry the move before
    // reporting a failure.
    if let Err(error) = rename_with_retry(staging, runtime_dir) {
        // Put the old version back before reporting the failure.
        if had_previous {
            let _ = rename_with_retry(&backup, runtime_dir);
        }
        return Err(format!("cannot activate AI Runtime Box: {error}"));
    }
    prune_rollbacks(&rollback, had_previous.then_some(backup.as_path()))?;
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
    target_candidates: Vec<RuntimeBoxTargetCandidate>,
    download_id: String,
) -> Result<RuntimeBoxInstallResult, String> {
    // The download ID becomes part of an event name and a progress key, so restrict it to a
    // bounded, well-known alphabet rather than trusting the caller.
    if download_id.is_empty()
        || download_id.len() > 160
        || !download_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
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
    let host = current_host_capabilities();
    let selected_candidate = select_target_candidate(&target_candidates, &host)?;
    let target = selected_candidate.target.clone();
    let target_slug = target_id(&target)?;
    let mut install_order = RuntimeBoxInstallOrder::new();
    let channel_url = format!(
        "{}/channels/{}/{}/{}",
        registry_base_url.trim_end_matches('/'),
        channel,
        box_id,
        target_slug
    );
    let channel_bytes = fetch_control_document(&channel_url)
        .await?
        .ok_or_else(|| format!("No {channel} AI Runtime Box is available for {target_slug}"))?;
    let channel_manifest: ChannelManifest = verify_signed_payload(&channel_bytes)?;
    // Signed *and* addressed to us: a valid document served from the wrong URL (or for another
    // box or target) is still rejected.
    if channel_manifest.schema_version != RUNTIME_BOX_SCHEMA_VERSION
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
    let signed_release: serde_json::Value = serde_json::from_slice(&release_bytes)
        .map_err(|error| format!("invalid signed Runtime Box release document: {error}"))?;
    let release: ReleaseManifest = verify_signed_payload(&release_bytes)?;
    verify_release_identity(&release, &box_id, &model_id, &target, &host)?;
    if release.compatibility.min_nvidia_driver_version
        != selected_candidate.min_nvidia_driver_version
        || selected_candidate.min_ram_gb.is_some()
            && release.compatibility.min_ram_gb != selected_candidate.min_ram_gb
    {
        return Err(
            "Published Runtime Box target requirements do not match the signed release".to_string(),
        );
    }
    // Ties the release back to the channel that offered it, so a signed manifest for a
    // different version cannot be substituted at the release-manifest URL.
    if release.version != selected.version {
        return Err("AI Runtime Box release version does not match its signed channel".to_string());
    }
    let release_payload_sha256 = signed_release
        .get("payloadSha256")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "invalid signed Runtime Box release document".to_string())?
        .to_string();
    install_order.release_verified()?;
    ensure_not_revoked(&registry_base_url, &release).await?;
    install_order.product_policy_checked()?;
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
        && std::fs::metadata(&part_path)
            .map_err(|error| error.to_string())?
            .len()
            > release.archive.size_bytes
    {
        std::fs::remove_file(&part_path).map_err(|error| error.to_string())?;
    }
    let archive_bytes_on_disk = if archive_ready {
        release.archive.size_bytes
    } else {
        std::fs::metadata(&part_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
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
    install_order.disk_checked()?;
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
    install_order.archive_verified()?;

    // Unpack next to the final location (same filesystem, so activation can rename) but under a
    // unique hidden name, so a half-extracted box is never mistaken for an installed one.
    //
    // Keep this name short. During the self-test the box's own interpreter loads deeply nested
    // modules and native libraries from inside staging, and Windows still enforces the
    // 260-character MAX_PATH for anything that has not opted into long paths — the box's Python
    // among them. Staging is pure overhead on top of the final path, so every character here is
    // one the box's own tree cannot use.
    //
    // Measured against the published scGPT Windows box, whose deepest importable module is 115
    // characters: `.stg-{uuid}` spent 42 and took the self-test to 267, over the limit, while the
    // activated path sits at 225. An earlier `.{runtime_id}.{uuid}.staging` was worse still and
    // failed with WinError 206.
    //
    // Eight hex characters are enough because `InstallGuard` already serialises installs of the
    // same runtime; the retry below settles the rest without lengthening the name. Scrollcase owns
    // creation of the destination and refuses an existing path, so this chooses a name without
    // pre-creating it.
    let staging = {
        let mut attempt = 0;
        loop {
            let candidate = runtime_parent.join(format!(
                ".s-{}",
                &Uuid::new_v4().simple().to_string()[..8]
            ));
            match std::fs::symlink_metadata(&candidate) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break candidate,
                Ok(_) if attempt < 8 => {
                    attempt += 1;
                }
                Ok(_) => return Err("cannot allocate AI Runtime Box staging path".to_string()),
                Err(error) => return Err(error.to_string()),
            }
        }
    };
    // Scrollcase's combined preparation API is path-based. Persist the exact envelope only for the
    // duration of preparation; trust still comes from the keys compiled into this build, and the
    // payload hash below binds the receipt back to the release that already passed Liatir policy.
    let preparation_keys = trusted_keys()?;
    let release_document_path =
        downloads_dir.join(format!("{release_payload_sha256}.release.json"));
    let release_document_text = std::str::from_utf8(&release_bytes)
        .map_err(|error| format!("invalid signed Runtime Box release document: {error}"))?;
    let release_document =
        TemporaryReleaseDocument::write(release_document_path, release_document_text)?;
    // Closure so every failure between here and activation funnels into one cleanup path below,
    // instead of repeating "delete staging" at each `?`.
    let install_result = (|| -> Result<RuntimeBoxInstallResult, String> {
        let prepared = install_order.extract(|| {
            verify_and_extract_box(
                release_document.path(),
                &PrepareOptions {
                    trust: TrustAnchors::Keys(&preparation_keys),
                    archive: Some(&archive_path),
                    destination: &staging,
                    environment: EnvironmentReportOptions::default(),
                },
            )
            .map_err(|error| format!("AI Runtime Box preparation failed: {}", error.message()))
        })?;
        if prepared.release_payload_sha256() != release_payload_sha256 {
            return Err(
                "Prepared AI Runtime Box does not match the release approved by Liatir".to_string(),
            );
        }
        let python_path = prepared
            .root()
            .join(safe_relative_path(prepared.python_entry_point())?);
        run_self_test(&python_path, &release.self_test)?;
        // Persist both the selected target and the exact signed release envelope. The installed
        // directory then carries complete provenance without contacting the registry.
        let activation = RuntimeBoxActivationMetadata {
            schema_version: RUNTIME_BOX_SCHEMA_VERSION,
            selected_target: target.clone(),
            release: release.clone(),
            signed_release: Some(signed_release.clone()),
        };
        write_text_atomic(
            &staging.join("runtime-box-activation.json"),
            &format!(
                "{}\n",
                serde_json::to_string_pretty(&activation).map_err(|error| error.to_string())?
            ),
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
            activation,
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
fn rollback_runtime(runtime_dir: &Path, runtime_id: &str) -> Result<bool, String> {
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    let root = rollback_root(parent, runtime_id);
    let Some(previous) = newest_rollback(&root)? else {
        return Ok(false);
    };
    // Park the version being rolled back rather than deleting it up front: it is still needed
    // if the restore rename fails.
    let failed = parent.join(format!(".{runtime_id}.{}.failed", Uuid::new_v4()));
    if runtime_dir.exists() {
        rename_with_retry(runtime_dir, &failed).map_err(|error| error.to_string())?;
    }
    if let Err(error) = rename_with_retry(&previous, runtime_dir) {
        if failed.exists() {
            let _ = rename_with_retry(&failed, runtime_dir);
        }
        return Err(format!("cannot roll back AI Runtime Box: {error}"));
    }
    // Restore succeeded, so the bad version can go.
    if failed.exists() {
        let _ = std::fs::remove_dir_all(failed);
    }
    Ok(true)
}

#[tauri::command]
pub async fn lia_ai_runtime_box_rollback(
    app: AppHandle,
    runtime_id: String,
) -> Result<RuntimeBoxRollbackResult, String> {
    // Same lock as install: a rollback must not race an install of the same runtime.
    let _install_guard = InstallGuard::acquire(&runtime_id)?;
    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &runtime_id)?;
    let restored = rollback_runtime(&runtime_dir, &runtime_id)?;
    Ok(RuntimeBoxRollbackResult {
        runtime_id,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        restored,
    })
}

/// Uninstalls a runtime and reclaims everything it occupies on disk.
///
/// Removes three things, because a box lives in three places: the active runtime directory, its
/// rollback archive, and any cached download. `box_id` is needed on top of `runtime_id` because
/// cached archives are named after the box, not the runtime.
fn remove_runtime_files(runtime_dir: &Path, runtime_id: &str, box_id: &str) -> Result<(), String> {
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "AI runtime directory has no parent".to_string())?;
    if runtime_dir.exists() {
        std::fs::remove_dir_all(runtime_dir).map_err(|error| error.to_string())?;
    }
    // Dropping the rollback archive too: keeping it would strand a version that can no longer
    // be rolled back to, since the runtime itself is gone.
    let rollback = rollback_root(parent, runtime_id);
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
                std::fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn lia_ai_runtime_box_remove(
    app: AppHandle,
    runtime_id: String,
    box_id: String,
) -> Result<bool, String> {
    let _install_guard = InstallGuard::acquire(&runtime_id)?;
    let runtime_dir = env_dir(&app, AI_RUNTIME_ROOT, &runtime_id)?;
    remove_runtime_files(&runtime_dir, &runtime_id, &box_id)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TargetIdContract {
        valid: Vec<ValidTargetIdFixture>,
        invalid: Vec<InvalidTargetIdFixture>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ValidTargetIdFixture {
        name: String,
        target: RuntimeBoxTarget,
        target_id: String,
    }

    #[derive(Deserialize)]
    struct InvalidTargetIdFixture {
        name: String,
        target: RuntimeBoxTarget,
    }

    fn release_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 2,
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
            // Provenance is the box format's own type, so every field it requires must be
            // present; an empty object is no longer a release this build would accept.
            "provenance": {
                "scrollId": "fixture-macos-arm64",
                "scrollVersion": "1.0.0",
                "builderRevision": "0".repeat(40),
                "sourceTreeDirty": false,
                "sourceRevision": "fixture-source-v2",
                "pythonVersion": "3.11.9",
                "dependencyLockSha256": "b".repeat(64),
                "builtAt": "2026-07-26T12:00:00.000Z",
                "pixiVersion": "0.50.0"
            }
        })
    }

    /// A payload carries links rather than materialising them, and the builder counts each link
    /// at its own size when it declares `installedSizeBytes`. Measuring the installed tree any
    /// other way rejects a valid box, and only a real native build would otherwise reveal it.
    #[cfg(unix)]
    #[test]
    fn dir_size_counts_a_payload_link_without_following_it() {
        let root = std::env::temp_dir().join(format!("liatir-dir-size-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::fs::write(root.join("lib/real.so"), vec![0u8; 4096]).unwrap();
        std::os::unix::fs::symlink("real.so", root.join("lib/linked.so")).unwrap();

        let link_bytes = std::fs::symlink_metadata(root.join("lib/linked.so"))
            .unwrap()
            .len();
        assert_eq!(dir_size(&root).unwrap(), 4096 + link_bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn matches_shared_runtime_box_target_id_contract() {
        let contract: TargetIdContract = serde_json::from_str(include_str!(
            "../../../runtime-boxes/target-id-contract.json"
        ))
        .unwrap();
        for fixture in contract.valid {
            assert_eq!(
                target_id(&fixture.target).as_deref(),
                Ok(fixture.target_id.as_str()),
                "{}",
                fixture.name
            );
        }
        for fixture in contract.invalid {
            assert!(target_id(&fixture.target).is_err(), "{}", fixture.name);
        }
    }

    #[test]
    fn accepts_scrollcase_contract_compatibility_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../runtime-boxes/contract-compatibility-fixtures.json"
        ))
        .unwrap();

        let release: ReleaseManifest =
            serde_json::from_value(fixtures["release"].clone()).unwrap();
        assert_eq!(release.schema_version, RUNTIME_BOX_SCHEMA_VERSION);
        assert_eq!(release.kind, "liatir.runtime-box.release");
        assert_eq!(release.provenance.pixi_version, "0.50.0");

        let channel: ChannelManifest =
            serde_json::from_value(fixtures["channel"].clone()).unwrap();
        assert_eq!(channel.schema_version, RUNTIME_BOX_SCHEMA_VERSION);
        assert_eq!(channel.kind, "liatir.runtime-box.channel");
        assert_eq!(channel.releases.len(), 1);

        let revocations: RevocationsManifest =
            serde_json::from_value(fixtures["revocations"].clone()).unwrap();
        assert_eq!(revocations.schema_version, RUNTIME_BOX_SCHEMA_VERSION);
        assert_eq!(revocations.kind, "liatir.runtime-box.revocations");
        assert_eq!(revocations.revocations.len(), 1);
    }

    #[test]
    fn rejects_schema_v1_release_manifests() {
        let mut value = release_json();
        value["schemaVersion"] = serde_json::json!(1);
        let release: ReleaseManifest = serde_json::from_value(value).unwrap();
        let host = host("macos", "aarch64", None);
        let error = verify_release_identity(
            &release,
            "fixture",
            "liatir-fixture",
            &target("macos", "aarch64", "metal", None),
            &host,
        )
        .unwrap_err();
        assert!(error.contains("Unsupported schemaVersion 1"));
    }

    fn target(
        platform: &str,
        arch: &str,
        accelerator: &str,
        cuda_version: Option<&str>,
    ) -> RuntimeBoxTarget {
        RuntimeBoxTarget {
            platform: platform.to_string(),
            arch: arch.to_string(),
            accelerator: accelerator.to_string(),
            cuda_version: cuda_version.map(str::to_string),
        }
    }

    fn candidate(
        target: RuntimeBoxTarget,
        min_nvidia_driver_version: Option<&str>,
    ) -> RuntimeBoxTargetCandidate {
        RuntimeBoxTargetCandidate {
            target,
            host_environments: vec!["native".to_string()],
            min_ram_gb: None,
            min_nvidia_driver_version: min_nvidia_driver_version.map(str::to_string),
        }
    }

    fn host(platform: &str, arch: &str, driver: Option<&str>) -> RuntimeBoxHostCapabilities {
        RuntimeBoxHostCapabilities {
            platform: platform.to_string(),
            arch: arch.to_string(),
            total_memory_bytes: Some(64 * 1024 * 1024 * 1024),
            nvidia_driver_version: driver.map(str::to_string),
        }
    }

    #[test]
    fn selects_ordered_native_targets_for_the_required_host_matrix() {
        let cuda_linux = candidate(
            target("linux", "x86_64", "cuda", Some("12.4")),
            Some("550.54"),
        );
        let cpu_linux = candidate(target("linux", "x86_64", "cpu", None), None);
        let cuda_windows = candidate(
            target("windows", "x86_64", "cuda", Some("12.4")),
            Some("550.54"),
        );
        let cpu_windows = candidate(target("windows", "x86_64", "cpu", None), None);
        let cases = vec![
            (
                "macOS arm64 Metal",
                host("macos", "aarch64", None),
                vec![candidate(target("macos", "aarch64", "metal", None), None)],
                "macos-aarch64-metal",
            ),
            (
                "Linux CPU",
                host("linux", "x86_64", None),
                vec![cpu_linux.clone()],
                "linux-x86_64-cpu",
            ),
            (
                "Linux CUDA",
                host("linux", "x86_64", Some("590.48.01")),
                vec![cuda_linux.clone(), cpu_linux.clone()],
                "linux-x86_64-cuda12.4",
            ),
            (
                "Windows CPU",
                host("windows", "x86_64", None),
                vec![cpu_windows.clone()],
                "windows-x86_64-cpu",
            ),
            (
                "Windows native CUDA",
                host("windows", "x86_64", Some("590.48.01")),
                vec![cuda_windows.clone(), cpu_windows.clone()],
                "windows-x86_64-cuda12.4",
            ),
            (
                "old NVIDIA driver falls back to CPU",
                host("windows", "x86_64", Some("500.10")),
                vec![cuda_windows, cpu_windows],
                "windows-x86_64-cpu",
            ),
        ];

        for (name, host, candidates, expected) in cases {
            let selected = select_target_candidate(&candidates, &host).unwrap();
            assert_eq!(target_id(&selected.target).unwrap(), expected, "{name}");
        }
    }

    #[test]
    fn target_selection_reports_driver_memory_and_native_target_errors() {
        let only_cuda = vec![candidate(
            target("windows", "x86_64", "cuda", Some("12.4")),
            Some("550.54"),
        )];
        assert!(
            select_target_candidate(&only_cuda, &host("windows", "x86_64", Some("500.10")))
                .unwrap_err()
                .contains("driver 550.54 or newer")
        );

        let mut high_memory = candidate(target("linux", "x86_64", "cpu", None), None);
        high_memory.min_ram_gb = Some(32.0);
        let low_memory_host = RuntimeBoxHostCapabilities {
            total_memory_bytes: Some(16 * 1024 * 1024 * 1024),
            ..host("linux", "x86_64", None)
        };
        assert!(select_target_candidate(&[high_memory], &low_memory_host)
            .unwrap_err()
            .contains("at least 32 GB of memory"));

        let wsl_only = RuntimeBoxTargetCandidate {
            target: target("linux", "x86_64", "cuda", Some("12.4")),
            host_environments: vec!["windows-wsl2".to_string()],
            min_ram_gb: None,
            min_nvidia_driver_version: Some("550.54".to_string()),
        };
        let error =
            select_target_candidate(&[wsl_only], &host("windows", "x86_64", Some("590.48.01")))
                .unwrap_err();
        assert!(error.contains("Windows"));
        assert!(!error.contains("compatible with Windows through WSL"));
    }

    #[test]
    fn memory_requirements_use_decimal_gigabytes_from_the_shared_contract() {
        let mut eight_gb_candidate = candidate(target("linux", "x86_64", "cpu", None), None);
        eight_gb_candidate.min_ram_gb = Some(8.0);
        let exact_host = RuntimeBoxHostCapabilities {
            total_memory_bytes: Some(8_000_000_000),
            ..host("linux", "x86_64", None)
        };
        assert!(select_target_candidate(&[eight_gb_candidate.clone()], &exact_host).is_ok());

        let undersized_host = RuntimeBoxHostCapabilities {
            total_memory_bytes: Some(7_999_999_999),
            ..host("linux", "x86_64", None)
        };
        let error = select_target_candidate(&[eight_gb_candidate], &undersized_host).unwrap_err();
        assert!(error.contains("at least 8 GB"));
        assert!(error.contains("7.9 GB"));

        let mut release: ReleaseManifest = serde_json::from_value(release_json()).unwrap();
        release.compatibility.min_ram_gb = Some(8.0);
        assert!(check_compatibility(&release.compatibility, &exact_host).is_ok());
        assert!(check_compatibility(&release.compatibility, &undersized_host).is_err());
    }

    /// A fractional requirement is what the shared catalog contract and the box format have always
    /// allowed; only the Rust side used to narrow it to whole gigabytes. Rounding must go up, or a
    /// host that is short of the requirement would satisfy it by truncation.
    #[test]
    fn fractional_memory_requirements_are_enforced_without_rounding_down() {
        assert_eq!(required_memory_bytes(7.5), 7_500_000_000);
        // A requirement that cannot be expressed must not silently become "no requirement met".
        assert_eq!(required_memory_bytes(f64::NAN), 0);
        assert_eq!(required_memory_bytes(-1.0), 0);

        let mut candidate = candidate(target("linux", "x86_64", "cpu", None), None);
        candidate.min_ram_gb = Some(7.5);
        let short_host = RuntimeBoxHostCapabilities {
            total_memory_bytes: Some(7_499_999_999),
            ..host("linux", "x86_64", None)
        };
        assert!(select_target_candidate(&[candidate.clone()], &short_host).is_err());
        let exact_host = RuntimeBoxHostCapabilities {
            total_memory_bytes: Some(7_500_000_000),
            ..host("linux", "x86_64", None)
        };
        assert!(select_target_candidate(&[candidate], &exact_host).is_ok());
    }

    /// The box format carries constraints it does not define and never evaluates them, requiring
    /// instead that the application refuse a box whose constraints it cannot check. Liatir is that
    /// application, so an unrecognised entry must stop the install rather than be skipped —
    /// skipping it would install a box on a host the publisher had explicitly excluded.
    #[test]
    fn publisher_constraints_this_build_cannot_check_are_refused() {
        let host = host("macos", "aarch64", None);

        let known: ReleaseManifest = serde_json::from_value(release_json()).unwrap();
        assert_eq!(
            known.compatibility.additional.keys().collect::<Vec<_>>(),
            vec![MIN_LIATIR_VERSION],
            "the fixture's product constraint must land in the format's open block"
        );
        assert!(check_compatibility(&known.compatibility, &host).is_ok());

        let mut unknown = release_json();
        unknown["compatibility"]["minQuantumCores"] = serde_json::json!(4);
        let unknown: ReleaseManifest = serde_json::from_value(unknown).unwrap();
        let error = check_compatibility(&unknown.compatibility, &host).unwrap_err();
        assert!(error.contains("minQuantumCores"), "unexpected: {error}");

        // A release naming no minimum never went through Liatir's publishing path.
        let mut absent = release_json();
        absent["compatibility"]
            .as_object_mut()
            .unwrap()
            .remove(MIN_LIATIR_VERSION);
        let absent: ReleaseManifest = serde_json::from_value(absent).unwrap();
        assert!(check_compatibility(&absent.compatibility, &host).is_err());

        // Present but not a string is malformed, not absent: it must not pass unchecked.
        let mut malformed = release_json();
        malformed["compatibility"][MIN_LIATIR_VERSION] = serde_json::json!(3);
        let malformed: ReleaseManifest = serde_json::from_value(malformed).unwrap();
        assert!(check_compatibility(&malformed.compatibility, &host).is_err());
    }

    #[test]
    fn runtime_box_install_order_blocks_extraction_until_product_gates_pass() {
        let mut order = RuntimeBoxInstallOrder::new();
        assert!(order.product_policy_checked().is_err());
        assert!(order.disk_checked().is_err());

        let invoked = std::cell::Cell::new(false);
        let early = order.extract(|| {
            invoked.set(true);
            Ok(())
        });
        assert!(early.is_err());
        assert!(!invoked.get(), "extractor ran before release verification");

        order.release_verified().unwrap();
        assert!(order.disk_checked().is_err());
        order.product_policy_checked().unwrap();
        assert!(order.archive_verified().is_err());
        order.disk_checked().unwrap();

        let before_archive = order.extract(|| {
            invoked.set(true);
            Ok(())
        });
        assert!(before_archive.is_err());
        assert!(!invoked.get(), "extractor ran before archive verification");

        order.archive_verified().unwrap();
        let prepared = order
            .extract(|| {
                invoked.set(true);
                Ok("prepared")
            })
            .unwrap();
        assert_eq!(prepared, "prepared");
        assert!(invoked.get());
        assert_eq!(order.phase, RuntimeBoxInstallPhase::Extracted);
    }

    #[test]
    fn legacy_release_without_installed_size_remains_deserializable() {
        let legacy: ReleaseManifest = serde_json::from_value(release_json()).unwrap();
        assert_eq!(legacy.installed_size_bytes, None);
        assert_eq!(legacy.compatibility.host_environments, None);

        let mut current = release_json();
        current["installedSizeBytes"] = serde_json::json!(25);
        current["compatibility"]["hostEnvironments"] =
            serde_json::json!(["native", "windows-wsl2"]);
        let current: ReleaseManifest = serde_json::from_value(current).unwrap();
        assert_eq!(current.installed_size_bytes, Some(25));
        assert_eq!(
            current.compatibility.host_environments,
            Some(vec!["native".to_string(), "windows-wsl2".to_string()])
        );
    }

    #[test]
    fn runtime_box_cuda_release_requires_and_enforces_a_minimum_driver() {
        let mut value = release_json();
        value["target"] = serde_json::json!({
            "platform": "windows",
            "arch": "x86_64",
            "accelerator": "cuda",
            "cudaVersion": "12.4"
        });
        value["pythonEntryPoint"] = serde_json::json!("venv/python.exe");
        let target: RuntimeBoxTarget = serde_json::from_value(value["target"].clone()).unwrap();
        let host = host("windows", "x86_64", Some("500.10"));
        let release: ReleaseManifest = serde_json::from_value(value.clone()).unwrap();
        assert!(
            verify_release_identity(&release, "fixture", "liatir-fixture", &target, &host)
                .unwrap_err()
                .contains("must declare a minimum NVIDIA driver")
        );

        value["compatibility"]["minNvidiaDriverVersion"] = serde_json::json!("550.54");
        let release: ReleaseManifest = serde_json::from_value(value).unwrap();
        let error = verify_release_identity(&release, "fixture", "liatir-fixture", &target, &host)
            .unwrap_err();
        assert!(error.contains("driver 550.54 or newer"));
        assert!(error.contains("500.10"));
    }

    #[test]
    fn disk_plan_accounts_for_archive_payload_runtime_and_rollback() {
        let plan = runtime_box_disk_plan(1_000, 5_000, 400, 700, 300);
        assert_eq!(plan.archive_remaining_bytes, 600);
        assert_eq!(plan.installed_size_bytes, 5_000);
        assert_eq!(plan.current_runtime_bytes, 700);
        assert_eq!(plan.rollback_bytes, 300);
        assert_eq!(plan.peak_managed_bytes, 7_000);
        assert_eq!(
            plan.required_additional_bytes,
            5_600 + DISK_SPACE_MARGIN_BYTES
        );
        assert!(validate_runtime_box_disk_plan(&plan, plan.required_additional_bytes).is_ok());
        assert!(
            validate_runtime_box_disk_plan(&plan, plan.required_additional_bytes - 1)
                .unwrap_err()
                .contains("Not enough disk space to install this AI Model")
        );
    }

    fn fixture_release(version: &str) -> ReleaseManifest {
        let mut value = release_json();
        value["version"] = serde_json::json!(version);
        serde_json::from_value(value).unwrap()
    }

    fn fixture_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("liatir-runtime-box-{name}-{}", Uuid::new_v4()))
    }

    fn write_runtime_marker(root: &Path, value: &str) {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(root.join("marker.txt"), value).unwrap();
    }

    fn read_runtime_marker(root: &Path) -> String {
        std::fs::read_to_string(root.join("marker.txt")).unwrap()
    }

    #[test]
    fn runtime_box_activation_rollback_and_remove_use_production_transitions() {
        let root = fixture_root("lifecycle");
        std::fs::create_dir_all(&root).unwrap();
        let runtime_id = "fixture-runtime";
        let box_id = "fixture";
        let runtime = root.join(runtime_id);

        let first_staging = root.join(".first.staging");
        write_runtime_marker(&first_staging, "first");
        assert!(!activate_runtime(&runtime, &first_staging, &fixture_release("1.0.0")).unwrap());
        assert_eq!(read_runtime_marker(&runtime), "first");

        let second_staging = root.join(".second.staging");
        write_runtime_marker(&second_staging, "second");
        assert!(activate_runtime(&runtime, &second_staging, &fixture_release("2.0.0")).unwrap());
        assert_eq!(read_runtime_marker(&runtime), "second");
        let rollback = rollback_root(&root, runtime_id);
        assert_eq!(std::fs::read_dir(&rollback).unwrap().count(), 1);

        let third_staging = root.join(".third.staging");
        write_runtime_marker(&third_staging, "third");
        assert!(activate_runtime(&runtime, &third_staging, &fixture_release("3.0.0")).unwrap());
        assert_eq!(read_runtime_marker(&runtime), "third");
        // Only the directly previous generation is retained.
        assert_eq!(std::fs::read_dir(&rollback).unwrap().count(), 1);
        assert!(rollback_runtime(&runtime, runtime_id).unwrap());
        assert_eq!(read_runtime_marker(&runtime), "second");
        assert!(!rollback_runtime(&runtime, runtime_id).unwrap());

        let rollback_fixture = rollback.join("older");
        write_runtime_marker(&rollback_fixture, "older");
        let downloads = root.join(".runtime-box-downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let matching_download = downloads.join("fixture-3.0.0-hash.zip.part");
        let unrelated_download = downloads.join("other-1.0.0-hash.zip");
        std::fs::write(&matching_download, b"partial").unwrap();
        std::fs::write(&unrelated_download, b"keep").unwrap();

        remove_runtime_files(&runtime, runtime_id, box_id).unwrap();
        assert!(!runtime.exists());
        assert!(!rollback.exists());
        assert!(!matching_download.exists());
        assert!(unrelated_download.exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_box_rollback_pruning_retains_the_current_activation_backup() {
        let root = fixture_root("rollback-pruning");
        let older = root.join("older");
        let retained = root.join("retained");
        write_runtime_marker(&older, "older");
        write_runtime_marker(&retained, "retained");

        prune_rollbacks(&root, Some(&retained)).unwrap();

        assert!(!older.exists());
        assert_eq!(read_runtime_marker(&retained), "retained");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);

        prune_rollbacks(&root, None).unwrap();
        assert!(!retained.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_box_failed_activation_restores_the_previous_runtime() {
        let root = fixture_root("activation-failure");
        std::fs::create_dir_all(&root).unwrap();
        let runtime = root.join("fixture-runtime");
        write_runtime_marker(&runtime, "stable");

        let error = activate_runtime(
            &runtime,
            &root.join("missing.staging"),
            &fixture_release("2.0.0"),
        )
        .unwrap_err();
        assert!(error.contains("cannot activate AI Runtime Box"));
        assert_eq!(read_runtime_marker(&runtime), "stable");
        assert_eq!(
            std::fs::read_dir(rollback_root(&root, "fixture-runtime"))
                .unwrap()
                .count(),
            0
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn self_test_failure_reports_the_python_error_not_only_an_exit_code() {
        // Use whichever interpreter the host provides; skip cleanly when none is on PATH.
        let python = ["python3", "python"].into_iter().find(|candidate| {
            Command::new(candidate)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        });
        let Some(python) = python else {
            return;
        };
        let self_test = SelfTest {
            python_imports: vec!["liatir_missing_selftest_module".to_string()],
            timeout_seconds: 30,
        };
        let error = run_self_test(Path::new(python), &self_test).unwrap_err();
        assert!(error.contains("self-test failed"), "unexpected error: {error}");
        // The captured stderr must identify the missing module, not just the exit code.
        assert!(
            error.contains("liatir_missing_selftest_module") || error.contains("No module named"),
            "diagnostic did not include the Python error: {error}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn runtime_box_windows_long_paths_activate_and_remove() {
        let root = (0..26).fold(fixture_root("windows-long-path"), |path, index| {
            path.join(format!("runtime-segment-{index:02}"))
        });
        assert!(root.to_string_lossy().len() > 260);
        std::fs::create_dir_all(&root).unwrap();
        let runtime = root.join("fixture-runtime");
        let staging = root.join(".fixture.staging");
        write_runtime_marker(&staging, "long-path");

        assert!(!activate_runtime(&runtime, &staging, &fixture_release("1.0.0")).unwrap());
        assert_eq!(read_runtime_marker(&runtime), "long-path");
        remove_runtime_files(&runtime, "fixture-runtime", "fixture").unwrap();
        assert!(!runtime.exists());

        let cleanup_root = root.ancestors().nth(26).unwrap();
        std::fs::remove_dir_all(cleanup_root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn runtime_box_windows_locked_cleanup_preserves_state() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = fixture_root("windows-locked-file");
        let runtime = root.join("fixture-runtime");
        write_runtime_marker(&runtime, "locked");
        let rollback = rollback_root(&root, "fixture-runtime");
        write_runtime_marker(&rollback.join("previous"), "previous");
        let downloads = root.join(".runtime-box-downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let download = downloads.join("fixture-1.0.0-hash.zip.part");
        std::fs::write(&download, b"partial").unwrap();

        let locked = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(runtime.join("marker.txt"))
            .unwrap();
        assert!(remove_runtime_files(&runtime, "fixture-runtime", "fixture").is_err());
        assert!(runtime.exists());
        assert!(rollback.exists());
        assert!(download.exists());

        drop(locked);
        remove_runtime_files(&runtime, "fixture-runtime", "fixture").unwrap();
        assert!(!runtime.exists());
        assert!(!rollback.exists());
        assert!(!download.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Reproduces the Windows activation failure: the self-test executes the box interpreter from
    /// `staging`, so a lock on a staged file (antivirus scan, lingering child handle) can still be
    /// clearing when activation renames the directory into place. The bounded retry must ride out
    /// that transient lock and complete the move once it releases.
    #[cfg(windows)]
    #[test]
    fn runtime_box_windows_activate_retries_transient_lock() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = fixture_root("windows-activate-lock");
        let runtime = root.join("fixture-runtime");
        let staging = root.join(".fixture.staging");
        write_runtime_marker(&staging, "activate-lock");
        let locked_path = staging.join("marker.txt");

        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let handle = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(&locked_path)
                .unwrap();
            locked_tx.send(()).unwrap();
            // Hold long enough that the first rename attempts fail, then release so a retry wins.
            std::thread::sleep(std::time::Duration::from_millis(250));
            drop(handle);
        });

        locked_rx.recv().unwrap();
        assert!(!activate_runtime(&runtime, &staging, &fixture_release("1.0.0")).unwrap());
        holder.join().unwrap();
        assert_eq!(read_runtime_marker(&runtime), "activate-lock");

        std::fs::remove_dir_all(root).unwrap();
    }

    /// The native validator supplies a signed Scrollcase-v2 release and its archive. This exercises
    /// the same combined preparation API as the product install path, including in-memory trust,
    /// archive identity, complete box.json agreement and extraction on each matching host.
    #[test]
    #[ignore = "run through npm run runtime-box:test:native"]
    fn runtime_box_v2_archive_fixture() {
        let archive = std::env::var("LIATIR_RUNTIME_BOX_V2_ARCHIVE_FIXTURE")
            .expect("v2 Runtime Box fixture archive path is required");
        let release_path = std::env::var("LIATIR_RUNTIME_BOX_V2_RELEASE_FIXTURE")
            .expect("v2 Runtime Box fixture release path is required");
        let release_bytes = std::fs::read(&release_path).expect("cannot read v2 fixture release");
        let signed: SignedDocument =
            serde_json::from_slice(&release_bytes).expect("cannot parse v2 fixture release");
        let release: ReleaseManifest =
            verify_signed_payload(&release_bytes).expect("cannot verify v2 fixture release");
        assert_eq!(release.schema_version, RUNTIME_BOX_SCHEMA_VERSION);

        let destination = std::env::temp_dir().join(format!(
            "liatir-runtime-box-v2-extract-{}",
            Uuid::new_v4()
        ));
        let keys = trusted_keys().expect("cannot load v2 fixture trust key");
        let mut order = RuntimeBoxInstallOrder::new();
        order.release_verified().unwrap();
        order.product_policy_checked().unwrap();
        order.disk_checked().unwrap();
        order.archive_verified().unwrap();
        let prepared = order
            .extract(|| {
                verify_and_extract_box(
                    std::path::Path::new(&release_path),
                    &PrepareOptions {
                        trust: TrustAnchors::Keys(&keys),
                        archive: Some(std::path::Path::new(&archive)),
                        destination: &destination,
                        environment: EnvironmentReportOptions::default(),
                    },
                )
                .map_err(|error| error.message().to_string())
            })
            .unwrap();
        assert_eq!(prepared.release_payload_sha256(), signed.payload_sha256);
        if let Some(expected) = release.installed_size_bytes {
            assert_eq!(prepared.installed_size_bytes(), expected);
        }
        let python = destination.join(safe_relative_path(prepared.python_entry_point()).unwrap());
        assert!(python.is_file());
        std::fs::remove_dir_all(destination).unwrap();
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

        let destination = std::env::temp_dir().join(format!(
            "liatir-runtime-box-large-extract-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&destination).unwrap();
        // The production Runtime Box path extracts through Scrollcase, so Zip64 has to be proven
        // there and not only in the shared managed-binary helper: the largest published box is a
        // 17 GB CUDA archive, well past the 4 GiB Zip64 boundary this fixture sits on.
        scrollcase_consumer::archive::extract_zip_archive(
            std::path::Path::new(&archive),
            &destination,
        )
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
