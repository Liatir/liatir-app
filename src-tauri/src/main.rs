#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod bridge;
mod desktopr;
mod helpers;

use bridge::*;
use desktopr::bridge;
use tauri::{WindowEvent, Emitter, DragDropEvent, Manager, WebviewWindowBuilder, WebviewUrl};
use crate::bridge::dragdrop;

// Global Shortcut plugin
use tauri_plugin_global_shortcut as gsc;
use crate::gsc::Builder;
use crate::gsc::ShortcutState;
use helpers::states::*;

// Deep-link + single-instance
use tauri_plugin_deep_link::DeepLinkExt;

use tauri_plugin_shell;

use tauri_plugin_prevent_default::{
  Builder as PD, Flags, KeyboardShortcut,
  ModifierKey::{CtrlKey, ShiftKey, AltKey, MetaKey}
};

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

const OPEN_EXTERNAL_SCRIPT: &str = r#"(function() {
    var _nativeOpen = window.open.bind(window);
    window.open = function(url, target, features) {
        if (url) {
            try { window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: String(url) }); } catch(e) {}
            return null;
        }
        return _nativeOpen(url, target, features);
    };
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
        if (a && a.href && (a.href.startsWith('http://') || a.href.startsWith('https://'))) {
            e.preventDefault();
            e.stopPropagation();
            try { window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: a.href }); } catch(e) {}
        }
    }, true);
})();"#;

