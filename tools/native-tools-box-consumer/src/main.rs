//! Static Scrollcase consumer used by the Windows app inside WSL2.

use scrollcase_consumer::{
    prepare::{
        attach_extracted_box, verify_and_extract_box, verify_extracted_payload, AttachOptions,
        EnvironmentReportOptions, PrepareOptions,
    },
    trust::TrustAnchors,
};
use std::path::{Path, PathBuf};

fn digest(value: &str) -> Result<&str, String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(value)
    } else {
        Err("The Native Tools archive digest is invalid.".into())
    }
}

fn install_root(archive_digest: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("WSL2 did not provide a home directory.")?;
    Ok(PathBuf::from(home)
        .join(".local/share/liatir/native-tools")
        .join(digest(archive_digest)?))
}

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
        if path != current && digest(&name).is_ok() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn run() -> Result<PathBuf, String> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [release, trusted_key, archive, archive_digest] = arguments.as_slice() else {
        return Err(
            "Usage: native-tools-box-consumer <release> <trusted-key> <archive> <archive-sha256>"
                .into(),
        );
    };
    let release = Path::new(release);
    let trusted_key = Path::new(trusted_key);
    let archive = Path::new(archive);
    let root = install_root(archive_digest)?;
    let environment = EnvironmentReportOptions::default();

    let prepared = if root.is_dir() {
        let options = AttachOptions {
            trust: TrustAnchors::KeyFile(trusted_key),
            root: &root,
            environment,
        };
        verify_extracted_payload(release, &options).map_err(|error| error.to_string())?;
        attach_extracted_box(release, &options)
    } else {
        verify_and_extract_box(
            release,
            &PrepareOptions {
                trust: TrustAnchors::KeyFile(trusted_key),
                archive: Some(archive),
                destination: &root,
                environment,
            },
        )
    }
    .map_err(|error| error.to_string())?;

    if prepared.box_id() != "native-tools"
        || prepared.runtime_id() != "native-tools"
        || prepared.target_id() != "linux-x86_64-cpu"
    {
        return Err("The signed box is not the Linux Native Tools box.".into());
    }
    prune_previous_boxes(prepared.root());
    Ok(prepared.root().to_path_buf())
}

fn main() {
    match run() {
        Ok(root) => println!("{}", root.display()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
