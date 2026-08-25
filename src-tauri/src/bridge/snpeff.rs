//! App-managed SnpEff/SnpSift suite, verified databases, and SnpEff annotation.
//!
//! Java remains a host dependency. The two official JARs are one optional suite: an immutable
//! catalog entry is downloaded on demand, verified, extracted into staging, and activated through
//! an atomic pointer. Database archives follow the same rule and never overwrite an unowned
//! directory left by an older or external installation.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Emitter};
use url::Url;
use uuid::Uuid;

use super::{
    app_storage::{resolve_app_path, write_text_atomic},
    jobs::{append_in_process_output, finish_in_process_job, JobRegistry, JobStatus},
    managed_bins::{
        rename_with_retry, sha256_of_file, stream_download, DownloadProgress, DownloadRegistry,
    },
    plugin_progress::lia_plugin_progress,
};

const CATALOG_JSON: &str = include_str!("../../../snpeff-suite/catalog.json");
const CATALOG_KIND: &str = "liatir.snpeff-suite.catalog";
const SUITE_INSTALL_KIND: &str = "liatir.snpeff-suite.installation";
const DATABASE_INSTALL_KIND: &str = "liatir.snpeff-database.installation";
const SUITE_ROOT: &str = "tool-runtimes/snpeff-suite";
const DATA_ROOT: &str = "snpeff-data";
const ACTIVE_FILE: &str = "tool-runtimes/snpeff-suite/active.json";
const MAX_DATABASE_ENTRIES: usize = 100_000;
const DATABASE_EXPANSION_RATIO: u64 = 20;
const DATABASE_EXPANSION_MARGIN: u64 = 64 * 1024 * 1024;

