//! Build script: bakes the main window's configuration into the binary.
//!
//! Values are read from an optional `window.env` file and re-emitted as `cargo:rustc-env`, which
//! makes them readable from the app with `env!(...)` at compile time. Doing it here rather than
//! reading the file at runtime means the shipped binary carries its window settings and cannot
//! be reconfigured by dropping a file next to it.

fn main() {
    // Used for any key `window.env` does not override, so the file is entirely optional.
    let defaults = [
        ("MAIN_WINDOW_URL",             ""),
        ("MAIN_WINDOW_TITLE",           "Liatir"),
        ("MAIN_WINDOW_WIDTH",           "1200"),
        ("MAIN_WINDOW_HEIGHT",          "800"),
        ("MAIN_WINDOW_BG_COLOR",        "#171717"),
        ("MAIN_WINDOW_RESIZABLE",       "true"),
        // The window starts hidden and is shown once the app is ready, so the user never sees
        // an empty frame while the webview boots.
        ("MAIN_WINDOW_VISIBLE",         "false"),
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
                if l.is_empty() || l.starts_with('#') { return None; }
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
    tauri_build::build();
}
