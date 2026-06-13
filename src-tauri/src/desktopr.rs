use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::Runtime;

pub fn bridge<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("desktopr")
    .js_init_script(include_str!("../tsc/bridge.js"))
    .build()
}
