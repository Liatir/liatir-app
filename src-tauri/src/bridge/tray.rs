// src/bridge/tray.rs
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use crate::helpers::states::*;

use tauri::{
  AppHandle, Wry, Manager, Emitter,
  menu::{Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem, IsMenuItem},
  tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
};

use crate::helpers::menu_builder::{
  MenuSectionConfig, MenuItemUnion, MenuConfigCustomItem, MenuConfigSubmenuItem,
  MenuInteraction, MenuPredefinedMenuItemSlug as P,
};

// --- debounce util (only for tray icon events) ---
static LAST_CLICK_MS: AtomicU64 = AtomicU64::new(0);

fn debounce(ms: u64) -> bool {
  let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
  let last = LAST_CLICK_MS.load(Ordering::Relaxed);
  if now.saturating_sub(last) < ms {
    return true;
  }
  LAST_CLICK_MS.store(now, Ordering::Relaxed);
  false
}

const NO_ACCEL: Option<&str> = None;
const DESKTOPR_TRAY_ID: &str = "dtr-tray-ywapdpvw";

/// Builds a single tray item from the JSON config.
/// Kept crate-visible so it remains reusable internally.
pub(crate) fn tray_build_item(
  app: &AppHandle<Wry>,
  it: &MenuItemUnion,
) -> tauri::Result<Option<Box<dyn IsMenuItem<Wry>>>> {
  Ok(match it {
    MenuItemUnion::Custom(MenuConfigCustomItem {
      id,
      label,
      enabled,
      interaction,
      checked,
      accelerator,
    }) => match interaction {
      MenuInteraction::Click => {
        let mi = MenuItem::with_id(app, id, label, *enabled, accelerator.as_deref())?;
        Some(Box::new(mi))
      }
      MenuInteraction::Check => {
        let mi = CheckMenuItem::with_id(
          app,
          id,
          label,
          *enabled,
          checked.unwrap_or(false),
          accelerator.as_deref(),
        )?;
        Some(Box::new(mi))
      }
    },

    MenuItemUnion::Predefined(p) => {
      let label = p.custom_label.as_deref();
      let b: Option<Box<dyn IsMenuItem<Wry>>> = match p.item {
        P::Separator => Some(Box::new(PredefinedMenuItem::separator(app)?)),
        P::Quit => Some(Box::new(PredefinedMenuItem::quit(app, label)?)),
        P::CloseWindow => Some(Box::new(PredefinedMenuItem::close_window(app, label)?)),
        P::Minimize => Some(Box::new(PredefinedMenuItem::minimize(app, label)?)),
        P::Maximize => Some(Box::new(PredefinedMenuItem::maximize(app, label)?)),
        P::Copy => Some(Box::new(PredefinedMenuItem::copy(app, label)?)),
        P::Cut => Some(Box::new(PredefinedMenuItem::cut(app, label)?)),
        P::Paste => Some(Box::new(PredefinedMenuItem::paste(app, label)?)),
        P::SelectAll => Some(Box::new(PredefinedMenuItem::select_all(app, label)?)),
        // macOS only:
        P::About => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::about(app, label, None)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::Services => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::services(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::Hide => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::hide(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::HideOthers => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::hide_others(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::ShowAll => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::show_all(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::Fullscreen => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::fullscreen(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::Undo => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::undo(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
        P::Redo => {
          #[cfg(target_os = "macos")]
          {
            Some(Box::new(PredefinedMenuItem::redo(app, label)?))
          }
          #[cfg(not(target_os = "macos"))]
          {
            None
          }
        }
      };
      b
    }

    MenuItemUnion::Separator => Some(Box::new(PredefinedMenuItem::separator(app)?)),

    MenuItemUnion::Submenu(MenuConfigSubmenuItem { label, items, .. }) => {
      let mut children: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
      for child in items {
        if let Some(b) = tray_build_item(app, child)? {
          children.push(b);
        }
      }

      let refs: Vec<&dyn IsMenuItem<Wry>> = children.iter().map(|b| b.as_ref()).collect();
      let submenu = Submenu::with_items(app, label, true, &refs)?;
      Some(Box::new(submenu))
    }
  })
}

/// Creates or replaces the tray using the provided tray section config.
pub fn init_tray_from_section(app: &AppHandle<Wry>, sec: &MenuSectionConfig) -> tauri::Result<()> {
  let mut sec_items_vector: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

  for it in &sec.items {
    if let Some(b) = tray_build_item(app, it)? {
      sec_items_vector.push(b);
    }
  }

  let mut all: Vec<&dyn IsMenuItem<Wry>> = vec![];
  for b in &sec_items_vector {
    all.push(b.as_ref());
  }

  let menu = Menu::with_items(app, &all)?;

  // Remove the existing tray before recreating it.
  let _ = app.remove_tray_by_id(DESKTOPR_TRAY_ID);

  let mut builder = TrayIconBuilder::with_id(DESKTOPR_TRAY_ID)
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, ev| {
      let id = ev.id.0.as_str();
      let window_label = get_latest_window_label(app);

      match id {
        "tray.show" => {
          if let Some(win) = app.get_webview_window(&window_label) {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
          }
        }
        "tray.hide" => {
          if let Some(win) = app.get_webview_window(&window_label) {
            let _ = win.minimize();
            let _ = win.hide();
          }
        }
        "tray.close" => {
          if let Some(win) = app.get_webview_window(&window_label) {
            let _ = win.close();
          }
        }
        "tray.quit" => app.exit(0),
        _ => {}
      }
    })
    .on_tray_icon_event(|tray, ev| {
      let (id, position, rect) = match &ev {
        TrayIconEvent::Click { id, position, rect, .. }
        | TrayIconEvent::DoubleClick { id, position, rect, .. }
        | TrayIconEvent::Enter { id, position, rect, .. }
        | TrayIconEvent::Move { id, position, rect, .. }
        | TrayIconEvent::Leave { id, position, rect, .. } => (id.clone(), *position, *rect),
        _ => return,
      };

      let id_str = id.0.as_str();
      let formatted_id = format!("tray.icon.{id_str}");

      match ev {
        TrayIconEvent::Click {
          button: MouseButton::Left,
          button_state: MouseButtonState::Down,
          ..
        } => {
          if debounce(120) {
            return;
          }

          let _ = tray.app_handle().emit(
            "tray:icon",
            Some(serde_json::json!({
              "id": formatted_id,
              "type": "click",
              "button": "left",
              "state": "down",
              "position": position,
              "rect": rect
            })),
          );

          if let Some(win) = tray.app_handle().get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
          }
        }

        TrayIconEvent::Click {
          button: MouseButton::Right,
          button_state: MouseButtonState::Down,
          ..
        } => {
          if debounce(120) {
            return;
          }

          let _ = tray.app_handle().emit(
            "tray:icon",
            Some(serde_json::json!({
              "id": formatted_id,
              "type": "click",
              "button": "right",
              "state": "down",
              "position": position,
              "rect": rect
            })),
          );
        }

        TrayIconEvent::Click {
          button: MouseButton::Middle,
          button_state: MouseButtonState::Down,
          ..
        } => {
          if debounce(120) {
            return;
          }

          let _ = tray.app_handle().emit(
            "tray:icon",
            Some(serde_json::json!({
              "id": formatted_id,
              "type": "click",
              "button": "middle",
              "state": "down",
              "position": position,
              "rect": rect
            })),
          );
        }

        TrayIconEvent::Enter { .. } => {
          if debounce(120) {
            return;
          }

          let _ = tray.app_handle().emit(
            "tray:icon",
            Some(serde_json::json!({
              "id": formatted_id,
              "type": "enter",
              "position": position,
              "rect": rect
            })),
          );
        }

        TrayIconEvent::Leave { .. } => {
          if debounce(120) {
            return;
          }

          let _ = tray.app_handle().emit(
            "tray:icon",
            Some(serde_json::json!({
              "id": formatted_id,
              "type": "leave",
              "position": position,
              "rect": rect
            })),
          );
        }

        _ => {}
      }
    });

  if let Some(icon) = app.default_window_icon().cloned() {
    builder = builder.icon(icon);
  }

  builder.build(app)?;
  Ok(())
}