static ACTIVE_OPERATIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    format: String,
    url: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct License {
    spdx_id: String,
    url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteRelease {
    version: String,
    released_at: String,
    java_min_major: u32,
    database_series: String,
    license: License,
    archive: Archive,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Species {
    common_name: String,
    scientific_name: String,
    taxon_id: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Annotation {
    provider: String,
    release: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEntry {
    id: String,
    label: String,
    species: Species,
    assembly: String,
    annotation: Annotation,
    suite_version: String,
    database_series: String,
    archive: Archive,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteCatalog {
    schema_version: u32,
    kind: String,
    recommended_version: String,
    releases: Vec<SuiteRelease>,
    databases: Vec<DatabaseEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledComponent {
    path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledComponents {
    snp_eff: InstalledComponent,
    snp_sift: InstalledComponent,
    config: InstalledComponent,
    license: InstalledComponent,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSuite {
    schema_version: u32,
    kind: String,
    version: String,
    archive_sha256: String,
    install_dir: String,
    database_series: String,
    installed_at: String,
    components: InstalledComponents,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledDatabase {
    schema_version: u32,
    kind: String,
    id: String,
    label: String,
    suite_version: String,
    database_series: String,
    archive_sha256: String,
    install_dir: String,
    installed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteStatus {
    catalog: SuiteCatalog,
    active: Option<InstalledSuite>,
    installed_releases: Vec<InstalledSuite>,
    databases: Vec<InstalledDatabase>,
    data_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteInstallResult {
    active: InstalledSuite,
    reused: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInstallResult {
    installed: InstalledDatabase,
    reused: bool,
}

struct OperationGuard(String);

impl OperationGuard {
    fn acquire(key: String) -> Result<Self, String> {
        let mut active = ACTIVE_OPERATIONS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .map_err(|_| "SnpEff install state is unavailable".to_string())?;
        if active.contains(&key) || (key == "suite" && !active.is_empty()) || active.contains("suite") {
            return Err("A SnpEff/SnpSift install, update, or removal is already running.".to_string());
        }
        active.insert(key.clone());
        Ok(Self(key))
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_OPERATIONS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        {
            active.remove(&self.0);
        }
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn safe_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric()
                || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    // `Path::components` follows the host OS. Reject Windows drive syntax explicitly so an
    // archive validated on Unix cannot become unsafe when the same code runs on Windows.
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(format!("Unsafe path in SnpEff archive: {value}"));
    }
    let mut output = PathBuf::new();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(segment) => output.push(segment),
            _ => return Err(format!("Unsafe path in SnpEff archive: {value}")),
        }
    }
    if output.as_os_str().is_empty() {
        return Err(format!("Unsafe path in SnpEff archive: {value}"));
    }
    Ok(output)
}

fn validate_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid SnpEff asset URL: {error}"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("SnpEff asset URLs cannot contain credentials, a query, or a fragment.".to_string());
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
    Err("SnpEff assets must use HTTPS; debug builds also allow loopback HTTP.".to_string())
}

fn validate_archive(archive: &Archive) -> Result<(), String> {
    if archive.format != "zip" || archive.size_bytes == 0 || !valid_sha256(&archive.sha256) {
        return Err("The SnpEff catalog contains invalid archive metadata.".to_string());
    }
    validate_url(&archive.url)
}

fn validate_catalog(catalog: &SuiteCatalog) -> Result<(), String> {
    if catalog.schema_version != 1 || catalog.kind != CATALOG_KIND {
        return Err("Unsupported SnpEff/SnpSift catalog.".to_string());
    }
    if catalog.releases.is_empty() || catalog.releases.len() > 20 || catalog.databases.is_empty() {
        return Err("The SnpEff catalog is empty or unreasonably large.".to_string());
    }
    let mut releases = HashSet::new();
    for release in &catalog.releases {
        if !safe_identity(&release.version)
            || release.java_min_major < 21
            || release.database_series.trim().is_empty()
            || release.license.spdx_id != "MIT"
            || chrono::NaiveDate::parse_from_str(&release.released_at, "%Y-%m-%d").is_err()
            || !releases.insert(release.version.clone())
        {
            return Err("The SnpEff catalog contains an invalid release.".to_string());
        }
        validate_archive(&release.archive)?;
        validate_url(&release.license.url)?;
    }
    if !releases.contains(&catalog.recommended_version) {
        return Err("The recommended SnpEff release is missing from the catalog.".to_string());
    }
    let mut databases = HashSet::new();
    for database in &catalog.databases {
        let release = catalog
            .releases
            .iter()
            .find(|release| release.version == database.suite_version)
            .ok_or_else(|| "A SnpEff database names an unknown suite release.".to_string())?;
        if !safe_identity(&database.id)
            || database.label.trim().is_empty()
            || database.species.common_name.trim().is_empty()
            || database.species.scientific_name.trim().is_empty()
            || database.species.taxon_id == 0
            || database.assembly.trim().is_empty()
            || database.annotation.provider.trim().is_empty()
            || database.annotation.release.trim().is_empty()
            || database.database_series != release.database_series
            || !databases.insert(format!("{}@{}", database.id, database.suite_version))
        {
            return Err("The SnpEff catalog contains an invalid database.".to_string());
        }
        validate_archive(&database.archive)?;
    }
    Ok(())
}

fn load_catalog() -> Result<SuiteCatalog, String> {
    let contents = if cfg!(debug_assertions) {
        match std::env::var("LIATIR_SNPEFF_SUITE_CATALOG_PATH") {
            Ok(path) => fs::read_to_string(path)
                .map_err(|error| format!("Cannot read the SnpEff test catalog: {error}"))?,
            Err(_) => CATALOG_JSON.to_string(),
        }
    } else {
        CATALOG_JSON.to_string()
    };
    let catalog: SuiteCatalog = serde_json::from_str(&contents)
        .map_err(|error| format!("Invalid SnpEff catalog: {error}"))?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn release_path(app: &AppHandle, release: &SuiteRelease) -> Result<PathBuf, String> {
    resolve_app_path(
        app,
        &format!(
            "{SUITE_ROOT}/releases/{}-{}",
            release.version, release.archive.sha256
        ),
    )
}

fn component_for(path: &Path) -> Result<InstalledComponent, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(format!("Required SnpEff suite file is missing: {}", path.display()));
    }
    Ok(InstalledComponent {
        path: path.to_string_lossy().to_string(),
        sha256: sha256_of_file(&path.to_string_lossy())?,
        size_bytes: metadata.len(),
    })
}

fn verify_component(component: &InstalledComponent, root: &Path) -> Result<(), String> {
    let path = Path::new(&component.path);
    if !path.starts_with(root)
        || fs::metadata(path).map(|metadata| metadata.len()).ok() != Some(component.size_bytes)
        || sha256_of_file(&component.path).ok().as_deref() != Some(component.sha256.as_str())
    {
        return Err("An installed SnpEff/SnpSift component failed verification.".to_string());
    }
    Ok(())
}

fn verify_installed_suite(installed: &InstalledSuite) -> Result<(), String> {
    if installed.schema_version != 1
        || installed.kind != SUITE_INSTALL_KIND
        || !safe_identity(&installed.version)
        || !valid_sha256(&installed.archive_sha256)
    {
        return Err("Installed SnpEff suite metadata is invalid.".to_string());
    }
    let root = Path::new(&installed.install_dir);
    for component in [
        &installed.components.snp_eff,
        &installed.components.snp_sift,
        &installed.components.config,
        &installed.components.license,
    ] {
        verify_component(component, root)?;
    }
    Ok(())
}

fn read_installed_suite(path: &Path) -> Result<InstalledSuite, String> {
    let installed: InstalledSuite = serde_json::from_slice(
        &fs::read(path.join("installed.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if Path::new(&installed.install_dir) != path {
        return Err("Installed SnpEff suite path does not match its metadata.".to_string());
    }
    verify_installed_suite(&installed)?;
    Ok(installed)
}

fn scan_releases(app: &AppHandle) -> Result<Vec<InstalledSuite>, String> {
    let root = resolve_app_path(app, &format!("{SUITE_ROOT}/releases"))?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut installed = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if let Ok(value) = read_installed_suite(&path) {
            installed.push(value);
        }
    }
    installed.sort_by(|left, right| right.installed_at.cmp(&left.installed_at));
    Ok(installed)
}

fn active_suite(app: &AppHandle) -> Result<Option<InstalledSuite>, String> {
    let path = resolve_app_path(app, ACTIVE_FILE)?;
    if !path.exists() {
        return Ok(None);
    }
    let installed: InstalledSuite = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("Cannot read active SnpEff suite: {error}"))?,
    )
    .map_err(|error| format!("Invalid active SnpEff suite metadata: {error}"))?;
    let releases_root = resolve_app_path(app, &format!("{SUITE_ROOT}/releases"))?;
    let install_dir = Path::new(&installed.install_dir);
    if !install_dir.starts_with(&releases_root) {
        return Err("The active SnpEff suite points outside managed storage.".to_string());
    }
    let verified = read_installed_suite(install_dir)?;
    if verified.version != installed.version || verified.archive_sha256 != installed.archive_sha256 {
        return Err("The active SnpEff suite pointer does not match its installation.".to_string());
    }
    Ok(Some(verified))
}

fn database_marker(path: &Path) -> PathBuf {
    path.join(".liatir-installed.json")
}

fn verify_installed_database(installed: &InstalledDatabase) -> Result<(), String> {
    if installed.schema_version != 1
        || installed.kind != DATABASE_INSTALL_KIND
        || !safe_identity(&installed.id)
        || !valid_sha256(&installed.archive_sha256)
        || !Path::new(&installed.install_dir).join("snpEffectPredictor.bin").is_file()
    {
        return Err("Installed SnpEff database metadata is invalid.".to_string());
    }
    Ok(())
}

fn read_installed_database(path: &Path) -> Result<InstalledDatabase, String> {
    let installed: InstalledDatabase = serde_json::from_slice(
        &fs::read(database_marker(path)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if Path::new(&installed.install_dir) != path {
        return Err("Installed SnpEff database path does not match its metadata.".to_string());
    }
    verify_installed_database(&installed)?;
    Ok(installed)
}

fn scan_databases(data_root: &Path) -> Result<Vec<InstalledDatabase>, String> {
    if !data_root.exists() {
        return Ok(Vec::new());
    }
    let mut installed = Vec::new();
    for entry in fs::read_dir(data_root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if let Ok(value) = read_installed_database(&path) {
            installed.push(value);
        }
    }
    installed.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(installed)
}

fn logical_job_cancel_flag(jobs: &JobRegistry, job_id: &str) -> Result<Arc<AtomicBool>, String> {
    let states = jobs
        .jobs
        .lock()
        .map_err(|_| "Job registry is unavailable".to_string())?;
    let state = states
        .get(job_id)
        .ok_or_else(|| format!("Dependency Job not found: {job_id}"))?;
    if state.entry.status != JobStatus::Running || state.child.is_some() {
        return Err("The dependency Job is not running.".to_string());
    }
    state
        .cancelled
        .clone()
        .ok_or_else(|| "The dependency Job cannot be cancelled.".to_string())
}

fn job_log(app: &AppHandle, job_id: &str, line: impl Into<String>) {
    append_in_process_output(app, job_id, "stdout", line.into());
}

fn job_progress(app: &AppHandle, job_id: &str, current: u64, total: u64, label: &str, done: bool) {
    let _ = lia_plugin_progress(
        app.clone(),
        job_id.to_string(),
        Some(current),
        Some(total),
        Some(label.to_string()),
        None,
        Some(done),
    );
}

fn finish_download_event(app: &AppHandle, id: &str, result: &Result<u64, String>) {
    let (bytes_downloaded, bytes_total, error) = match result {
        Ok(bytes) => (*bytes, Some(*bytes), None),
        Err(error) => (0, None, Some(error.clone())),
    };
    let _ = app.emit(
        &format!("managed:progress:{id}"),
        DownloadProgress {
            id: id.to_string(),
            bytes_downloaded,
            bytes_total,
            bytes_per_sec: 0.0,
            done: true,
            error,
        },
    );
}

async fn download_archive(
    app: &AppHandle,
    downloads: &DownloadRegistry,
    job_flag: Arc<AtomicBool>,
    download_id: &str,
    archive: &Archive,
    destination: &Path,
) -> Result<(), String> {
    let already_valid = destination.is_file()
        && fs::metadata(destination).map(|metadata| metadata.len()).ok() == Some(archive.size_bytes)
        && sha256_of_file(&destination.to_string_lossy()).ok().as_deref()
            == Some(archive.sha256.as_str());
    if already_valid {
        return Ok(());
    }
    let _ = fs::remove_file(destination);
    downloads.register_shared(download_id, job_flag.clone())?;
    let result = stream_download(
        app,
        download_id,
        &archive.url,
        &destination.to_string_lossy(),
        Some(&archive.sha256),
        &job_flag,
    )
    .await;
    downloads.unregister(download_id);
    finish_download_event(app, download_id, &result);
    let bytes = result?;
    if bytes != archive.size_bytes {
        let _ = fs::remove_file(destination);
        return Err("The downloaded SnpEff archive has an unexpected size.".to_string());
    }
    Ok(())
}

fn release_path_from_staging(staging: &Path, release: &SuiteRelease) -> Result<PathBuf, String> {
    let releases = staging
        .parent()
        .ok_or_else(|| "Invalid SnpEff staging path".to_string())?;
    Ok(releases.join(format!("{}-{}", release.version, release.archive.sha256)))
}

fn extract_suite_archive(
    archive_path: &Path,
    staging: &Path,
    release: &SuiteRelease,
) -> Result<InstalledSuite, String> {
    const REQUIRED: [(&str, &str); 4] = [
        ("snpEff/snpEff.jar", "snpEff.jar"),
        ("snpEff/SnpSift.jar", "SnpSift.jar"),
        ("snpEff/snpEff.config", "snpEff.config"),
        ("snpEff/LICENSE.md", "LICENSE.md"),
    ];
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Invalid SnpEff suite ZIP: {error}"))?;
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut source = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = source.name().to_string();
        safe_relative_path(&name)?;
        if source.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("The SnpEff suite archive cannot contain symbolic links.".to_string());
        }
        let Some((_, destination_name)) = REQUIRED.iter().find(|(expected, _)| *expected == name) else {
            continue;
        };
        if !seen.insert(name.clone()) {
            return Err(format!("Duplicate file in SnpEff suite archive: {name}"));
        }
        let destination = staging.join(destination_name);
        let mut output = fs::File::create(&destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut source, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
    }
    if seen.len() != REQUIRED.len() {
        return Err("The SnpEff suite archive is missing SnpEff, SnpSift, its config, or license.".to_string());
    }
    let config = fs::read_to_string(staging.join("snpEff.config")).map_err(|error| error.to_string())?;
    if !config.lines().any(|line| line.trim_start().starts_with("database.repository")) {
        return Err("The SnpEff suite config has no database repository.".to_string());
    }
    let final_path = release_path_from_staging(staging, release)?;
    let component = |name: &str| -> Result<InstalledComponent, String> {
        let staged = component_for(&staging.join(name))?;
        Ok(InstalledComponent {
            path: final_path.join(name).to_string_lossy().to_string(),
            ..staged
        })
    };
    Ok(InstalledSuite {
        schema_version: 1,
        kind: SUITE_INSTALL_KIND.to_string(),
        version: release.version.clone(),
        archive_sha256: release.archive.sha256.clone(),
        install_dir: final_path.to_string_lossy().to_string(),
        database_series: release.database_series.clone(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        components: InstalledComponents {
            snp_eff: component("snpEff.jar")?,
            snp_sift: component("SnpSift.jar")?,
            config: component("snpEff.config")?,
            license: component("LICENSE.md")?,
        },
    })
}

fn extract_database_archive(
    archive_path: &Path,
    staging: &Path,
    database: &DatabaseEntry,
) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Invalid SnpEff database ZIP: {error}"))?;
    if archive.is_empty() || archive.len() > MAX_DATABASE_ENTRIES {
        return Err("The SnpEff database archive has an invalid number of files.".to_string());
    }
    let prefix = format!("data/{}/", database.id);
    let max_uncompressed = database
        .archive
        .size_bytes
        .saturating_mul(DATABASE_EXPANSION_RATIO)
        .saturating_add(DATABASE_EXPANSION_MARGIN);
    let mut total = 0u64;
    let mut predictor = false;
    let mut seen = HashSet::new();
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut source = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = source.name().to_string();
        if source.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("The SnpEff database archive cannot contain symbolic links.".to_string());
        }
        let relative = name
            .strip_prefix(&prefix)
            .ok_or_else(|| format!("Unexpected file in SnpEff database archive: {name}"))?;
        if relative.is_empty() {
            continue;
        }
        let relative = safe_relative_path(relative)?;
        if !seen.insert(relative.clone()) {
            return Err(format!("Duplicate file in SnpEff database archive: {name}"));
        }
        total = total.saturating_add(source.size());
        if total > max_uncompressed {
            return Err("The SnpEff database archive expands beyond its safety limit.".to_string());
        }
        let destination = staging.join(&relative);
        if source.is_dir() {
            fs::create_dir_all(destination).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(&destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut source, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        if relative == Path::new("snpEffectPredictor.bin") {
            predictor = fs::metadata(&destination).map(|metadata| metadata.len() > 0).unwrap_or(false);
        }
    }
    if !predictor {
        return Err("The SnpEff database archive has no predictor file.".to_string());
    }
    Ok(())
}

fn job_uses_suite(jobs: &JobRegistry, root: &Path) -> Result<bool, String> {
    let states = jobs.jobs.lock().map_err(|_| "Job registry is unavailable".to_string())?;
    Ok(states.values().any(|job| {
        job.entry.status == JobStatus::Running
            && job.entry.args.iter().any(|argument| Path::new(argument).starts_with(root))
    }))
}

fn job_uses_database(jobs: &JobRegistry, database: &InstalledDatabase) -> Result<bool, String> {
    let states = jobs.jobs.lock().map_err(|_| "Job registry is unavailable".to_string())?;
    Ok(states.values().any(|job| {
        if job.entry.status != JobStatus::Running {
            return false;
        }
        job.entry
            .metadata
            .as_ref()
            .and_then(|value| value.get("snpeffDatabaseId"))
            .and_then(serde_json::Value::as_str)
            == Some(database.id.as_str())
    }))
}

#[tauri::command]
pub fn lia_snpeff_suite_status(app: AppHandle) -> Result<SuiteStatus, String> {
    let catalog = load_catalog()?;
    let data_root = resolve_app_path(&app, DATA_ROOT)?;
    Ok(SuiteStatus {
        catalog,
        active: active_suite(&app)?,
        installed_releases: scan_releases(&app)?,
        databases: scan_databases(&data_root)?,
        data_dir: data_root.to_string_lossy().to_string(),
    })
}

async fn install_suite_inner(
    app: &AppHandle,
    downloads: &DownloadRegistry,
    jobs: &JobRegistry,
    version: &str,
    download_id: &str,
    job_id: &str,
) -> Result<SuiteInstallResult, String> {
    if !safe_identity(version) || download_id.trim().is_empty() {
        return Err("Invalid SnpEff suite install request.".to_string());
    }
    let _guard = OperationGuard::acquire("suite".to_string())?;
    let job_flag = logical_job_cancel_flag(jobs, job_id)?;
    let catalog = load_catalog()?;
    let release = catalog
        .releases
        .into_iter()
        .find(|release| release.version == version)
        .ok_or_else(|| "That SnpEff release is not in Liatir's catalog.".to_string())?;
    let final_path = release_path(app, &release)?;
    if let Ok(installed) = read_installed_suite(&final_path) {
        write_text_atomic(
            &resolve_app_path(app, ACTIVE_FILE)?,
            &format!("{}\n", serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?),
        )?;
        return Ok(SuiteInstallResult { active: installed, reused: true });
    }

    let downloads_dir = resolve_app_path(app, &format!("{SUITE_ROOT}/downloads"))?;
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let archive_path = downloads_dir.join(format!("{}.zip", release.archive.sha256));
    job_progress(app, job_id, 0, 4, "Downloading verified suite", false);
    job_log(app, job_id, format!("Downloading SnpEff and SnpSift {}", release.version));
    download_archive(
        app,
        downloads,
        job_flag.clone(),
        download_id,
        &release.archive,
        &archive_path,
    )
    .await?;
    if job_flag.load(Ordering::SeqCst) {
        return Err("SnpEff suite installation cancelled.".to_string());
    }
    job_progress(app, job_id, 2, 4, "Verifying and extracting", false);

    let releases_root = resolve_app_path(app, &format!("{SUITE_ROOT}/releases"))?;
    fs::create_dir_all(&releases_root).map_err(|error| error.to_string())?;
    let staging = releases_root.join(format!(".{}.staging.{}", release.archive.sha256, Uuid::new_v4()));
    let installed = match extract_suite_archive(&archive_path, &staging, &release) {
        Ok(installed) => installed,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if job_flag.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(&staging);
        return Err("SnpEff suite installation cancelled.".to_string());
    }
    write_text_atomic(
        &staging.join("installed.json"),
        &format!("{}\n", serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?),
    )?;
    if final_path.exists() {
        if job_uses_suite(jobs, &final_path)? {
            let _ = fs::remove_dir_all(&staging);
            return Err("That SnpEff/SnpSift release is being used by a running analysis.".to_string());
        }
        fs::remove_dir_all(&final_path).map_err(|error| error.to_string())?;
    }
    rename_with_retry(&staging, &final_path).map_err(|error| error.to_string())?;
    verify_installed_suite(&installed)?;
    job_progress(app, job_id, 3, 4, "Activating suite", false);
    write_text_atomic(
        &resolve_app_path(app, ACTIVE_FILE)?,
        &format!("{}\n", serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?),
    )?;
    let _ = fs::remove_file(archive_path);
    job_progress(app, job_id, 4, 4, "SnpEff and SnpSift ready", true);
    Ok(SuiteInstallResult { active: installed, reused: false })
}

#[tauri::command]
pub async fn lia_snpeff_suite_install(
    app: AppHandle,
    downloads: tauri::State<'_, DownloadRegistry>,
    jobs: tauri::State<'_, JobRegistry>,
    version: String,
    download_id: String,
    job_id: String,
) -> Result<SuiteInstallResult, String> {
    let result = install_suite_inner(&app, &downloads, &jobs, &version, &download_id, &job_id).await;
    match &result {
        Ok(_) => job_log(&app, &job_id, "SnpEff and SnpSift installed and verified."),
        Err(error) => append_in_process_output(&app, &job_id, "stderr", error.clone()),
    }
    finish_in_process_job(&app, &job_id, result.is_ok());
    result
}

#[tauri::command]
pub fn lia_snpeff_suite_remove(
    app: AppHandle,
    jobs: tauri::State<'_, JobRegistry>,
) -> Result<bool, String> {
    let _guard = OperationGuard::acquire("suite".to_string())?;
    let root = resolve_app_path(&app, SUITE_ROOT)?;
    if !root.exists() {
        return Ok(false);
    }
    let releases = root.join("releases");
    if job_uses_suite(&jobs, &releases)? {
        return Err("SnpEff or SnpSift is being used by a running analysis.".to_string());
    }
    fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    Ok(true)
}

async fn install_database_inner(
    app: &AppHandle,
    downloads: &DownloadRegistry,
    jobs: &JobRegistry,
    id: &str,
    suite_version: &str,
    download_id: &str,
    job_id: &str,
) -> Result<DatabaseInstallResult, String> {
    if !safe_identity(id) || !safe_identity(suite_version) || download_id.trim().is_empty() {
        return Err("Invalid SnpEff database install request.".to_string());
    }
    let _guard = OperationGuard::acquire(format!("database:{id}"))?;
    let job_flag = logical_job_cancel_flag(jobs, job_id)?;
    let active = active_suite(app)?.ok_or_else(|| "Install SnpEff and SnpSift first.".to_string())?;
    if active.version != suite_version {
        return Err("The selected database does not match the active SnpEff release.".to_string());
    }
    let catalog = load_catalog()?;
    let database = catalog
        .databases
        .into_iter()
        .find(|database| database.id == id && database.suite_version == suite_version)
        .ok_or_else(|| "That SnpEff database is not in Liatir's verified catalog.".to_string())?;
    let data_root = resolve_app_path(app, DATA_ROOT)?;
    fs::create_dir_all(&data_root).map_err(|error| error.to_string())?;
    let final_path = data_root.join(&database.id);
    if let Ok(installed) = read_installed_database(&final_path) {
        if installed.archive_sha256 == database.archive.sha256 {
            return Ok(DatabaseInstallResult { installed, reused: true });
        }
    } else if final_path.exists() {
        return Err(format!(
            "A database named {} already exists and is not managed by Liatir. It was left untouched.",
            database.id
        ));
    }

    let downloads_dir = data_root.join(".downloads");
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let archive_path = downloads_dir.join(format!("{}.zip", database.archive.sha256));
    job_progress(app, job_id, 0, 4, "Downloading verified database", false);
    job_log(app, job_id, format!("Downloading {}", database.label));
    download_archive(
        app,
        downloads,
        job_flag.clone(),
        download_id,
        &database.archive,
        &archive_path,
    )
    .await?;
    if job_flag.load(Ordering::SeqCst) {
        return Err("SnpEff database installation cancelled.".to_string());
    }
    job_progress(app, job_id, 2, 4, "Verifying and extracting database", false);
    let staging = data_root.join(format!(".{}.staging.{}", database.archive.sha256, Uuid::new_v4()));
    if let Err(error) = extract_database_archive(&archive_path, &staging, &database) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let installed = InstalledDatabase {
        schema_version: 1,
        kind: DATABASE_INSTALL_KIND.to_string(),
        id: database.id.clone(),
        label: database.label.clone(),
        suite_version: database.suite_version.clone(),
        database_series: database.database_series.clone(),
        archive_sha256: database.archive.sha256.clone(),
        install_dir: final_path.to_string_lossy().to_string(),
        installed_at: chrono::Utc::now().to_rfc3339(),
    };
    write_text_atomic(
        &database_marker(&staging),
        &format!("{}\n", serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?),
    )?;
    if job_flag.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(&staging);
        return Err("SnpEff database installation cancelled.".to_string());
    }
    let mut backup_path = None;
    if final_path.exists() {
        let previous = read_installed_database(&final_path)?;
        if job_uses_database(jobs, &previous)? {
            let _ = fs::remove_dir_all(&staging);
            return Err("That SnpEff database is being used by a running analysis.".to_string());
        }
        let backup = data_root.join(format!(
            ".{}.backup.{}",
            database.archive.sha256,
            Uuid::new_v4()
        ));
        rename_with_retry(&final_path, &backup).map_err(|error| error.to_string())?;
        backup_path = Some(backup);
    }
    if let Err(error) = rename_with_retry(&staging, &final_path) {
        let _ = fs::remove_dir_all(&staging);
        if let Some(backup) = backup_path.as_ref() {
            let rollback = rename_with_retry(backup, &final_path);
            if let Err(rollback_error) = rollback {
                return Err(format!(
                    "Cannot activate the SnpEff database ({error}); rollback also failed ({rollback_error})."
                ));
            }
        }
        return Err(error.to_string());
    }
    if let Err(error) = verify_installed_database(&installed) {
        let _ = fs::remove_dir_all(&final_path);
        if let Some(backup) = backup_path.as_ref() {
            if let Err(rollback_error) = rename_with_retry(backup, &final_path) {
                return Err(format!(
                    "The installed SnpEff database failed verification ({error}); rollback also failed ({rollback_error})."
                ));
            }
        }
        return Err(error);
    }
    if let Some(backup) = backup_path {
        fs::remove_dir_all(backup).map_err(|error| error.to_string())?;
    }
    let _ = fs::remove_file(archive_path);
    job_progress(app, job_id, 4, 4, "Database ready", true);
    Ok(DatabaseInstallResult { installed, reused: false })
}

#[tauri::command]
pub async fn lia_snpeff_database_install(
    app: AppHandle,
    downloads: tauri::State<'_, DownloadRegistry>,
    jobs: tauri::State<'_, JobRegistry>,
    id: String,
    suite_version: String,
    download_id: String,
    job_id: String,
) -> Result<DatabaseInstallResult, String> {
    let result = install_database_inner(
        &app,
        &downloads,
        &jobs,
        &id,
        &suite_version,
        &download_id,
        &job_id,
    )
    .await;
    match &result {
        Ok(_) => job_log(&app, &job_id, "SnpEff database installed and verified."),
        Err(error) => append_in_process_output(&app, &job_id, "stderr", error.clone()),
    }
    finish_in_process_job(&app, &job_id, result.is_ok());
    result
}

#[tauri::command]
pub fn lia_snpeff_database_remove(
    app: AppHandle,
    jobs: tauri::State<'_, JobRegistry>,
    id: String,
    suite_version: String,
    archive_sha256: String,
) -> Result<bool, String> {
    if !safe_identity(&id) || !safe_identity(&suite_version) || !valid_sha256(&archive_sha256) {
        return Err("Invalid SnpEff database removal request.".to_string());
    }
    let _guard = OperationGuard::acquire(format!("database:{id}"))?;
    let path = resolve_app_path(&app, &format!("{DATA_ROOT}/{id}"))?;
    if !path.exists() {
        return Ok(false);
    }
    let installed = read_installed_database(&path)?;
    if installed.id != id
        || installed.suite_version != suite_version
        || installed.archive_sha256 != archive_sha256
    {
        return Err("The SnpEff database identity does not match the removal request.".to_string());
    }
    if job_uses_database(&jobs, &installed)? {
        return Err("That SnpEff database is being used by a running analysis.".to_string());
    }
    fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    Ok(true)
}

/// Run SnpEff annotation with zero stdout memory overhead.
///
/// This command remains for the native IPC surface. The main frontend execution path uses the
/// shared Jobs runner with an OS-level stdout file for identical streaming behavior.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // The IPC command mirrors SnpEff's explicit run inputs.
pub async fn lia_snpeff_annotate(
    app: AppHandle,
    jar_path: String,
    genome: String,
    data_dir: String,
    input_vcf: String,
    output_vcf: String,
    heap: String,
    job_id: String,
    java_path: Option<String>,
) -> Result<serde_json::Value, String> {
    if let Some(parent) = Path::new(&output_vcf).parent() {
        fs::create_dir_all(parent).map_err(|error| format!("cannot create output dir: {error}"))?;
    }
    let stats_base = output_vcf.strip_suffix(".vcf").unwrap_or(&output_vcf).to_string();
    let stats_html = format!("{stats_base}-summary.html");
    let stats_genes = format!("{stats_base}-summary.genes.txt");

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let out_file = fs::File::create(&output_vcf)
            .map_err(|error| format!("cannot create output file: {error}"))?;
        let java_bin = java_path.as_deref().filter(|value| !value.is_empty()).unwrap_or("java");
        let mut child = Command::new(java_bin)
            .args([
                &format!("-Xmx{heap}"),
                "-jar",
                &jar_path,
                "ann",
                "-dataDir",
                &data_dir,
                "-noLog",
                "-stats",
                &stats_html,
                &genome,
                &input_vcf,
            ])
            .stdout(out_file)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to spawn java: {error}"))?;
        let stderr = child.stderr.take().ok_or_else(|| "failed to capture stderr".to_string())?;
        let mut stderr_lines = Vec::new();
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    if stderr_lines.len() < 2_000 {
                        stderr_lines.push(line.clone());
                    }
                    let _ = app.emit(&format!("jobs:stderr:{job_id}"), line);
                }
                Err(_) => break,
            }
        }
        let status = child.wait().map_err(|error| format!("wait error: {error}"))?;
        let exit_code = status.code();
        Ok::<serde_json::Value, String>(serde_json::json!({
            "ok": exit_code == Some(0),
            "exitCode": exit_code,
            "stderr": stderr_lines,
            "statsHtml": stats_html,
            "statsGenes": stats_genes,
        }))
    })
    .await
    .map_err(|error| format!("task error: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_is_complete_and_immutable() {
        let catalog = load_catalog().unwrap();
        assert_eq!(catalog.recommended_version, "5.4c");
        assert_eq!(catalog.releases.len(), 1);
        assert_eq!(catalog.databases.len(), 6);
        assert!(catalog.releases[0].archive.url.contains("snpEff_v5_4c_core.zip"));
        assert!(!catalog.releases[0].archive.url.contains("latest"));
    }

    #[test]
    fn archive_paths_cannot_escape_staging() {
        for invalid in ["", "/absolute", "../escape", "data/../escape", "C:/escape", "a\\b"] {
            assert!(safe_relative_path(invalid).is_err(), "accepted {invalid}");
        }
        assert_eq!(
            safe_relative_path("data/GRCh38.115/file.bin").unwrap(),
            PathBuf::from("data/GRCh38.115/file.bin")
        );
    }

    #[test]
    fn database_identity_allows_upstream_ids_but_not_paths() {
        for valid in ["GRCh38.115", "R64-1-1.115", "5.4c"] {
            assert!(safe_identity(valid));
        }
        for invalid in ["../GRCh38", "/GRCh38", "data/GRCh38", ""] {
            assert!(!safe_identity(invalid));
        }
    }
}
