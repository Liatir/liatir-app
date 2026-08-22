//! Build script: bakes the main window's configuration into the binary.
//!
//! Values are read from an optional `window.env` file and re-emitted as `cargo:rustc-env`, which
//! makes them readable from the app with `env!(...)` at compile time. Doing it here rather than
//! reading the file at runtime means the shipped binary carries its window settings and cannot
//! be reconfigured by dropping a file next to it.

use sha2::{Digest, Sha256};

fn main() {
    // Used for any key `window.env` does not override, so the file is entirely optional.
    let defaults = [
        ("MAIN_WINDOW_URL", ""),
        ("MAIN_WINDOW_TITLE", "Liatir"),
        ("MAIN_WINDOW_WIDTH", "1200"),
        ("MAIN_WINDOW_HEIGHT", "800"),
        ("MAIN_WINDOW_BG_COLOR", "#171717"),
        ("MAIN_WINDOW_RESIZABLE", "true"),
        // The window starts hidden and is shown once the app is ready, so the user never sees
        // an empty frame while the webview boots.
        ("MAIN_WINDOW_VISIBLE", "false"),
        ("MAIN_WINDOW_OPEN_FULLSCREEN", "false"),
    ];

    // Minimal `KEY=value` parser: blank lines and `#` comments are skipped, and a line without
    // `=` is ignored rather than failing the build.
    let file_vars: std::collections::HashMap<String, String> =
        std::fs::read_to_string("window.env")
            .unwrap_or_default()
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                if l.is_empty() || l.starts_with('#') {
                    return None;
                }
                let (k, v) = l.split_once('=')?;
                Some((k.trim().to_string(), v.trim().to_string()))
            })
            .collect();

    // Only the known keys are emitted, so an unrecognised entry in the file cannot inject an
    // arbitrary compile-time variable.
    for (k, default) in &defaults {
        let v = file_vars.get(*k).map(String::as_str).unwrap_or(default);
        println!("cargo:rustc-env={k}={v}");
    }

    // Without this, editing window.env would not trigger a rebuild and the change would appear
    // to have no effect.
    println!("cargo:rerun-if-changed=window.env");

    // The Native Tools box is embedded in the application, so its generated
    // build key is embedded too. Runtime verification therefore does not trust
    // a replaceable key file sitting beside the archive. Debug builds without a
    // box still compile and retain the documented PATH fallback.
    let target = match (
        std::env::var("CARGO_CFG_TARGET_OS").as_deref(),
        std::env::var("CARGO_CFG_TARGET_ARCH").as_deref(),
    ) {
        (Ok("macos"), Ok("aarch64")) => Some("macos-aarch64-cpu"),
        (Ok("linux"), Ok("x86_64")) => Some("linux-x86_64-cpu"),
        (Ok("windows"), Ok("x86_64")) => Some("linux-x86_64-cpu"),
        _ => None,
    };
    let trust_path = target.map(|target| {
        std::path::PathBuf::from("resources/native-tools")
            .join(format!("native-tools-{target}.trusted-key.json"))
    });
    let trust = trust_path
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_default();
    let metadata_path = std::path::PathBuf::from("../runtime-boxes/native-tools/native-tools.json");
    let metadata =
        std::fs::read_to_string(&metadata_path).expect("read tracked Native Tools box metadata");
    let wsl_consumer_path =
        std::path::PathBuf::from("resources/native-tools/native-tools-box-consumer");
    let wsl_consumer_sha256 = if matches!(target, Some("linux-x86_64-cpu"))
        && matches!(
            std::env::var("CARGO_CFG_TARGET_OS").as_deref(),
            Ok("windows")
        ) {
        let bytes = std::fs::read(&wsl_consumer_path)
            .expect("read the static Native Tools WSL2 Scrollcase consumer");
        format!("{:x}", Sha256::digest(bytes))
    } else {
        String::new()
    };
    let generated = format!(
        "const EMBEDDED_NATIVE_TOOLS_TRUST: &str = {:?};\n\
         const EMBEDDED_NATIVE_TOOLS_METADATA: &str = {:?};\n\
         #[cfg(target_os = \"windows\")]\n\
         const EMBEDDED_WSL_CONSUMER_SHA256: &str = {:?};\n",
        trust, metadata, wsl_consumer_sha256
    );
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"))
        .join("native_tools_trust.rs");
    std::fs::write(output, generated).expect("write Native Tools trust source");
    println!("cargo:rerun-if-changed=resources/native-tools");
    println!("cargo:rerun-if-changed={}", metadata_path.display());
    println!("cargo:rerun-if-changed={}", wsl_consumer_path.display());
    tauri_build::build();
}
