fn main() {
    let defaults = [
        ("MAIN_WINDOW_URL",             "https://companion.desktopr.app"),
        ("MAIN_WINDOW_TITLE",           "Desktopr"),
        ("MAIN_WINDOW_WIDTH",           "1200"),
        ("MAIN_WINDOW_HEIGHT",          "800"),
        ("MAIN_WINDOW_BG_COLOR",        "#171717"),
        ("MAIN_WINDOW_RESIZABLE",       "true"),
        ("MAIN_WINDOW_VISIBLE",         "false"),
        ("MAIN_WINDOW_OPEN_FULLSCREEN", "false"),
    ];

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

    for (k, default) in &defaults {
        let v = file_vars.get(*k).map(String::as_str).unwrap_or(default);
        println!("cargo:rustc-env={k}={v}");
    }

    println!("cargo:rerun-if-changed=window.env");
    tauri_build::build();
}
