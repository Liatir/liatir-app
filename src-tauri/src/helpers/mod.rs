//! Internal helpers shared across the backend, as opposed to `bridge`, which holds the
//! capabilities exposed to the frontend.

// Currently empty: declared as the home for shared constants, but nothing lives here yet.
pub mod constants;
// Turns the declarative menu/tray configuration into Tauri menu objects.
pub mod menu_builder;
// Process-wide state registered with Tauri and reachable from commands via `app.state()`.
pub mod states;

