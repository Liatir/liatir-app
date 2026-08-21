//! Internal helpers shared across the backend, as opposed to `bridge`, which holds the
//! capabilities exposed to the frontend.

// Currently empty: declared as the home for shared constants, but nothing lives here yet.
pub mod constants;
// Turns the declarative menu/tray configuration into Tauri menu objects.
pub mod menu_builder;
// Process-wide state registered with Tauri and reachable from commands via `app.state()`.
pub mod states;
// The single WSL2 crossing: distribution validation, command shape, path mapping.
// Compiled on every platform so its tests run on every platform, which is the
// only way the Windows command construction is checked on a macOS or Linux
// machine; off Windows nothing outside those tests calls into it.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub mod wsl;

