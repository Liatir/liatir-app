#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod bridge;
mod liatir;
mod helpers;

use bridge::*;
use liatir::bridge;
use tauri::{WindowEvent, Emitter, DragDropEvent, Manager, RunEvent, WebviewWindowBuilder, WebviewUrl};
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

  builder = builder.manage(bridge::jobs::JobRegistry::new());
  builder = builder.manage(bridge::managed_bins::DownloadRegistry::new());
  builder = builder.manage(bridge::plugin_dev::PluginDevRegistry::new());

  builder = builder.manage(CloseGuard {
    closing: AtomicBool::new(false),
    pending: AtomicBool::new(false),
  });

  builder = builder.manage(LatestWindowLabel {
    label: Mutex::new("main".to_string()),
  });

  // --- 0) Single-instance first, important for deep links ---
  // Test binaries run with isolated HOME paths but the same bundle identifier.
  // Disabling single-instance in test mode prevents WebDriver runs from closing
  // immediately when a normal Liatir app is already open.
  if std::env::var("LIATIR_TEST_MODE").ok().as_deref() != Some("1") {
    builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
      println!("single-instance argv: {argv:?}");
    }));
  }

  // --- 1) Liatir bridge plugin and native plugins ---
  builder = builder
    .plugin(bridge())
    // .plugin(prevent)
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(bridge::autostart::init_plugin());

  #[cfg(feature = "wdio")]
  {
    builder = builder
      .plugin(tauri_plugin_wdio::init())
      .plugin(tauri_plugin_wdio_webdriver::init());
  }

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

    // Install built-in WASM plugins from bundled resources (fastqc, …)
    bridge::plugins::ensure_builtin_modules(&app.handle());

    // Start local IPC server for Node.js adapter (liatir-cli dev mode, .liatir scripts)
    let ipc_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = bridge::ipc_server::start(ipc_handle).await {
            eprintln!("[ipc_server] failed to start: {e}");
        }
    });

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
    let _ = lia_logs_run_retention(app.handle().clone());

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
          if window.label().starts_with("plugin-dev-") {
            bridge::plugin_dev::cleanup_dev_session_for_window(window.app_handle(), window.label());
            return;
          }

          if window.label() != "main" {
            return;
          }

          let app = window.app_handle();
          let guard = app.state::<CloseGuard>();

          if guard.closing.load(Ordering::SeqCst) {
            return;
          }

          api.prevent_close();

          // Always re-emit on every close request. The frontend deduplicates
          // concurrent prompts on its side, so re-emitting is harmless — but it
          // makes the flow recoverable: if the first event was missed (listener
          // registered late, transient error), clicking the X again re-triggers
          // it instead of leaving the window permanently un-closable.
          guard.pending.store(true, Ordering::SeqCst);
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
          let _ = window.emit("window:close-requested", Some(serde_json::json!({
            "label": window.label().to_string()
          })));
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
      lia_notification_state,
      lia_request_permission,
      lia_notify,

      // clipboard
      lia_clipboard_write,
      lia_clipboard_read,

      // files
      lia_file_open,
      lia_file_save,
      lia_file_open_with_bytes,

      // app
      lia_app_info,
      lia_app_exit,

      // global_vars
      lia_global_vars_get,
      lia_global_vars_set,
      lia_global_vars_remove,
      lia_global_vars_list,

      // window
      lia_win_minimize,
      lia_win_maximize,
      lia_win_fullscreen,
      lia_win_open,
      lia_win_close,
      lia_win_continue_close,
      lia_win_cancel_close,
      lia_win_get_info,
      lia_visual_capture_region,

      // events
      lia_event_emit,
      lia_event_emit_to,
      lia_event_emit_to_current_window,

      // fs
      lia_fs_list_dir,
      lia_fs_mkdir,
      lia_fs_rm,
      lia_fs_stat,
      lia_fs_write_text,
      lia_fs_read_text,
      lia_fs_write_bytes,
      lia_fs_read_bytes,
      lia_fs_exists,
      lia_fs_move,
      lia_fs_copy,
      lia_fs_clear_cache,
      lia_fs_clear_data,
      lia_fs_paths,

      // fs trash
      lia_fs_trash_list_dir,
      lia_fs_trash_stat,
      lia_fs_trash_exists,
      lia_fs_trash_read_text,
      lia_fs_trash_read_bytes,
      lia_fs_data_recover_trash,
      lia_fs_data_clear_trash,

      // fs diagnostics
      lia_fs_diagnostics_list_dir,
      lia_fs_diagnostics_read_bytes,
      lia_fs_diagnostics_stat,
      lia_fs_diagnostics_read_text,
      lia_fs_diagnostics_rm,
      lia_fs_diagnostics_clear,
      lia_fs_diagnostics_exists,

      // menu
      lia_menu_set_enabled,
      lia_menu_set_checked,
      lia_init_menu_from_json,
      lia_init_menu_from_file,
      lia_init_menu_for_window_from_json,

      // diagnostics
      lia_logs_get_privacy,
      lia_logs_set_privacy,
      lia_logs_run_retention,
      lia_logs_list_files,
      lia_logs_read_file,
      lia_logs_record_js_error,
      lia_logs_record_native_error,
      lia_logs_record_error,
      lia_logs_new_record,
      lia_logs_export_zip,

      // network
      lia_network_get_status,
      lia_network_ping,
      lia_network_resolve,
      lia_network_bandwidth_estimate,
      lia_network_set_monitor,
      lia_network_stop_monitor,

      // autostart
      lia_get_autostart_mode,
      lia_set_autostart_mode,
      lia_autostart_enable,
      lia_autostart_disable,
      lia_autostart_status,

      // badge
      lia_badge_set,
      lia_badge_clear,

      // context_menu
      lia_context_menu_popup,

      // wasm tool runtime (internal; powers the fastqc bio wrapper and .lia wasm plugins)
      lia_plugin_paths,
      lia_fastqc_sample_path,
      lia_plugin_storage_clear,
      lia_plugin_call,

      // jobs
      lia_jobs_spawn,
      lia_jobs_kill,
      lia_jobs_status,
      lia_jobs_list,
      lia_jobs_clear_done,
      lia_jobs_get_output,

      // plugin log & progress
      lia_plugin_log,
      lia_plugin_progress,

      // deps
      lia_deps_check,
      lia_deps_check_many,

      // managed binaries
      lia_managed_download,
      lia_managed_download_cancel,
      lia_managed_verify_sha256,
      lia_managed_extract,
      lia_managed_find_binary,
      lia_managed_set_executable,
      lia_managed_move,
      lia_managed_remove,
      lia_ai_hardware_info,
      lia_ai_runtime_status,
      lia_ai_runtime_prepare,
      lia_ai_runtime_remove,
      lia_ai_python_spawn,
      lia_ai_python_run,
      lia_quenta_ollama_status,
      lia_quenta_ollama_models,
      lia_quenta_ollama_bootstrap,
      lia_quenta_ollama_chat,
      lia_quenta_ollama_embed,
      lia_snpeff_annotate,
      lia_snpeff_download_db,
      lia_bwa_mem,
      lia_minimap2,

      // startup cleanup
      lia_startup_cleanup,
      lia_cleanup_delete_part,

      // demo files
      lia_init_demo_files,

      // .lia plugins
      lia_liatir_read_manifest,
      lia_liatir_python_runtime_status,
      lia_liatir_python_runtime_prepare,
      lia_liatir_run,
      lia_plugin_dev_update_session,
      lia_plugin_dev_set_error,
      lia_plugin_dev_get_session,
      lia_plugin_dev_list_jobs,
      lia_plugin_dev_open_session,
      lia_plugin_dev_run,
      lia_plugin_dev_end_session,
      lia_plugin_save_output,
      lia_plugin_delete_output,

      // isolated app-managed storage
      lia_app_path,
      lia_app_exists,
      lia_app_read_text,
      lia_app_write_text,
      lia_app_mkdir,
      lia_app_remove,
      lia_app_migrate,

      // file utilities
      lia_file_size,
      lia_read_file_text,
      lia_write_file_path,
      lia_preview_file,

      // test commands only in dev
      #[cfg(debug_assertions)]
      lia_logs_test_record_n,
      #[cfg(debug_assertions)]
      lia_logs_test_panic,
      #[cfg(debug_assertions)]
      lia_logs_test_force_retention,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let RunEvent::ExitRequested { api, .. } = event {
        let Some(window) = app.get_webview_window("main") else {
          return;
        };
        let guard = app.state::<CloseGuard>();
        if guard.closing.load(Ordering::SeqCst) {
          return;
        }

        api.prevent_exit();
        // See the CloseRequested handler: always re-emit so a missed event can
        // recover on the next quit attempt instead of trapping the app open.
        guard.pending.store(true, Ordering::SeqCst);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("window:close-requested", Some(serde_json::json!({
          "label": window.label().to_string()
        })));
      }
    });
}
