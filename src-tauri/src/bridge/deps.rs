// ---------------------------------
// Helpers (sync, used in spawn_blocking)
// ---------------------------------

fn find_in_path(name: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;

    #[cfg(target_os = "windows")]
    let extensions = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(target_os = "windows"))]
    let extensions = [""];

    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    None
}

fn first_available(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| find_in_path(name))
}

fn preferred_python() -> Option<String> {
    first_available(&[
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ])
}

fn resolve_dependency_command(binary: &str) -> Option<String> {
    if binary == "python" {
        return preferred_python();
    }
    find_in_path(binary)
}

fn try_get_version(command: &str) -> Option<String> {
    for flag in &["--version", "-version", "version", "-v"] {
        let Ok(output) = std::process::Command::new(command).arg(flag).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let text = if !stdout.is_empty() { stdout } else { stderr };
        if !text.is_empty() {
            return Some(text.lines().next().unwrap_or(&text).trim().to_string());
        }
    }

    // Fallback: some tools (e.g. bwa) print "Version: X.Y.Z" in their usage/no-args output
    if let Ok(output) = std::process::Command::new(command).output() {
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        for line in combined.lines() {
            let trimmed = line.trim();
            // Match "Version: 0.7.18" or "version 0.7.18" style lines
            let lower = trimmed.to_lowercase();
            if lower.starts_with("version") {
                let ver = trimmed
                    .splitn(2, |c: char| c == ':' || c == ' ')
                    .nth(1)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                if let Some(v) = ver {
                    return Some(v);
                }
            }
        }
    }

    None
}

// ---------------------------------
// Public Tauri commands
// ---------------------------------

/// Check whether a binary is available in PATH and retrieve its version.
///
/// Returns:
///   { available: bool, binary: string, path: string|null, version: string|null }
///
/// The `binary` name must be a simple identifier (no slashes, no path traversal).
#[tauri::command]
pub async fn lia_deps_check(binary: String) -> Result<serde_json::Value, String> {
    if binary.is_empty() || binary.contains('/') || binary.contains('\\') || binary.contains("..") {
        return Err(format!("invalid binary name: {binary:?}"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_dependency_command(&binary);
        let available = path.is_some();

        let version = if available {
            path.as_deref().and_then(try_get_version)
        } else {
            None
        };

        Ok(serde_json::json!({
            "available": available,
            "binary":    binary,
            "path":      path,
            "version":   version,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Check multiple binaries at once.
#[tauri::command]
pub async fn lia_deps_check_many(binaries: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    let mut results = Vec::with_capacity(binaries.len());

    for binary in binaries {
        let result = lia_deps_check(binary).await?;
        results.push(result);
    }

    Ok(results)
}
