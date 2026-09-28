use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Lists every bundled demo file with its hash; written by `scripts/demo-files-manifest.mjs`.
const MANIFEST: &str = "manifest.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoFileEntry {
    pub path: String,
    pub folder: String,
}

#[derive(Deserialize)]
struct DemoManifest {
    files: Vec<DemoManifestFile>,
}

#[derive(Deserialize)]
struct DemoManifestFile {
    path: String,
}

fn find_demo_resource_dir(app: &AppHandle) -> Option<PathBuf> {
    // Production: resources are bundled adjacent to the binary
    if let Ok(d) = app.path().resource_dir() {
        let p = d.join("demo-files");
        if p.exists() { return Some(p); }
    }
    // Development fallback: files live in src-tauri/resources/demo-files/
    #[cfg(debug_assertions)]
    {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("demo-files");
        if p.exists() { return Some(p); }
    }
    None
}

/// Copy bundled demo files from the resource directory to app_data/demo-files/.
/// Returns the list of all demo file paths.
#[tauri::command]
pub fn lia_init_demo_files(app: AppHandle) -> Result<Vec<DemoFileEntry>, String> {
    let Some(bundle) = find_demo_resource_dir(&app) else { return Ok(vec![]) };
    let copy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("demo-files");
    sync_demo_files(&bundle, &copy)
}

/// Bring the copy in line with the bundled demo set.
///
/// A copy whose manifest differs from the bundle's comes from another release and is replaced
/// whole, so files a release renamed or removed do not linger next to their successors. Within a
/// current copy only missing files are restored, which is what "Re-seed demo files" promises. The
/// manifest is written last: a copy interrupted halfway is still stale and is redone next time.
fn sync_demo_files(bundle: &Path, copy: &Path) -> Result<Vec<DemoFileEntry>, String> {
    let manifest_bytes = std::fs::read(bundle.join(MANIFEST))
        .map_err(|e| format!("Cannot read the demo files manifest: {e}"))?;
    let manifest: DemoManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("Invalid demo files manifest: {e}"))?;
    let current = std::fs::read(copy.join(MANIFEST)).ok().as_deref() == Some(manifest_bytes.as_slice());
    if !current && copy.exists() {
        std::fs::remove_dir_all(copy).map_err(|e| e.to_string())?;
    }

    let mut entries = Vec::with_capacity(manifest.files.len());
    for file in &manifest.files {
        let (folder, relative) = demo_relative_path(&file.path)?;
        let dest = copy.join(&relative);
        if !dest.exists() {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(bundle.join(&relative), &dest).map_err(|e| e.to_string())?;
        }
        entries.push(DemoFileEntry {
            path: dest.to_string_lossy().to_string(),
            folder: format!("Demo Files/{folder}"),
        });
    }

    if !current {
        std::fs::create_dir_all(copy).map_err(|e| e.to_string())?;
        std::fs::write(copy.join(MANIFEST), &manifest_bytes).map_err(|e| e.to_string())?;
    }
    Ok(entries)
}

/// A manifest path is `<task folder>/<file>`; the folder becomes the Data folder the file shows in.
fn demo_relative_path(path: &str) -> Result<(String, PathBuf), String> {
    let parts: Vec<&str> = path.split('/').collect();
    let plain_name = |part: &&str| {
        let mut components = Path::new(part).components();
        matches!((components.next(), components.next()), (Some(Component::Normal(_)), None))
    };
    if parts.len() != 2 || !parts.iter().all(plain_name) {
        return Err(format!("Demo file path must be <folder>/<file>: {path}"));
    }
    Ok((parts[0].to_string(), parts.iter().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("liatir-demo-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn write_bundle(bundle: &Path, files: &[(&str, &str)]) {
        let _ = std::fs::remove_dir_all(bundle);
        let listed: Vec<String> = files.iter().map(|(path, _)| format!("{{\"path\":\"{path}\"}}")).collect();
        for (path, content) in files {
            let target = bundle.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, content).unwrap();
        }
        std::fs::write(bundle.join(MANIFEST), format!("{{\"files\":[{}]}}", listed.join(","))).unwrap();
    }

    #[test]
    fn copies_the_bundle_and_files_each_entry_under_its_task_folder() {
        let root = scratch("copy");
        write_bundle(&root.join("bundle"), &[("Task A/reads.fastq", "@r1")]);

        let entries = sync_demo_files(&root.join("bundle"), &root.join("copy")).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].folder, "Demo Files/Task A");
        assert_eq!(std::fs::read_to_string(&entries[0].path).unwrap(), "@r1");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_new_release_replaces_the_whole_copy() {
        let root = scratch("replace");
        let (bundle, copy) = (root.join("bundle"), root.join("copy"));
        write_bundle(&bundle, &[("Old task/old.vcf", "old")]);
        sync_demo_files(&bundle, &copy).unwrap();
        std::fs::write(copy.join("Old task/old.vcf.fai"), "written by a tool").unwrap();

        write_bundle(&bundle, &[("New task/new.vcf", "new")]);
        let entries = sync_demo_files(&bundle, &copy).unwrap();

        assert!(!copy.join("Old task").exists());
        assert_eq!(entries.len(), 1);
        assert_eq!(std::fs::read_to_string(copy.join("New task/new.vcf")).unwrap(), "new");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_current_copy_only_gets_its_missing_files_back() {
        let root = scratch("reseed");
        let (bundle, copy) = (root.join("bundle"), root.join("copy"));
        write_bundle(&bundle, &[("Task/a.fasta", ">a"), ("Task/b.fasta", ">b")]);
        sync_demo_files(&bundle, &copy).unwrap();
        std::fs::remove_file(copy.join("Task/a.fasta")).unwrap();
        std::fs::write(copy.join("Task/a.fasta.fai"), "index").unwrap();

        sync_demo_files(&bundle, &copy).unwrap();

        assert_eq!(std::fs::read_to_string(copy.join("Task/a.fasta")).unwrap(), ">a");
        assert!(copy.join("Task/a.fasta.fai").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_manifest_paths_outside_one_task_folder() {
        for path in ["file.txt", "a/b/c.txt", "../escape/x.txt", "a//b.txt", "/abs/x.txt"] {
            assert!(demo_relative_path(path).is_err(), "{path} was accepted");
        }
        assert!(demo_relative_path("Find cancer neoantigens/peptides.csv").is_ok());
    }
}
