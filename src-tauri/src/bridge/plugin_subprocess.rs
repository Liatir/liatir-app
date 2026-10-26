//! R/Native adapters share the existing authenticated IPC and Jobs runner.
use super::*;
use fs2::FileExt;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, process::Command};

pub(super) fn runtime(manifest: &Value) -> Result<&str, String> {
    match manifest.get("runtime") {
        None => Ok("node"),
        Some(Value::String(value))
            if ["node", "wasm", "python", "r", "native"].contains(&value.as_str()) =>
        {
            Ok(value)
        }
        value => Err(format!("Unsupported Plugin runtime: {value:?}")),
    }
}

pub(super) fn native_target(os: &str, arch: &str) -> Result<String, String> {
    let os = if os == "macos" {
        "macos"
    } else if os == "windows" {
        "windows"
    } else if os == "linux" {
        "linux"
    } else {
        return Err(format!("Unsupported Native Plugin OS: {os}"));
    };
    if !["aarch64", "x86_64"].contains(&arch) {
        return Err(format!("Unsupported Native Plugin architecture: {arch}"));
    }
    Ok(format!("{os}-{arch}"))
}

pub(super) fn native_entry(manifest: &Value, target: &str) -> Result<String, String> {
    if manifest["native"]["protocol"].as_u64() != Some(1) {
        return Err("Native Plugin requires protocol 1".into());
    }
    let targets = manifest["native"]["targets"]
        .as_object()
        .ok_or("Native Plugin is missing executable targets")?;
    if targets.is_empty() {
        return Err("Native Plugin has no executable targets".into());
    }
    for (name, path) in targets {
        let Some((os, arch)) = name.split_once('-') else {
            return Err(format!("Invalid Native target: {name}"));
        };
        native_target(os, arch)?;
        let path = path
            .as_str()
            .ok_or("Native executable path must be a string")?;
        validate_relative_path(path)?;
        if !path.starts_with(&format!("native/{name}/")) {
            return Err(format!("Native executable must be inside native/{name}/"));
        }
    }
    targets
        .get(target)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| {
            format!(
                "This Native Plugin does not support {target}. Available targets: {}",
                targets.keys().cloned().collect::<Vec<_>>().join(", ")
            )
        })
}

pub(super) fn bundle_hash(zip: &BundleArchive) -> String {
    hex_lower(&Sha256::digest(
        zip.clone().into_inner().into_inner().as_ref(),
    ))
}

