use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};

use crate::bridge::managed_bins::{DownloadProgress, DownloadRegistry, stream_download};

const SNPEFF_S3_BASE: &str = "https://snpeff-public.s3.amazonaws.com/databases";
const SNPEFF_VERSIONS: &[&str] = &["v5_4", "v5_3", "v5_2", "v5_1", "v5_0"];

/// Read `database.repository` from snpEff.config in the same dir as the JAR.
/// The config uses a dot key: `database.repository = https://...`
fn read_db_repository(jar_path: &str) -> Option<String> {
    let config = Path::new(jar_path).parent()?.join("snpEff.config");
    let content = std::fs::read_to_string(config).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Matches "database.repository = URL" or "database.repository : URL"
        if let Some(rest) = trimmed.strip_prefix("database.repository") {
            let url = rest.trim_start_matches([' ', '\t', '=', ':']).trim_end().trim_end_matches('/');
            if !url.is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

fn db_urls(genome: &str, version_hint: Option<&str>, repo_base: &str) -> Vec<String> {
    let mut versions: Vec<String> = Vec::new();
    if let Some(v) = version_hint {
        versions.push(v.to_string());
    }
    for &v in SNPEFF_VERSIONS {
        if Some(v) != version_hint {
            versions.push(v.to_string());
        }
    }
    versions
        .into_iter()
        .map(|v| format!("{repo_base}/{v}/snpEff_{v}_{genome}.zip"))
        .collect()
}

/// Extract a SnpEff database zip to data_dir, stripping the leading "data/" prefix.
/// The zip contains "data/{genome}/..." → extracted to "{data_dir}/{genome}/...".
fn extract_snpeff_db(zip_path: &str, data_dir: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let raw = entry.name().to_string();

        // Strip leading "data/" if present
        let rel = raw.strip_prefix("data/").unwrap_or(&raw);
        if rel.is_empty() {
            continue;
        }

        let out_path = Path::new(data_dir).join(rel);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file =
                std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, id: &str, downloaded: u64, total: Option<u64>, speed: f64) {
    let _ = app.emit(
        &format!("managed:progress:{id}"),
        DownloadProgress {
            id: id.to_string(),
            bytes_downloaded: downloaded,
            bytes_total: total,
            bytes_per_sec: speed,
            done: false,
            error: None,
        },
    );
}

fn emit_done(app: &AppHandle, id: &str, error: Option<String>) {
    let _ = app.emit(
        &format!("managed:progress:{id}"),
        DownloadProgress {
            id: id.to_string(),
            bytes_downloaded: 0,
            bytes_total: None,
            bytes_per_sec: 0.0,
            done: true,
            error,
        },
    );
}

/// Run SnpEff annotation with zero stdout memory overhead.
///
/// Uses std::process::Command with stdout redirected to the output file at the OS
/// level — Java writes the annotated VCF straight to disk, no bytes ever pass
/// through Rust memory or any channel buffer.
///
/// Previous approach (tauri_plugin_shell) crashed because its internal channel is
/// unbounded: millions of VCF stdout lines accumulate in the channel buffer even
/// when writing to disk one-by-one → OOM. This approach has truly O(1) memory.
#[tauri::command]
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
    if let Some(parent) = std::path::Path::new(&output_vcf).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create output dir: {e}"))?;
    }

    // Derive stats paths alongside the VCF — keeps files out of src-tauri/ (tauri dev watches it)
    // SnpEff writes the genes TSV as {stats_base}.genes.txt automatically.
    let stats_base = output_vcf.strip_suffix(".vcf").unwrap_or(&output_vcf).to_string();
    let stats_html  = format!("{stats_base}-summary.html");
    let stats_genes = format!("{stats_base}-summary.genes.txt");

    tauri::async_runtime::spawn_blocking(move || {
        use std::fs::File;
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let out_file = File::create(&output_vcf)
            .map_err(|e| format!("cannot create output file: {e}"))?;

        let java_bin = java_path.as_deref().filter(|s| !s.is_empty()).unwrap_or("java");
        let mut child = Command::new(java_bin)
            .args([
                &format!("-Xmx{heap}"),
                "-jar", &jar_path,
                "ann",
                "-dataDir", &data_dir,
                "-noLog",
                "-stats", &stats_html,
                &genome,
                &input_vcf,
            ])
            // OS-level redirect: Java's stdout fd → file, zero bytes through Rust
            .stdout(out_file)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn java: {e}"))?;

        let stderr = child.stderr.take()
            .ok_or_else(|| "failed to capture stderr".to_string())?;

        let mut stderr_lines: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(l) => {
                    if stderr_lines.len() < 2000 {
                        stderr_lines.push(l.clone());
                    }
                    let _ = app.emit(&format!("jobs:stderr:{job_id}"), l);
                }
                Err(_) => break,
            }
        }

        let status = child.wait().map_err(|e| format!("wait error: {e}"))?;
        let exit_code = status.code();
        let ok = exit_code.map(|c| c == 0).unwrap_or(false);

        Ok::<serde_json::Value, String>(serde_json::json!({
            "ok": ok,
            "exitCode": exit_code,
            "stderr": stderr_lines,
            "statsHtml":  stats_html,
            "statsGenes": stats_genes,
        }))
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Download and install a SnpEff genome database using Liatir's HTTP client
/// (rustls-based, avoids Java SSL issues). Emits `managed:progress:{id}` events.
/// Tries multiple S3 version URLs in order, starting from the detected JAR version.
#[tauri::command]
pub async fn lia_snpeff_download_db(
    app: AppHandle,
    state: tauri::State<'_, DownloadRegistry>,
    id: String,
    jar_path: String,
    data_dir: String,
    genome: String,
) -> Result<(), String> {
    if state.is_active(&id) {
        return Err(format!("Download already in progress for {genome}"));
    }

    let repo_base = read_db_repository(&jar_path)
        .unwrap_or_else(|| SNPEFF_S3_BASE.to_string());
    let urls = db_urls(&genome, None, &repo_base);

    let zip_path = format!("{data_dir}/{genome}-db.zip");
    let part_path = format!("{zip_path}.part");

    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let mut last_err = String::from("No download URLs available");

    for url in &urls {
        // Clean up any leftover part file before trying each URL
        // (different URLs = different content, can't resume across them)
        let _ = std::fs::remove_file(&part_path);

        let cancelled = state.register(&id);
        let result = stream_download(&app, &id, url, &zip_path, None, &cancelled).await;
        state.unregister(&id);

        match result {
            Ok(_) => {
                // Signal "extracting" — keep bytes_total so the bar stays full
                let _ = app.emit(
                    &format!("managed:progress:{id}"),
                    serde_json::json!({ "id": id, "extracting": true, "done": false }),
                );

                let extract_result = extract_snpeff_db(&zip_path, &data_dir);
                let _ = std::fs::remove_file(&zip_path);

                return match extract_result {
                    Ok(()) => {
                        emit_done(&app, &id, None);
                        Ok(())
                    }
                    Err(e) => {
                        emit_done(&app, &id, Some(e.clone()));
                        Err(e)
                    }
                };
            }
            Err(e) if e.contains("cancelled") => {
                emit_done(&app, &id, Some("Download cancelled".to_string()));
                return Err("Download cancelled".to_string());
            }
            Err(e) => {
                last_err = e;
                // try next URL
            }
        }
    }

    let msg = format!("Failed to download {genome} database from all sources: {last_err}");
    emit_done(&app, &id, Some(msg.clone()));
    Err(msg)
}
