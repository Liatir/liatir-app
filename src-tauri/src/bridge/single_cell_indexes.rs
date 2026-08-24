//! Verified installation lifecycle for published single-cell reference indexes.
//!
//! Indexes are scientific data, not executable Runtime Boxes. They nevertheless use the same
//! Liatir signing keys and managed downloader: the catalog authenticates the scientific identity
//! and immutable archive hash, then this module verifies every extracted file before activation.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter};
use url::Url;
use uuid::Uuid;

use super::{
    app_storage::{resolve_app_path, write_text_atomic},
    jobs::{JobRegistry, JobStatus},
    managed_bins::{
        rename_with_retry, sha256_of_file, stream_download, DownloadProgress, DownloadRegistry,
    },
    runtime_boxes::verify_signed_control_payload_with_digest,
};

const INDEX_ROOT: &str = "single-cell-indexes";
const CATALOG_CACHE: &str = "single-cell-indexes/catalog.signed.json";
const CATALOG_KIND: &str = "liatir.single-cell-index.catalog";
const BUNDLE_KIND: &str = "liatir.single-cell-index.bundle";
const INDEX_KIND: &str = "liatir.single-cell-index";
const PRODUCTION_CATALOG_URL: &str =
    "https://models.liatir.com/v1/reference-indexes/catalog";
const MAX_CATALOG_BYTES: usize = 1024 * 1024;
const MAX_BUNDLE_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;