pub(super) fn validate_manifest(zip: &mut BundleArchive, manifest: &Value) -> Result<(), String> {
    let runtime = runtime(manifest)?;
    if runtime != "native" && runtime != "r" {
        return Ok(());
    }
    for key in ["name", "version"] {
        if manifest[key]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .is_none()
        {
            return Err(format!("Plugin {key} must be a non-empty string"));
        }
    }
    for (kind, types) in [
        ("inputSchema", &["string", "number", "boolean", "file"][..]),
        (
            "outputSchema",
            &["string", "number", "boolean", "file", "json", "stats"][..],
        ),
    ] {
        let schema = manifest[kind]
            .as_object()
            .ok_or_else(|| format!("{kind} must be an object"))?;
        for (name, field) in schema {
            if name.is_empty() || !types.contains(&field["type"].as_str().unwrap_or_default()) {
                return Err(format!("Invalid {kind} field: {name}"));
            }
        }
    }
    let entries = if runtime == "native" {
        let targets = manifest["native"]["targets"]
            .as_object()
            .ok_or("Native Plugin is missing targets")?;
        let first = targets
            .keys()
            .next()
            .ok_or("Native Plugin needs at least one target")?;
        native_entry(manifest, first)?;
        targets
            .values()
            .map(|v| v.as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>()
    } else {
        r_lock(zip, manifest)?;
        vec![
            manifest["r"]["entry"]
                .as_str()
                .ok_or("Missing R entry")?
                .to_string(),
            "r/_prepare.R".into(),
        ]
    };
    for path in entries {
        if zip
            .by_name(&path)
            .map(|entry| !entry.is_file())
            .unwrap_or(true)
        {
            return Err(format!("Plugin payload file is missing: {path}"));
        }
    }
    Ok(())
}

fn native_trust_path(app: &AppHandle, hash: &str) -> Result<PathBuf, String> {
    Ok(super::super::python_env::data_root(app)?
        .join("native-plugin-trust")
        .join(hash))
}

pub(super) fn trust(app: &AppHandle, path: &str) -> Result<(), String> {
    let mut zip = open_validated(path)?;
    let manifest = read_manifest(&mut zip)?;
    if runtime(&manifest)? != "native" {
        return Err("Only Native Plugins require executable trust".into());
    }
    native_entry(
        &manifest,
        &native_target(std::env::consts::OS, std::env::consts::ARCH)?,
    )?;
    let receipt = native_trust_path(app, &bundle_hash(&zip))?;
    fs::create_dir_all(receipt.parent().ok_or("Invalid trust directory")?)
        .map_err(|e| e.to_string())?;
    fs::write(
        receipt,
        b"Native executable access explicitly allowed by user\n",
    )
    .map_err(|e| e.to_string())
}

fn r_interpreter(manifest: &Value) -> Result<(String, String), String> {
    let minimum = manifest["r"]["minVersion"].as_str().unwrap_or("4.1");
    let minimum_parts: Vec<u32> = minimum
        .split('.')
        .map(|p| p.parse::<u32>().unwrap_or(u32::MAX))
        .collect();
    let mut candidates = Vec::new();
    if let Ok(explicit) = std::env::var("LIATIR_RSCRIPT") {
        candidates.push(explicit);
    }
    candidates.extend(
        [
            "Rscript",
            "/opt/homebrew/bin/Rscript",
            "/usr/local/bin/Rscript",
            "/Library/Frameworks/R.framework/Resources/bin/Rscript",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        if let Ok(entries) = fs::read_dir(Path::new(&program_files).join("R")) {
            let mut dirs = entries.flatten().map(|e| e.path()).collect::<Vec<_>>();
            dirs.sort();
            dirs.reverse();
            for dir in dirs {
                candidates.push(dir.join("bin/Rscript.exe").to_string_lossy().to_string());
            }
        }
    }
    for binary in candidates {
        let Ok(output) = Command::new(&binary)
            .args(["--vanilla", "-e", "cat(as.character(getRversion()))"])
            .output()
        else {
            continue;
        };
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<u32> = version.split('.').filter_map(|p| p.parse().ok()).collect();
        let size = parts.len().max(minimum_parts.len());
        let actual = (0..size)
            .map(|i| parts.get(i).copied().unwrap_or(0))
            .collect::<Vec<_>>();
        let required = (0..size)
            .map(|i| minimum_parts.get(i).copied().unwrap_or(0))
            .collect::<Vec<_>>();
        if output.status.success() && !parts.is_empty() && actual >= required {
            return Ok((binary, version));
        }
    }
    Err(format!("R >= {minimum} is required. Install R from r-project.org, restart Liatir, or set LIATIR_RSCRIPT to Rscript. R is only needed for R Plugins."))
}

fn r_lock(zip: &mut BundleArchive, manifest: &Value) -> Result<Value, String> {
    let entry = manifest["r"]["entry"]
        .as_str()
        .ok_or("R Plugin is missing r.entry")?;
    validate_relative_path(entry)?;
    if !entry.starts_with("r/") {
        return Err("R entry must be inside r/".into());
    }
    let path = manifest["r"]["lockfile"]
        .as_str()
        .ok_or("R Plugin is missing its renv lockfile")?;
    validate_relative_path(path)?;
    if !path.starts_with("r/") {
        return Err("R lockfile must be inside r/".into());
    }
    let lock =
        read_zip_entry_bytes(zip, path)?.ok_or("R dependency lockfile is missing from bundle")?;
    let lock: Value = serde_json::from_slice(&lock).map_err(|e| e.to_string())?;
    let packages = lock["Packages"]
        .as_object()
        .ok_or("Invalid R dependency lockfile")?;
    if let Some(minimum) = manifest["r"].get("minVersion") {
        let value = minimum
            .as_str()
            .ok_or("R minVersion must be a version string")?;
        let parts = value.split('.').collect::<Vec<_>>();
        if parts.is_empty()
            || parts.len() > 3
            || parts
                .iter()
                .any(|part| part.is_empty() || part.parse::<u32>().is_err())
        {
            return Err("Invalid R minimum version".into());
        }
    }
    for (name, package) in packages {
        if name.is_empty()
            || package["Version"]
                .as_str()
                .filter(|v| !v.is_empty())
                .is_none()
        {
            return Err("Invalid locked R package record".into());
        }
    }
    if manifest["r"]
        .get("packages")
        .map(|value| !value.is_array())
        .unwrap_or(false)
    {
        return Err("R packages must be an array of package names".into());
    }

    if !packages.contains_key("jsonlite") {
        return Err("R lockfile must include the jsonlite SDK dependency".into());
    }
    if let Some(declared) = manifest["r"]["packages"].as_array() {
        for package in declared {
            let name = package
                .as_str()
                .ok_or("R package names must be strings")?
                .trim_start_matches("bioc::");
            if !packages.contains_key(name) {
                return Err(format!("R lockfile is missing declared package: {name}"));
            }
        }
    }
    Ok(lock)
}

fn r_environment_id(
    manifest: &Value,
    lock: &Value,
    binary: &str,
    version: &str,
) -> Result<String, String> {
    let hash = hex_lower(&Sha256::digest(
        serde_json::to_vec(&json!({
            "pluginName": manifest["name"], "pluginVersion": manifest["version"],
            "lock": lock, "interpreter": binary, "version": version,
        }))
        .map_err(|e| e.to_string())?,
    ));
    Ok(format!("r-{}", &hash[..24]))
}

fn r_environment(
    app: &AppHandle,
    manifest: &Value,
    lock: &Value,
    binary: &str,
    version: &str,
    options: &LiaPluginRunOptions,
) -> Result<PathBuf, String> {
    let base = if let Some(session) = options
        .env
        .as_ref()
        .and_then(|env| env.get("LIATIR_DEV_SESSION_ID"))
    {
        super::super::plugin_dev::validate_session_id(session)?;
        super::super::fs::base_dir(app, false)
            .join(super::super::plugin_dev::session_sandbox_rel(session))
            .join("r-runtimes")
    } else {
        super::super::python_env::data_root(app)?.join("plugin-runtimes")
    };
    Ok(base.join(r_environment_id(manifest, lock, binary, version)?))
}

fn r_probe(binary: &str, library: &Path, lock: &Value) -> Result<Vec<String>, String> {
    if !library.exists() {
        return Ok(lock["Packages"]
            .as_object()
            .ok_or("Invalid R lock")?
            .keys()
            .cloned()
            .collect());
    }
    // Keep JSON and paths out of R source. Rscript's -e decoding rewrites some
    // escaped sequences; package metadata and Windows paths must stay literal.
    let script = r#"args <- commandArgs(trailingOnly=TRUE)
library <- args[[1]]
.libPaths(c(library, .Library))
missing <- character()
for (index in seq.int(2L, length(args), by=2L)) {
    name <- args[[index]]
    expected <- args[[index+1L]]
    if (!requireNamespace(name, quietly=TRUE, lib.loc=library) ||
        as.character(utils::packageVersion(name, lib.loc=library)) != expected) missing <- c(missing, name)
}
cat(paste(missing, collapse='\n'))"#;
    let mut command = Command::new(binary);
    command.args(["--vanilla", "-e", script]).arg(library);
    for (name, package) in lock["Packages"].as_object().ok_or("Invalid R lock")? {
        command.arg(name).arg(
            package["Version"]
                .as_str()
                .ok_or("Missing locked R package version")?,
        );
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect())
}

pub(super) fn status(app: &AppHandle, path: &str) -> Result<Value, String> {
    let mut zip = open_validated(path)?;
    let manifest = read_manifest(&mut zip)?;
    match runtime(&manifest)? {
        "native" => {
            let target = native_target(std::env::consts::OS, std::env::consts::ARCH)?;
            if let Err(error) = native_entry(&manifest, &target) {
                return Ok(
                    json!({"runtime":"native", "ready":false, "target":target, "error":error}),
                );
            }
            let trusted = native_trust_path(app, &bundle_hash(&zip))?.is_file();
            Ok(json!({"runtime":"native", "ready":trusted, "trusted":trusted, "target":target}))
        }
        "r" => {
            let lock = r_lock(&mut zip, &manifest)?;
            let (binary, version) = match r_interpreter(&manifest) {
                Ok(value) => value,
                Err(error) => return Ok(json!({"runtime":"r", "ready":false, "error":error})),
            };
            let dir = r_environment(
                app,
                &manifest,
                &lock,
                &binary,
                &version,
                &LiaPluginRunOptions::default(),
            )?;
            let missing = r_probe(&binary, &dir.join("library"), &lock)?;
            Ok(
                json!({"runtime":"r", "ready":missing.is_empty(), "interpreter":binary, "version":version,
                "envId":dir.file_name().and_then(|s| s.to_str()), "missingPackages":missing}),
            )
        }
        _ => Err("Runtime readiness is available here for R and Native Plugins".into()),
    }
}

pub(super) fn prepare(
    app: &AppHandle,
    path: &str,
    options: &LiaPluginRunOptions,
) -> Result<PathBuf, String> {
    let mut zip = open_validated(path)?;
    let manifest = read_manifest(&mut zip)?;
    prepare_archive(app, &mut zip, &manifest, options)
}

fn prepare_archive(
    app: &AppHandle,
    zip: &mut BundleArchive,
    manifest: &Value,
    options: &LiaPluginRunOptions,
) -> Result<PathBuf, String> {
    if runtime(manifest)? != "r" {
        return Err("This Plugin does not use R".into());
    }
    let lock = r_lock(zip, manifest)?;
    let (binary, version) = r_interpreter(manifest)?;
    let dir = r_environment(app, manifest, &lock, &binary, &version, options)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mutex = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join(".prepare.lock"))
        .map_err(|e| e.to_string())?;
    mutex.lock_exclusive().map_err(|e| e.to_string())?;
    let library = dir.join("library");
    if r_probe(&binary, &library, &lock)?.is_empty() {
        return Ok(dir);
    }
    let staging = dir.join(format!("prepare-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        extract_payload(zip, &staging, "r/")?;
        fs::write(staging.join("manifest.json"), manifest.to_string())
            .map_err(|e| e.to_string())?;
        // Use the lock's parent as the project so lockfile paths need not be fixed.
        let project = staging.join(
            Path::new(
                manifest["r"]["lockfile"]
                    .as_str()
                    .ok_or("Missing lockfile")?,
            )
            .parent()
            .ok_or("Missing lock directory")?,
        );
        let output = Command::new(&binary)
            .arg("--vanilla")
            .arg(staging.join("r/_prepare.R"))
            .arg(&project)
            .arg(staging.join("manifest.json"))
            .arg(&library)
            .env("R_LIBS_USER", &library)
            .env("RENV_PATHS_CACHE", dir.join("cache"))
            .env("RENV_CONFIG_AUTOLOADER_ENABLED", "FALSE")
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "R dependency preparation failed: {}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let missing = r_probe(&binary, &library, &lock)?;
        if !missing.is_empty() {
            return Err(format!(
                "R dependencies remain unavailable: {}",
                missing.join(", ")
            ));
        }
        Ok(dir.clone())
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

pub(super) fn extract_payload(
    zip: &mut BundleArchive,
    root: &Path,
    prefix: &str,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        if !entry.name().starts_with(prefix) || entry.is_dir() {
            continue;
        }
        let relative = validate_relative_path(entry.name())?;
        let target = root.join(relative);
        fs::create_dir_all(target.parent().ok_or("Invalid payload directory")?)
            .map_err(|e| e.to_string())?;
        let mut file = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) async fn run(
    app: AppHandle,
    mut zip: BundleArchive,
    manifest: Value,
    inputs: Value,
    options: LiaPluginRunOptions,
) -> Result<Value, String> {
    let runtime = runtime(&manifest)?.to_string();
    let hash = bundle_hash(&zip);
    let is_dev = options
        .env
        .as_ref()
        .and_then(|env| env.get("LIATIR_RUN_SCOPE"))
        .map(String::as_str)
        == Some("plugin-dev");
    let mut env = options.env.clone().unwrap_or_default();
    env.insert(
        "LIATIR_IPC_FILE".into(),
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(".ipc")
            .to_string_lossy()
            .to_string(),
    );
    let run_dir = std::env::temp_dir().join(format!("liatir-{runtime}-{}", uuid::Uuid::new_v4()));
    let prepared = if runtime == "r" {
        let app = app.clone();
        let preparation_manifest = manifest.clone();
        let options = options.clone();
        let (archive, preparation) = tauri::async_runtime::spawn_blocking(move || {
            let result = prepare_archive(&app, &mut zip, &preparation_manifest, &options);
            (zip, result)
        })
        .await
        .map_err(|e| e.to_string())?;
        zip = archive;
        Some(preparation?)
    } else {
        if !is_dev && !native_trust_path(&app, &hash)?.is_file() {
            return Err("Allow this Native Plugin's executable access in Plugins before running it. Only allow code from an author you trust.".into());
        }
        None
    };
    if is_dev {
        let session = options
            .env
            .as_ref()
            .and_then(|env| env.get("LIATIR_DEV_SESSION_ID"))
            .ok_or("Missing dev session")?;
        if !super::super::plugin_dev::session_is_active(&app, session) {
            if let Some(dir) = &prepared {
                let _ = fs::remove_dir_all(dir);
            }
            return Err("Plugin dev session ended during preparation".into());
        }
    }
    // Each run gets a private payload directory; concurrent runs cannot overwrite
    // executable/source files. Jobs removes it on success, failure or cancellation.
    let mut runtime_version = None;
    let setup = (|| {
        fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
        extract_payload(&mut zip, &run_dir, &format!("{runtime}/"))?;
        let input_file = run_dir.join("input.json");
        fs::write(
            &input_file,
            serde_json::to_vec(&inputs).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        env.insert(
            "LIATIR_INPUT_FILE".into(),
            input_file.to_string_lossy().to_string(),
        );
        if runtime == "r" {
            let (binary, version) = r_interpreter(&manifest)?;
            runtime_version = Some(version);
            let entry = manifest["r"]["entry"].as_str().ok_or("Missing R entry")?;
            validate_relative_path(entry)?;
            let library = prepared
                .as_ref()
                .ok_or("Missing R environment")?
                .join("library");
            env.insert("R_LIBS".into(), library.to_string_lossy().to_string());
            env.insert("R_LIBS_USER".into(), library.to_string_lossy().to_string());
            env.insert("R_LIBS_SITE".into(), library.to_string_lossy().to_string());
            env.insert("RENV_CONFIG_AUTOLOADER_ENABLED".into(), "FALSE".into());
            Ok((
                binary,
                vec![
                    "--vanilla".into(),
                    run_dir.join(entry).to_string_lossy().to_string(),
                ],
                run_dir
                    .join(entry)
                    .parent()
                    .ok_or("Invalid R entry")?
                    .to_path_buf(),
            ))
        } else {
            let target = native_target(std::env::consts::OS, std::env::consts::ARCH)?;
            let executable = run_dir.join(native_entry(&manifest, &target)?);
            if !executable.is_file() {
                return Err("Native executable is missing from bundle".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            Ok((
                executable.to_string_lossy().to_string(),
                Vec::new(),
                run_dir.clone(),
            ))
        }
    })();
    let (binary, args, cwd) = match setup {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&run_dir);
            return Err(error);
        }
    };
    let mut metadata = options.metadata.clone().unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({"extra": metadata});
    }
    metadata["runtime"] = json!(runtime);
    metadata["pluginName"] = manifest["name"].clone();
    metadata["pluginVersion"] = manifest["version"].clone();
    metadata["bundleSha256"] = json!(hash);
    if let Some(version) = runtime_version {
        metadata["runtimeVersion"] = json!(version);
    }
    if runtime == "native" {
        metadata["runtimeTarget"] =
            json!(native_target(std::env::consts::OS, std::env::consts::ARCH)?);
    }
    if runtime == "r" {
        metadata["runtimeLock"] = r_lock(&mut zip, &manifest)?;
    }
    let result = super::super::jobs::lia_jobs_spawn_with_cleanup(
        app,
        binary,
        args,
        Some(cwd.to_string_lossy().to_string()),
        options.workspace_id,
        Some(env),
        options.job_label.or_else(|| {
            Some(format!(
                "Liatir {runtime} plugin: {}",
                manifest["name"].as_str().unwrap_or("Plugin")
            ))
        }),
        Some(options.job_kind),
        Some(metadata),
        None,
        Some(run_dir.to_string_lossy().to_string()),
    )
    .await;
    if result.is_err() {
        let _ = fs::remove_dir_all(run_dir);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_runtime_fails_closed_and_legacy_node_survives() {
        assert_eq!(runtime(&json!({})).unwrap(), "node");
        for value in [json!(null), json!("R"), json!("nativ"), json!(123)] {
            assert!(runtime(&json!({"runtime":value})).is_err());
        }
    }
    #[test]
    fn r_libraries_are_plugin_owned_and_reuse_only_identical_dependencies_and_interpreters() {
        let original = json!({"name":"first","version":"1","r":{"entry":"r/main.R"}});
        let lock = json!({"Packages":{"jsonlite":{"Version":"2.0.0"}}});
        let id = r_environment_id(&original, &lock, "Rscript", "4.6.1").unwrap();
        let mut code_edit = original.clone();
        code_edit["r"]["entry"] = json!("r/new.R");
        assert_eq!(
            id,
            r_environment_id(&code_edit, &lock, "Rscript", "4.6.1").unwrap()
        );
        let mut different_plugin = original.clone();
        different_plugin["name"] = json!("second");
        assert_ne!(
            id,
            r_environment_id(&different_plugin, &lock, "Rscript", "4.6.1").unwrap()
        );
        assert_ne!(
            id,
            r_environment_id(&original, &lock, "Rscript", "4.6.2").unwrap()
        );
        assert_ne!(
            id,
            r_environment_id(&original, &json!({}), "Rscript", "4.6.1").unwrap()
        );
    }
    #[test]
    fn targets_are_exact_without_architecture_or_os_fallback() {
        let manifest =
            json!({"native":{"protocol":1,"targets":{"linux-x86_64":"native/linux-x86_64/tool"}}});
        assert_eq!(
            native_entry(&manifest, "linux-x86_64").unwrap(),
            "native/linux-x86_64/tool"
        );
        assert!(native_entry(&manifest, "windows-x86_64")
            .unwrap_err()
            .contains("does not support"));
        for (os, arch) in [
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("linux", "aarch64"),
            ("linux", "x86_64"),
            ("windows", "aarch64"),
            ("windows", "x86_64"),
        ] {
            assert_eq!(native_target(os, arch).unwrap(), format!("{os}-{arch}"));
        }
        assert!(native_target("linux", "riscv64").is_err());
    }
    fn archive(manifest: Value, extra: &[(&str, &[u8])]) -> BundleArchive {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let manifest_bytes = manifest.to_string().into_bytes();
        for (name, bytes) in [
            ("_sig", b"LIATIR/1".as_slice()),
            ("manifest.json", manifest_bytes.as_slice()),
        ]
        .iter()
        .chain(extra.iter())
        {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        zip::ZipArchive::new(std::io::Cursor::new(std::sync::Arc::<[u8]>::from(bytes))).unwrap()
    }
    #[test]
    fn manifest_validation_requires_code_contracts_and_matching_payloads() {
        let manifest = json!({"name":"Fixture","version":"1.0.0","runtime":"native","inputSchema":{},"outputSchema":{},
            "native":{"protocol":1,"targets":{"linux-x86_64":"native/linux-x86_64/tool"}}});
        let mut valid = archive(
            manifest.clone(),
            &[("native/linux-x86_64/tool", b"executable")],
        );
        assert!(read_manifest(&mut valid).is_ok());
        assert!(read_manifest(&mut archive(manifest.clone(), &[])).is_err());
        let mut invalid = manifest;
        invalid["inputSchema"] = json!({"x":{"type":"json"}});
        assert!(
            read_manifest(&mut archive(invalid, &[("native/linux-x86_64/tool", b"x")])).is_err()
        );
        let r = json!({"name":"Fixture","version":"1.0.0","runtime":"r","inputSchema":{},"outputSchema":{},"r":{"entry":"r/main.R","lockfile":"r/renv.lock"}});
        assert!(read_manifest(&mut archive(
            r,
            &[("r/main.R", b"x"), ("r/_prepare.R", b"x")]
        ))
        .is_err());
    }
    #[test]
    fn complete_bundle_hash_changes_even_for_signature_metadata() {
        let a = archive(json!({}), &[("_pubkey", b"one")]);
        let b = archive(json!({}), &[("_pubkey", b"two")]);
        assert_ne!(bundle_hash(&a), bundle_hash(&b));
    }
    #[test]
    fn signature_verification_rejects_modified_executables() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let manifest = json!({});
        let mut unsigned = archive(manifest.clone(), &[("native/tool", b"original")]);
        let digest = bundle_signing_digest(&mut unsigned).unwrap();
        let signature = STANDARD.encode(key.sign(&digest).to_bytes());
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let mut signed = archive(
            manifest.clone(),
            &[
                ("native/tool", b"original"),
                ("_signature", signature.as_bytes()),
                ("_pubkey", public.as_bytes()),
            ],
        );
        assert!(verify_bundle_signature(&mut signed).is_ok());
        let mut changed = archive(
            manifest,
            &[
                ("native/tool", b"modified"),
                ("_signature", signature.as_bytes()),
                ("_pubkey", public.as_bytes()),
            ],
        );
        assert!(verify_bundle_signature(&mut changed).is_err());
    }
    #[test]
    fn unsafe_payloads_never_reach_extraction() {
        for path in [
            "../x",
            "r/../../x",
            "/x",
            "C:/x",
            "native\\x",
            "r/./x",
            "r//x",
        ] {
            assert!(validate_relative_path(path).is_err(), "{path}");
        }
        assert!(validate_relative_path("r/nested/main.R").is_ok());
        for path in ["../tool", "r/tool", "native/windows-x86_64/tool"] {
            let manifest = json!({"native":{"protocol":1,"targets":{"linux-x86_64":path}}});
            assert!(native_entry(&manifest, "linux-x86_64").is_err());
        }
    }
}
