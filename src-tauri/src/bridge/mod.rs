//! The bridge: every capability the Rust backend exposes to the frontend and to plugins.
//!
//! One module per domain (filesystem, jobs, plugins, AI runtimes, native tools, …). Each owns
//! its `#[tauri::command]` functions — the `lia_*` entry points the TypeScript side invokes —
//! and the glob re-exports below flatten them into `bridge::*` so `lib.rs` can list them in the
//! Tauri handler without spelling out a module path for each.
//!
//! Note that a new command is not reachable from the frontend just by being declared here:
//! it also has to be granted in `permissions/liatir-bridge.toml`.

pub mod notifications;
pub mod clipboard;
pub mod files;
pub mod app;
pub mod app_updates;
pub mod window;
pub mod events;
pub mod dragdrop;
pub mod fs;
pub mod deeplink;
pub mod menu;
pub mod tray;
pub mod diagnostics;
pub mod network;
pub mod autostart;
pub mod badge;
pub mod context_menu;
pub mod global_vars;
pub mod plugins;
pub mod jobs;
pub mod deps;
pub mod managed_bins;
pub mod ipc_server;
pub mod lia_plugins;
pub mod plugin_dev;
pub mod startup_cleanup;
pub mod demo_files;
pub mod plugin_files;
pub mod app_storage;
pub mod snpeff;
pub mod bwa;
pub mod minimap2;
pub mod execution_resources;
pub mod ai_hardware;
pub mod ai_runtime;
pub mod runtime_boxes;
pub mod python_env;
pub mod visual_capture;
pub mod plugin_log;
pub mod plugin_progress;
pub mod quenta;
pub mod external_workflows;

// Flattened re-exports. Four modules declared above are deliberately missing from this list,
// because nothing needs to reach them through `bridge::*` — each is referenced by its full path
// from the one place that uses it:
//   - `ipc_server`          started by main.rs
//   - `tray`                used by menu.rs
//   - `execution_resources` a plain helper (thread-count resolution) used by bwa.rs / minimap2.rs
//   - `ai_hardware`         shared native probes used by AI runtimes and Runtime Box selection
//   - `python_env`          wrapped by ai_runtime, runtime_boxes, lia_plugins and plugin_dev

pub use notifications::*;
pub use clipboard::*;
pub use files::*;
pub use app::*;
pub use app_updates::*;
pub use window::*;
pub use events::*;
pub use dragdrop::*;
pub use fs::*;
pub use deeplink::*;
pub use menu::*;
pub use diagnostics::*;
pub use network::*;
pub use autostart::*;
pub use badge::*;
pub use context_menu::*;
pub use global_vars::*;
pub use plugins::*;
pub use jobs::*;
pub use deps::*;
pub use managed_bins::*;
pub use lia_plugins::*;
pub use plugin_dev::*;
pub use startup_cleanup::*;
pub use demo_files::*;
pub use plugin_files::*;
pub use app_storage::*;
pub use snpeff::*;
pub use bwa::*;
pub use minimap2::*;
pub use ai_runtime::*;
pub use runtime_boxes::*;
pub use visual_capture::*;
pub use plugin_log::*;
pub use plugin_progress::*;
pub use quenta::*;
pub use external_workflows::*;