static ACTIVE_INSTALLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checksum {
    algorithm: String,
    value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAsset {
    url: String,
    checksum: Checksum,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Species {
    common_name: String,
    scientific_name: String,
    taxon_id: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Genome {
    assembly: String,
    source: SourceAsset,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    provider: String,
    release: String,
    format: String,
    source: SourceAsset,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexArchive {
    format: String,
    url: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    simpleaf_version: String,
    piscem_version: String,
    native_tools_lock_sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    recipe_sha256: String,
    source_revision: String,
    built_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    id: String,
    version: String,
    label: String,
    species: Species,
    genome: Genome,
    annotation: Annotation,
    reference_type: String,
    read_length: u64,
    archive: IndexArchive,
    toolchain: Toolchain,
    provenance: Provenance,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexCatalog {
    schema_version: u32,
    kind: String,
    updated_at: String,
    indexes: Vec<CatalogEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResult {
    catalog: IndexCatalog,
    source: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleFile {
    path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    schema_version: u32,
    kind: String,
    index_id: String,
    version: String,
    index_dir: String,
    t2g_map: String,
    gene_id_to_name: Option<String>,
    files: Vec<BundleFile>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledIndex {
    id: String,
    version: String,
    label: String,
    archive_sha256: String,
    manifest_path: String,
    install_dir: String,
    installed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    installed: InstalledIndex,
    reused: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalIndexSources {
    genome_fasta: String,
    annotation: String,
    annotation_format: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalIndexManifest {
    schema_version: u32,
    kind: &'static str,
    index_dir: String,
    t2g_map: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    gene_id_to_name: Option<String>,
    reference_type: String,
    read_length: u64,
    sources: LocalIndexSources,
    simpleaf_version: String,
    created_at: String,
}

struct InstallGuard(String);

impl InstallGuard {
    fn acquire(identity: String) -> Result<Self, String> {
        let mut active = ACTIVE_INSTALLS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .map_err(|_| "Single-cell index install state is unavailable".to_string())?;
        if !active.insert(identity.clone()) {
            return Err("That reference index is already being installed or removed.".to_string());
        }
        Ok(Self(identity))
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_INSTALLS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        {
            active.remove(&self.0);
        }
    }
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let bytes = value.as_bytes();
    let has_windows_drive_prefix = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'/';
    if value.is_empty() || value.contains('\\') || has_windows_drive_prefix {
        return Err(format!("Invalid path in index archive: {value}"));
    }
    let path = Path::new(value);
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => output.push(segment),
            _ => return Err(format!("Invalid path in index archive: {value}")),
        }
    }
    if output.as_os_str().is_empty() {
        return Err(format!("Invalid path in index archive: {value}"));
    }
    Ok(output)
}

fn validate_asset_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid index asset URL: {error}"))?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Index asset URLs cannot contain credentials, a query, or a fragment.".to_string());
    }
    if url.scheme() == "https" {
        return Ok(());
    }
    if cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
    {
        return Ok(());
    }
    Err("Index asset URLs must use HTTPS; debug builds also allow loopback HTTP.".to_string())
}

fn catalog_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(value) = std::env::var("LIATIR_SINGLE_CELL_INDEX_CATALOG_URL") {
            return value;
        }
    }
    PRODUCTION_CATALOG_URL.to_string()
}

fn validate_catalog(catalog: &IndexCatalog) -> Result<(), String> {
    if catalog.schema_version != 2 || catalog.kind != CATALOG_KIND {
        return Err("Unsupported single-cell index catalog.".to_string());
    }
    DateTime::parse_from_rfc3339(&catalog.updated_at)
        .map_err(|_| "The index catalog has an invalid update time.".to_string())?;
    if catalog.indexes.is_empty() || catalog.indexes.len() > 200 {
        return Err("The index catalog must contain between 1 and 200 entries.".to_string());
    }
    let mut identities = HashSet::new();
    for entry in &catalog.indexes {
        if !safe_segment(&entry.id) || !safe_segment(&entry.version) {
            return Err("The index catalog contains an invalid identity.".to_string());
        }
        if !identities.insert(format!("{}@{}", entry.id, entry.version)) {
            return Err("The index catalog contains a duplicate index version.".to_string());
        }
        if entry.label.trim().is_empty()
            || entry.species.common_name.trim().is_empty()
            || entry.species.scientific_name.trim().is_empty()
            || entry.species.taxon_id == 0
            || entry.genome.assembly.trim().is_empty()
            || entry.annotation.provider.trim().is_empty()
            || entry.annotation.release.trim().is_empty()
        {
            return Err("The index catalog contains incomplete scientific identity.".to_string());
        }
        if entry.reference_type != "spliced+intronic" || entry.read_length == 0 {
            return Err("The index catalog contains an unsupported reference construction.".to_string());
        }
        if entry.annotation.format != "gtf" && entry.annotation.format != "gff3" {
            return Err("The index catalog contains an unsupported annotation format.".to_string());
        }
        for source in [&entry.genome.source, &entry.annotation.source] {
            validate_asset_url(&source.url)?;
            let valid_checksum = (source.checksum.algorithm == "md5" && source.checksum.value.len() == 32)
                || (source.checksum.algorithm == "sha256" && valid_sha256(&source.checksum.value));
            if !valid_checksum || !source.checksum.value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
                return Err("The index catalog contains an invalid source checksum.".to_string());
            }
        }
        if entry.archive.format != "zip"
            || entry.archive.size_bytes == 0
            || !valid_sha256(&entry.archive.sha256)
            || !valid_sha256(&entry.toolchain.native_tools_lock_sha256)
            || !valid_sha256(&entry.provenance.recipe_sha256)
            || entry.toolchain.simpleaf_version.trim().is_empty()
            || entry.toolchain.piscem_version.trim().is_empty()
            || entry.provenance.source_revision.trim().is_empty()
        {
            return Err("The index catalog contains invalid archive provenance.".to_string());
        }
        validate_asset_url(&entry.archive.url)?;
        DateTime::parse_from_rfc3339(&entry.provenance.built_at)
            .map_err(|_| "The index catalog has an invalid build time.".to_string())?;
    }
    Ok(())
}

fn decode_catalog(bytes: &[u8]) -> Result<IndexCatalog, String> {
    let (catalog, _) = verify_signed_control_payload_with_digest::<IndexCatalog>(
        bytes,
        "single-cell index catalog",
    )?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

async fn fetch_bounded(url: &str) -> Result<Vec<u8>, String> {
    validate_asset_url(url)?;
    let response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Cannot reach the index catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Index catalog returned HTTP {}.", response.status()));
    }
    if response.content_length().is_some_and(|size| size > MAX_CATALOG_BYTES as u64) {
        return Err("The index catalog is too large.".to_string());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len() + chunk.len() > MAX_CATALOG_BYTES {
            return Err("The index catalog is too large.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn cached_catalog(app: &AppHandle) -> Result<Option<(IndexCatalog, Vec<u8>)>, String> {
    let path = resolve_app_path(app, CATALOG_CACHE)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("Cannot read the cached index catalog: {error}"))?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err("The cached index catalog is too large.".to_string());
    }
    Ok(Some((decode_catalog(&bytes)?, bytes)))
}

async fn load_catalog(app: &AppHandle) -> Result<(IndexCatalog, &'static str), String> {
    let cached = cached_catalog(app).ok().flatten();
    match fetch_bounded(&catalog_url()).await.and_then(|bytes| {
        let catalog = decode_catalog(&bytes)?;
        Ok((catalog, bytes))
    }) {
        Ok((catalog, bytes)) => {
            if let Some((previous, _)) = &cached {
                let incoming = DateTime::parse_from_rfc3339(&catalog.updated_at).map_err(|error| error.to_string())?;
                let accepted = DateTime::parse_from_rfc3339(&previous.updated_at).map_err(|error| error.to_string())?;
                if incoming < accepted {
                    return Ok((previous.clone(), "cache"));
                }
            }
            let path = resolve_app_path(app, CATALOG_CACHE)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            write_text_atomic(&path, std::str::from_utf8(&bytes).map_err(|error| error.to_string())?)?;
            Ok((catalog, "network"))
        }
        Err(network_error) => cached
            .map(|(catalog, _)| (catalog, "cache"))
            .ok_or(network_error),
    }
}

fn install_path(app: &AppHandle, entry: &CatalogEntry) -> Result<PathBuf, String> {
    resolve_app_path(
        app,
        &format!(
            "{INDEX_ROOT}/installed/{}/{}/{}",
            entry.id, entry.version, entry.archive.sha256
        ),
    )
}

fn index_is_in_use(jobs: &JobRegistry, install_dir: &Path) -> Result<bool, String> {
    let active = jobs
        .jobs
        .lock()
        .map_err(|_| "Native Job state is unavailable.".to_string())?;
    Ok(active.values().any(|job| {
        matches!(&job.entry.status, JobStatus::Running)
            && job
                .entry
                .args
                .iter()
                .any(|argument| Path::new(argument).starts_with(install_dir))
    }))
}

fn read_bundle_from_zip(archive: &mut zip::ZipArchive<fs::File>) -> Result<BundleManifest, String> {
    let mut matches = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.name() == "bundle.json" {
            matches.push(index);
        }
    }
    if matches.len() != 1 {
        return Err("The index archive must contain exactly one bundle.json.".to_string());
    }
    let mut entry = archive.by_index(matches[0]).map_err(|error| error.to_string())?;
    if entry.size() > MAX_BUNDLE_MANIFEST_BYTES {
        return Err("The index bundle manifest is too large.".to_string());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid index bundle manifest: {error}"))
}

fn validate_bundle(
    bundle: &BundleManifest,
    expected_id: &str,
    expected_version: &str,
) -> Result<HashMap<String, BundleFile>, String> {
    if bundle.schema_version != 1
        || bundle.kind != BUNDLE_KIND
        || bundle.index_id != expected_id
        || bundle.version != expected_version
        || bundle.files.is_empty()
    {
        return Err("The index bundle does not match the signed catalog entry.".to_string());
    }
    safe_relative_path(&bundle.index_dir)?;
    safe_relative_path(&bundle.t2g_map)?;
    if let Some(path) = &bundle.gene_id_to_name {
        safe_relative_path(path)?;
    }
    let mut files = HashMap::new();
    for file in &bundle.files {
        safe_relative_path(&file.path)?;
        if file.path == "bundle.json" || !valid_sha256(&file.sha256) {
            return Err("The index bundle contains invalid file metadata.".to_string());
        }
        if files.insert(file.path.clone(), file.clone()).is_some() {
            return Err("The index bundle contains duplicate file paths.".to_string());
        }
    }
    if !files.contains_key(&bundle.t2g_map) {
        return Err(format!("The index bundle is missing {}.", bundle.t2g_map));
    }
    let index_dir = safe_relative_path(&bundle.index_dir)?;
    if !files
        .keys()
        .any(|path| Path::new(path).starts_with(&index_dir) && Path::new(path) != index_dir)
    {
        return Err(format!(
            "The index bundle is missing the {} directory.",
            bundle.index_dir
        ));
    }
    if let Some(path) = &bundle.gene_id_to_name {
        if !files.contains_key(path) {
            return Err(format!("The index bundle is missing {path}."));
        }
    }
    Ok(files)
}

fn extract_verified_archive(archive_path: &Path, staging: &Path, entry: &CatalogEntry) -> Result<BundleManifest, String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("Invalid index ZIP: {error}"))?;
    let bundle = read_bundle_from_zip(&mut archive)?;
    let expected = validate_bundle(&bundle, &entry.id, &entry.version)?;
    let mut seen = HashSet::new();
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut source = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = source.name().to_string();
        if name == "bundle.json" {
            continue;
        }
        let relative = safe_relative_path(&name)?;
        if source.is_dir() {
            fs::create_dir_all(staging.join(relative)).map_err(|error| error.to_string())?;
            continue;
        }
        if source.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("The index archive cannot contain symbolic links.".to_string());
        }
        let metadata = expected.get(&name)
            .ok_or_else(|| format!("The index archive contains an undeclared file: {name}"))?;
        if !seen.insert(name.clone()) || source.size() != metadata.size_bytes {
            return Err(format!("The index archive file metadata does not match: {name}"));
        }
        let destination = staging.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(&destination).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = source.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 { break; }
            written = written.saturating_add(count as u64);
            if written > metadata.size_bytes {
                return Err(format!("The index archive file is larger than declared: {name}"));
            }
            hasher.update(&buffer[..count]);
            output.write_all(&buffer[..count]).map_err(|error| error.to_string())?;
        }
        output.sync_all().map_err(|error| error.to_string())?;
        if written != metadata.size_bytes || format!("{:x}", hasher.finalize()) != metadata.sha256 {
            return Err(format!("The index archive file failed verification: {name}"));
        }
    }
    if seen.len() != expected.len() {
        return Err("The index archive is missing one or more declared files.".to_string());
    }
    let bundle_path = staging.join("bundle.json");
    write_text_atomic(
        &bundle_path,
        &format!("{}\n", serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?),
    )?;
    Ok(bundle)
}