fn main() {
  // let prevent = PD::new()
  //   .with_flags(Flags::CONTEXT_MENU | Flags::DEV_TOOLS)
  //   .shortcut(KeyboardShortcut::new("F12"))
  //   .shortcut(KeyboardShortcut::with_modifiers("I", &[CtrlKey, ShiftKey]))
  //   .shortcut(KeyboardShortcut::with_modifiers("I", &[MetaKey, AltKey]))
  //   .build();

  let mut builder = tauri::Builder::default();

  builder = builder.manage(CloseGuard {
    closing: AtomicBool::new(false),
  });

  builder = builder.manage(LatestWindowLabel {
    label: Mutex::new("main".to_string()),
  });

  builder = builder.manage(CompanionSandboxRegistry::new());

  // --- 0) Single-instance first, important for deep links ---
  builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
    println!("single-instance argv: {argv:?}");
  }));

  // --- 1) Desktopr bridge plugin and native plugins ---
  builder = builder
    .plugin(bridge())
    // .plugin(prevent)
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(bridge::autostart::init_plugin());

  // --- 2) Deep Link plugin ---
  builder = builder.plugin(tauri_plugin_deep_link::init());

  // --- 3) Setup: autostart, env state, logs, shortcuts and deeplinks ---
  builder = builder.setup(|app| {
    // Create main window programmatically to support initialization_script.
    {
      let url = if env!("MAIN_WINDOW_URL").is_empty() {
        WebviewUrl::App("/".into())
      } else {
        WebviewUrl::External(env!("MAIN_WINDOW_URL").parse().expect("invalid MAIN_WINDOW_URL"))
      };
      WebviewWindowBuilder::new(app, "main", url)
        .title(env!("MAIN_WINDOW_TITLE"))
        .visible(env!("MAIN_WINDOW_VISIBLE").parse::<bool>().unwrap_or(false))
        .inner_size(
          env!("MAIN_WINDOW_WIDTH").parse::<f64>().unwrap_or(1200.0),
          env!("MAIN_WINDOW_HEIGHT").parse::<f64>().unwrap_or(800.0),
        )
        .resizable(env!("MAIN_WINDOW_RESIZABLE").parse::<bool>().unwrap_or(true))
        .initialization_script(OPEN_EXTERNAL_SCRIPT)
        .build()?;
    }

    // Run autostart bootstrap first so this setup owns the timing.
    bridge::autostart::run_from_setup(app)?;

    // Native menu
    // crate::bridge::menu::init_menu(app)?;

    // Initialize persistent env store.
    let env_state = crate::bridge::global_vars::EnvState::init(&app.handle())
      .expect("Failed to init EnvState for global_vars module");
    app.manage(env_state);

    let version = app.package_info().version.to_string();

    start_heartbeat(app.handle().clone());

    // Panic hook.
    install_panic_hook(app.handle().clone(), version);

    // Run logs retention on boot.
    let _ = dtr_logs_run_retention(app.handle().clone());

    // Global Shortcut.
    app.handle().plugin(
      gsc::Builder::new().build(),
    )?;

    // Runtime registration only in dev on Win/Linux.
    #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
    {
      app.deep_link().register_all()?;
    }

    // Startup deep link URLs.
    let start_urls = app.deep_link().get_current()?;
    if let Some(urls) = start_urls {
      if let Some(u) = urls.first() {
        crate::bridge::deeplink::emit_parsed_deeplink(&app.handle(), u.as_str());
      }
    }

    // Runtime deep link URLs when the app is already open.
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |e| {
      if let Some(u) = e.urls().first() {
        crate::bridge::deeplink::emit_parsed_deeplink(&handle, u.as_str());
      }
    });

    Ok(())
  });

  // --- 4) Window events + invoke handler ---
  builder
    .on_window_event(|window, event| {
      match event {
        WindowEvent::Focused(true) => {
          let _ = window.emit("window:focus", ());
          let window_label = window.label().to_string();

          let state = window.app_handle().state::<LatestWindowLabel>();
          state.set(window_label);
        }

        WindowEvent::Focused(false) => {
          let _ = window.emit("window:blur", ());
        }

        WindowEvent::CloseRequested { api, .. } => {
          let app = window.app_handle();
          let guard = app.state::<CloseGuard>();

          // If already closing, ignore duplicated close requests.
          if guard.closing.swap(true, Ordering::SeqCst) {
            return;
          }

          // Prevent immediate close so Desktopr can emit its close event first.
          api.prevent_close();

          let _ = window.emit("window:close-requested", ());

          // Mark clean shutdown centrally.
          mark_clean_shutdown_now(&app);

          // Close for real.
          let window_label = window.label().to_string();
          let _ = dtr_win_close(app.clone(), window_label);
        }

        WindowEvent::Resized(size) => {
          let _ = window.emit("window:resized", Some(serde_json::json!({
            "width": size.width,
            "height": size.height
          })));
        }

        WindowEvent::DragDrop(e) => {
          match e {
            DragDropEvent::Enter { paths, position } => {
              dragdrop::emit_enter(window, &paths, position.x, position.y);
            }

            DragDropEvent::Over { position } => {
              dragdrop::emit_over(window, position.x, position.y);
            }

            DragDropEvent::Drop { paths, position } => {
              dragdrop::emit_drop(window, &paths, position.x, position.y);
            }

            DragDropEvent::Leave => {
              dragdrop::emit_cancel(window);
            }

            _ => {}
          }
        }

        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![
      // notifications
      dtr_notification_state,
      dtr_request_permission,
      dtr_notify,

      // clipboard
      dtr_clipboard_write,
      dtr_clipboard_read,

      // files
      dtr_file_open,
      dtr_file_save,
      dtr_file_open_with_bytes,

      // app
      dtr_app_info,
      dtr_app_exit,

      // global_vars
      dtr_global_vars_get,
      dtr_global_vars_set,
      dtr_global_vars_remove,
      dtr_global_vars_list,

      // window
      dtr_win_minimize,
      dtr_win_maximize,
      dtr_win_fullscreen,
      dtr_win_open,
      dtr_win_close,
      dtr_win_get_info,

      // events
      dtr_event_emit,
      dtr_event_emit_to,
      dtr_event_emit_to_current_window,

      // fs
      dtr_fs_list_dir,
      dtr_fs_mkdir,
      dtr_fs_rm,
      dtr_fs_stat,
      dtr_fs_write_text,
      dtr_fs_read_text,
      dtr_fs_write_bytes,
      dtr_fs_read_bytes,
      dtr_fs_exists,
      dtr_fs_move,
      dtr_fs_copy,
      dtr_fs_clear_cache,
      dtr_fs_clear_data,
      dtr_fs_paths,

      // fs trash
      dtr_fs_trash_list_dir,
      dtr_fs_trash_stat,
      dtr_fs_trash_exists,
      dtr_fs_trash_read_text,
      dtr_fs_trash_read_bytes,
      dtr_fs_data_recover_trash,
      dtr_fs_data_clear_trash,

      // fs diagnostics
      dtr_fs_diagnostics_list_dir,
      dtr_fs_diagnostics_read_bytes,
      dtr_fs_diagnostics_stat,
      dtr_fs_diagnostics_read_text,
      dtr_fs_diagnostics_rm,
      dtr_fs_diagnostics_clear,
      dtr_fs_diagnostics_exists,

      // menu
      dtr_menu_set_enabled,
      dtr_menu_set_checked,
      dtr_init_menu_from_json,
      dtr_init_menu_from_file,
      dtr_init_menu_for_window_from_json,

      // diagnostics
      dtr_logs_get_privacy,
      dtr_logs_set_privacy,
      dtr_logs_run_retention,
      dtr_logs_list_files,
      dtr_logs_read_file,
      dtr_logs_record_js_error,
      dtr_logs_record_native_error,
      dtr_logs_record_error,
      dtr_logs_new_record,
      dtr_logs_export_zip,

      // network
      dtr_network_get_status,
      dtr_network_ping,
      dtr_network_resolve,
      dtr_network_bandwidth_estimate,
      dtr_network_set_monitor,
      dtr_network_stop_monitor,

      // autostart
      dtr_get_autostart_mode,
      dtr_set_autostart_mode,
      dtr_autostart_enable,
      dtr_autostart_disable,
      dtr_autostart_status,

      // badge
      dtr_badge_set,
      dtr_badge_clear,

      // context_menu
      dtr_context_menu_popup,

      // companion
      dtr_launch_companion,

      // plugins
      dtr_plugin_status,
      dtr_plugin_paths,
      dtr_plugin_storage_clear,
      dtr_plugin_call,
      dtr_plugin_clear_all_jobs,
      dtr_plugin_add_module,
      dtr_plugin_pick_and_add_module,
      dtr_plugin_remove_module,
      dtr_plugin_list_modules,

      // test commands only in dev
      #[cfg(debug_assertions)]
      dtr_logs_test_record_n,
      #[cfg(debug_assertions)]
      dtr_logs_test_panic,
      #[cfg(debug_assertions)]
      dtr_logs_test_force_retention,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}