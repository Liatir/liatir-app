//! Injects the JavaScript half of the bridge into every webview.

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::Runtime;

/// Builds the `liatir` Tauri plugin.
///
/// `js_init_script` runs before any page script, which is what makes the `Liatir.*` API exist
/// as a global from the first line of frontend and plugin code — no import, no load order to
/// get wrong.
///
/// The script is `include_str!`'d, so the compiled bridge is embedded in the binary rather than
/// loaded from disk. Note that `tsc/bridge.js` is a *build artefact*: it is generated from the
/// TypeScript sources in `src-ts/` and must be compiled before the Rust build, or this file will
/// not compile.
pub fn bridge<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("liatir")
    .js_init_script(include_str!("../tsc/bridge.js"))
    .build()
}