fn verify_installed_files(root: &Path, entry: &CatalogEntry) -> Result<(), String> {
    let bundle: BundleManifest = serde_json::from_slice(
        &fs::read(root.join("bundle.json")).map_err(|error| error.to_string())?,
    ).map_err(|error| error.to_string())?;
    let expected = validate_bundle(&bundle, &entry.id, &entry.version)?;
    for file in expected.values() {
        let path = root.join(safe_relative_path(&file.path)?);
        let metadata = fs::metadata(&path).map_err(|_| format!("Installed index file is missing: {}", file.path))?;
        if metadata.len() != file.size_bytes || sha256_of_file(&path.to_string_lossy())? != file.sha256 {
            return Err(format!("Installed index file failed verification: {}", file.path));
        }
    }
    let installed: InstalledIndex = serde_json::from_slice(
        &fs::read(root.join("installed.json")).map_err(|error| error.to_string())?,
    ).map_err(|error| error.to_string())?;
    if installed.id != entry.id
        || installed.version != entry.version
        || installed.archive_sha256 != entry.archive.sha256
        || !Path::new(&installed.manifest_path).is_file()
    {
        return Err("Installed index activation metadata does not match the catalog.".to_string());
    }
    Ok(())
}

fn write_local_manifests(staging: &Path, bundle: &BundleManifest, entry: &CatalogEntry) -> Result<InstalledIndex, String> {
    let local = LocalIndexManifest {
        schema_version: 1,
        kind: INDEX_KIND,
        index_dir: staging.join(safe_relative_path(&bundle.index_dir)?).to_string_lossy().to_string(),
        t2g_map: staging.join(safe_relative_path(&bundle.t2g_map)?).to_string_lossy().to_string(),
        gene_id_to_name: bundle.gene_id_to_name.as_ref()
            .map(|path| safe_relative_path(path).map(|path| staging.join(path).to_string_lossy().to_string()))
            .transpose()?,
        reference_type: entry.reference_type.clone(),
        read_length: entry.read_length,
        sources: LocalIndexSources {
            genome_fasta: entry.genome.source.url.clone(),
            annotation: entry.annotation.source.url.clone(),
            annotation_format: entry.annotation.format.clone(),
        },
        simpleaf_version: entry.toolchain.simpleaf_version.clone(),
        created_at: entry.provenance.built_at.clone(),
    };
    let manifest_path = staging.join(format!("{}.sc-index.json", entry.id));
    write_text_atomic(
        &manifest_path,
        &format!("{}\n", serde_json::to_string_pretty(&local).map_err(|error| error.to_string())?),
    )?;
    let installed = InstalledIndex {
        id: entry.id.clone(),
        version: entry.version.clone(),
        label: entry.label.clone(),
        archive_sha256: entry.archive.sha256.clone(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        install_dir: staging.to_string_lossy().to_string(),
        installed_at: chrono::Utc::now().to_rfc3339(),
    };
    write_text_atomic(
        &staging.join("installed.json"),
        &format!("{}\n", serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?),
    )?;
    Ok(installed)
}

fn rewrite_activated_paths(installed: &mut InstalledIndex, staging: &Path, final_path: &Path) -> Result<(), String> {
    let local_path = staging.join(format!("{}.sc-index.json", installed.id));
    let mut local: serde_json::Value = serde_json::from_slice(&fs::read(&local_path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    for field in ["indexDir", "t2gMap", "geneIdToName"] {
        if let Some(value) = local.get_mut(field).and_then(|value| value.as_str().map(ToOwned::to_owned)) {
            let path = Path::new(&value);
            let relative = path.strip_prefix(staging).map_err(|_| "Invalid staged index path".to_string())?;
            local[field] = serde_json::Value::String(final_path.join(relative).to_string_lossy().to_string());
        }
    }
    write_text_atomic(&local_path, &format!("{}\n", serde_json::to_string_pretty(&local).map_err(|error| error.to_string())?))?;
    installed.manifest_path = final_path.join(format!("{}.sc-index.json", installed.id)).to_string_lossy().to_string();
    installed.install_dir = final_path.to_string_lossy().to_string();
    write_text_atomic(
        &staging.join("installed.json"),
        &format!("{}\n", serde_json::to_string_pretty(installed).map_err(|error| error.to_string())?),
    )
}

fn scan_installed(app: &AppHandle) -> Result<Vec<InstalledIndex>, String> {
    let root = resolve_app_path(app, &format!("{INDEX_ROOT}/installed"))?;
    if !root.exists() { return Ok(Vec::new()); }
    let mut installed = Vec::new();
    for id in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let id = id.map_err(|error| error.to_string())?.path();
        if !id.is_dir() { continue; }
        for version in fs::read_dir(id).map_err(|error| error.to_string())? {
            let version = version.map_err(|error| error.to_string())?.path();
            if !version.is_dir() { continue; }
            for digest in fs::read_dir(version).map_err(|error| error.to_string())? {
                let path = digest.map_err(|error| error.to_string())?.path();
                if !path.is_dir() { continue; }
                let metadata = path.join("installed.json");
                if let Ok(bytes) = fs::read(metadata) {
                    if let Ok(value) = serde_json::from_slice::<InstalledIndex>(&bytes) {
                        installed.push(value);
                    }
                }
            }
        }
    }
    installed.sort_by(|left, right| left.label.cmp(&right.label).then(left.version.cmp(&right.version)));
    Ok(installed)
}

#[tauri::command]
pub async fn lia_single_cell_indexes_catalog(app: AppHandle) -> Result<CatalogResult, String> {
    let (catalog, source) = load_catalog(&app).await?;
    Ok(CatalogResult { catalog, source })
}

#[tauri::command]
pub fn lia_single_cell_indexes_installed(app: AppHandle) -> Result<Vec<InstalledIndex>, String> {
    scan_installed(&app)
}

#[tauri::command]
pub async fn lia_single_cell_index_install(
    app: AppHandle,
    downloads: tauri::State<'_, DownloadRegistry>,
    jobs: tauri::State<'_, JobRegistry>,
    id: String,
    version: String,
    download_id: String,
) -> Result<InstallResult, String> {
    if !safe_segment(&id) || !safe_segment(&version) || download_id.trim().is_empty() {
        return Err("Invalid reference index install request.".to_string());
    }
    let _guard = InstallGuard::acquire(format!("{id}@{version}"))?;
    let (catalog, _) = load_catalog(&app).await?;
    let entry = catalog.indexes.into_iter()
        .find(|entry| entry.id == id && entry.version == version)
        .ok_or_else(|| "That reference index is no longer in the signed catalog.".to_string())?;
    let final_path = install_path(&app, &entry)?;
    if final_path.exists() && verify_installed_files(&final_path, &entry).is_ok() {
        let installed = serde_json::from_slice(
            &fs::read(final_path.join("installed.json")).map_err(|error| error.to_string())?,
        ).map_err(|error| error.to_string())?;
        return Ok(InstallResult { installed, reused: true });
    }

    let downloads_dir = resolve_app_path(&app, &format!("{INDEX_ROOT}/downloads"))?;
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let archive_path = downloads_dir.join(format!("{}.zip", entry.archive.sha256));
    let archive_valid = archive_path.is_file()
        && fs::metadata(&archive_path).map(|metadata| metadata.len()).ok() == Some(entry.archive.size_bytes)
        && sha256_of_file(&archive_path.to_string_lossy()).ok().as_deref() == Some(entry.archive.sha256.as_str());
    if !archive_valid {
        let _ = fs::remove_file(&archive_path);
        if downloads.is_active(&download_id) {
            return Err("That download identifier is already active.".to_string());
        }
        let cancelled = downloads.register(&download_id);
        let result = stream_download(
            &app,
            &download_id,
            &entry.archive.url,
            &archive_path.to_string_lossy(),
            Some(&entry.archive.sha256),
            &cancelled,
        ).await;
        downloads.unregister(&download_id);
        match &result {
            Ok(bytes) => { let _ = app.emit(&format!("managed:progress:{download_id}"), DownloadProgress {
                id: download_id.clone(), bytes_downloaded: *bytes, bytes_total: Some(*bytes), bytes_per_sec: 0.0,
                done: true, error: None,
            }); }
            Err(error) => { let _ = app.emit(&format!("managed:progress:{download_id}"), DownloadProgress {
                id: download_id.clone(), bytes_downloaded: 0, bytes_total: None, bytes_per_sec: 0.0,
                done: true, error: Some(error.clone()),
            }); }
        }
        let bytes = result?;
        if bytes != entry.archive.size_bytes {
            let _ = fs::remove_file(&archive_path);
            return Err("The downloaded index size does not match the signed catalog.".to_string());
        }
    }

    let parent = final_path.parent().ok_or_else(|| "Invalid index install path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = parent.join(format!(".{}.{}.staging", entry.archive.sha256, Uuid::new_v4()));
    let result = (|| -> Result<InstalledIndex, String> {
        let bundle = extract_verified_archive(&archive_path, &staging, &entry)?;
        let mut installed = write_local_manifests(&staging, &bundle, &entry)?;
        rewrite_activated_paths(&mut installed, &staging, &final_path)?;
        if final_path.exists() {
            if index_is_in_use(&jobs, &final_path)? {
                return Err("That reference index is being used by a running analysis.".to_string());
            }
            fs::remove_dir_all(&final_path).map_err(|error| error.to_string())?;
        }
        rename_with_retry(&staging, &final_path).map_err(|error| error.to_string())?;
        verify_installed_files(&final_path, &entry)?;
        Ok(installed)
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&staging); }
    let installed = result?;
    let _ = fs::remove_file(&archive_path);
    Ok(InstallResult { installed, reused: false })
}

#[tauri::command]
pub fn lia_single_cell_index_remove(
    app: AppHandle,
    jobs: tauri::State<'_, JobRegistry>,
    id: String,
    version: String,
    archive_sha256: String,
) -> Result<bool, String> {
    if !safe_segment(&id) || !safe_segment(&version) || !valid_sha256(&archive_sha256) {
        return Err("Invalid reference index removal request.".to_string());
    }
    let _guard = InstallGuard::acquire(format!("{id}@{version}"))?;
    let path = resolve_app_path(
        &app,
        &format!("{INDEX_ROOT}/installed/{id}/{version}/{archive_sha256}"),
    )?;
    if !path.exists() { return Ok(false); }
    let installed: InstalledIndex = serde_json::from_slice(
        &fs::read(path.join("installed.json")).map_err(|_| "The installed index metadata is missing.".to_string())?,
    ).map_err(|_| "The installed index metadata is invalid.".to_string())?;
    if installed.id != id || installed.version != version || installed.archive_sha256 != archive_sha256 {
        return Err("The installed index identity does not match the removal request.".to_string());
    }
    if index_is_in_use(&jobs, &path)? {
        return Err("That reference index is being used by a running analysis.".to_string());
    }
    fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_are_relative_and_platform_neutral() {
        for invalid in ["", "/index/file", "../file", "index/../file", "C:/file", "index\\file"] {
            assert!(safe_relative_path(invalid).is_err(), "accepted {invalid}");
        }
        assert_eq!(safe_relative_path("index/ctable.bin").unwrap(), PathBuf::from("index/ctable.bin"));
    }

    #[test]
    fn catalog_identity_segments_cannot_escape_storage() {
        for valid in ["human-grch38-gencode-v47-si-r91", "1.0.0"] {
            assert!(safe_segment(valid));
        }
        for invalid in ["../human", "Human", "/human", "human/index", ""] {
            assert!(!safe_segment(invalid));
        }
    }

    #[test]
    fn bundle_requires_exact_map_file_and_a_real_index_directory() {
        let file = |path: &str| BundleFile {
            path: path.to_string(),
            sha256: "a".repeat(64),
            size_bytes: 1,
        };
        let bundle = |index_dir: &str, t2g_map: &str, files: Vec<BundleFile>| BundleManifest {
            schema_version: 1,
            kind: BUNDLE_KIND.to_string(),
            index_id: "human".to_string(),
            version: "1.0.0".to_string(),
            index_dir: index_dir.to_string(),
            t2g_map: t2g_map.to_string(),
            gene_id_to_name: None,
            files,
        };

        assert!(validate_bundle(
            &bundle("index", "index/t2g.tsv", vec![file("index/t2g.tsv/child")]),
            "human",
            "1.0.0",
        )
        .is_err());
        assert!(validate_bundle(
            &bundle("index/t2g.tsv", "index/t2g.tsv", vec![file("index/t2g.tsv")]),
            "human",
            "1.0.0",
        )
        .is_err());
    }
}
