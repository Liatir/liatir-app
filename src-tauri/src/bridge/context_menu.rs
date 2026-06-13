// src-tauri/src/bridge/context_menu.rs
use tauri::{
  AppHandle, Manager, Runtime, webview::WebviewWindow,
  menu::{
    Menu, MenuBuilder, Submenu, SubmenuBuilder,
    MenuItem, MenuItemBuilder, CheckMenuItem, CheckMenuItemBuilder,
    PredefinedMenuItem, MenuEvent, MenuId
  },
  Position,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock}};
use tokio::sync::oneshot;

/// ---------- Public schema (passed from JS) ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CmNode {
  #[serde(rename = "Item", alias = "item")]
  // Simple clickable item
  Item {
    #[serde(rename = "section", default = "default_section")]
    section: SectionTag,
    id: String,
    text: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    shortcut: Option<String>,
  },
  #[serde(rename = "Check", alias = "check")]
  // Checkbox item
  Check {
    #[serde(rename = "section", default = "default_section")]
    section: SectionTag,
    id: String,
    text: String,
    #[serde(default)]
    checked: bool,
    #[serde(default)]
    enabled: bool,
  },
  #[serde(rename = "Separator", alias = "separator")]
  // Separator line
  Separator {
    #[serde(rename = "section", default = "default_section")]
    section: SectionTag,
  },
  #[serde(rename = "Submenu", alias = "submenu")]
  // Submenu with children
  Submenu {
    #[serde(rename = "section", default = "default_section")]
    section: SectionTag,
    text: String,
    items: Vec<CmNode>,
  },
  #[serde(rename = "Predefined", alias = "predefined")]
  // Optional: a native predefined (rarely needed in context menus)
  Predefined {
    #[serde(rename = "section", default = "default_section")]
    section: SectionTag,
    kind: String,
  },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SectionTag {
  #[serde(rename = "context_menu")]
  ContextMenu,
}

fn default_section() -> SectionTag {
  SectionTag::ContextMenu
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmPopupOptions {
  /// Target window label; defaults to "main"
  pub window: Option<String>,
  /// If set, popup at this logical position (relative to window TL).
  pub at_logical: Option<[f64; 2]>,
  /// If set, popup at this physical position (relative to window TL).
  pub at_physical: Option<[i32; 2]>,
  /// Optional: close menu if any click outside (default true).
  pub dismiss_outside: Option<bool>,
  /// Optional timeout ms to give up waiting (default 15000)
  pub timeout_ms: Option<u64>,
}

/// ---------- Internal state for awaiting a single selection ----------

struct AwaitOnce {
  tx: oneshot::Sender<Option<String>>,
  // map MenuId -> item id (string given by caller)
  id_map: HashMap<MenuId, String>,
}

type AwaitMap = Arc<Mutex<HashMap<u64, AwaitOnce>>>;

fn global_await_map() -> &'static AwaitMap {
  static MAP: OnceLock<AwaitMap> = OnceLock::new();
  MAP.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn next_ticket() -> u64 {
  use std::sync::atomic::{AtomicU64, Ordering};
  static T: AtomicU64 = AtomicU64::new(1);
  T.fetch_add(1, Ordering::SeqCst)
}

/// ---------- Build helpers ----------

fn build_menu_recursive<R: Runtime>(
  app: &AppHandle<R>,
  nodes: &[CmNode],
  id_map: &mut HashMap<MenuId, String>,
) -> tauri::Result<Menu<R>> {
  let mut builder = MenuBuilder::new(app);
  let mut predefined_items: Vec<PredefinedMenuItem<R>> = Vec::new();
  for node in nodes {
    match node {
      CmNode::Item { id, text, enabled, shortcut, .. } => {
        let mut b = MenuItemBuilder::with_id(id.clone(), text);
        b = b.enabled(*enabled);
        if let Some(accel) = shortcut {
          b = b.accelerator(accel);
        }
        let item: MenuItem<R> = b.build(app)?;
        id_map.insert(item.id().clone(), id.clone());
        builder = builder.item(&item);
      }
      CmNode::Check { id, text, checked, enabled, .. } => {
        let item: CheckMenuItem<R> = CheckMenuItemBuilder::with_id(id.clone(), text)
          .checked(*checked)
          .enabled(*enabled)
          .build(app)?;
        id_map.insert(item.id().clone(), id.clone());
        builder = builder.item(&item);
      }
      CmNode::Separator { .. } => {
        builder = builder.separator();
      }
      CmNode::Submenu { text, items, .. } => {
        // Build submenu recursively
        let sub = build_submenu(app, text, items, id_map)?;
        builder = builder.item(&sub);
      }
      CmNode::Predefined { kind, .. } => {
        // Map string -> PredefinedMenuItem. Platform support may vary.
        let pre = match kind.as_str() {
          // Editing
          "undo" => PredefinedMenuItem::undo(app, None)?,
          "redo" => PredefinedMenuItem::redo(app, None)?,
          "cut" => PredefinedMenuItem::cut(app, None)?,
          "copy" => PredefinedMenuItem::copy(app, None)?,
          "paste" => PredefinedMenuItem::paste(app, None)?,
          "selectAll" => PredefinedMenuItem::select_all(app, None)?,

          // Window / app control (availability is OS dependent)
          "minimize" => PredefinedMenuItem::minimize(app, None)?,
          "maximize" => PredefinedMenuItem::maximize(app, None)?,
          "fullscreen" => PredefinedMenuItem::fullscreen(app, None)?,
          "closeWindow" => PredefinedMenuItem::close_window(app, None)?,
          "hide" => PredefinedMenuItem::hide(app, None)?,
          "hideOthers" => PredefinedMenuItem::hide_others(app, None)?,
          "showAll" => PredefinedMenuItem::show_all(app, None)?,
          "quit" => PredefinedMenuItem::quit(app, None)?,
          "services" => PredefinedMenuItem::services(app, None)?,

          // Fallback to separator for unknown kinds
          _ => PredefinedMenuItem::separator(app)?,
        };
        predefined_items.push(pre);
        builder = builder.item(predefined_items.last().unwrap());
      }
    }
  }
  builder.build()
}

fn build_submenu<R: Runtime>(
  app: &AppHandle<R>,
  title: &str,
  items: &[CmNode],
  id_map: &mut HashMap<MenuId, String>,
) -> tauri::Result<Submenu<R>> {
  let mut sb = SubmenuBuilder::new(app, title);

  // To keep created items alive until `build()`, store them in local vectors.
  let mut text_items: Vec<MenuItem<R>> = Vec::new();
  let mut check_items: Vec<CheckMenuItem<R>> = Vec::new();
  let mut predefined_items: Vec<PredefinedMenuItem<R>> = Vec::new();
  let mut submenus: Vec<Submenu<R>> = Vec::new();

  for node in items {
    match node {
      CmNode::Item { id, text, enabled, shortcut, .. } => {
        let mut b = MenuItemBuilder::with_id(id.clone(), text);
        b = b.enabled(*enabled);
        if let Some(accel) = shortcut { b = b.accelerator(accel); }
        let item = b.build(app)?;
        id_map.insert(item.id().clone(), id.clone());
        text_items.push(item);
        let last = text_items.last().unwrap();
        sb = sb.item(last);
      }
      CmNode::Check { id, text, checked, enabled, .. } => {
        let item = CheckMenuItemBuilder::with_id(id.clone(), text)
          .checked(*checked)
          .enabled(*enabled)
          .build(app)?;
        id_map.insert(item.id().clone(), id.clone());
        check_items.push(item);
        let last = check_items.last().unwrap();
        sb = sb.item(last);
      }
      CmNode::Separator { .. } => {
        sb = sb.separator();
      }
      CmNode::Submenu { text, items, .. } => {
        let sub = build_submenu(app, text, items, id_map)?;
        submenus.push(sub);
        let last = submenus.last().unwrap();
        sb = sb.item(last);
      }
      CmNode::Predefined { kind, .. } => {
        let pre = match kind.as_str() {
          // Editing
          "undo" => PredefinedMenuItem::undo(app, None)?,
          "redo" => PredefinedMenuItem::redo(app, None)?,
          "cut" => PredefinedMenuItem::cut(app, None)?,
          "copy" => PredefinedMenuItem::copy(app, None)?,
          "paste" => PredefinedMenuItem::paste(app, None)?,
          "selectAll" => PredefinedMenuItem::select_all(app, None)?,

          // Window / app control (availability is OS dependent)
          "minimize" => PredefinedMenuItem::minimize(app, None)?,
          "maximize" => PredefinedMenuItem::maximize(app, None)?,
          "fullscreen" => PredefinedMenuItem::fullscreen(app, None)?,
          "closeWindow" => PredefinedMenuItem::close_window(app, None)?,
          "hide" => PredefinedMenuItem::hide(app, None)?,
          "hideOthers" => PredefinedMenuItem::hide_others(app, None)?,
          "showAll" => PredefinedMenuItem::show_all(app, None)?,
          "quit" => PredefinedMenuItem::quit(app, None)?,
          "services" => PredefinedMenuItem::services(app, None)?,

          // Fallback to separator for unknown kinds (no `delete`/`zoom` in v2)
          _ => PredefinedMenuItem::separator(app)?,
        };
        predefined_items.push(pre);
        let last = predefined_items.last().unwrap();
        sb = sb.item(last);
      }
    }
  }

  sb.build()
}

/// ---------- Core command ----------

/// Show a native context menu and return the clicked item id (or null if closed).
///
/// Usage from JS:
/// ```ts
/// import { invoke } from '@tauri-apps/api/core';
/// const choice = await invoke<string | null>('dtr_context_menu_popup', {
///   items: [
///     { type: 'Item', id: 'do-add', text: 'Add', enabled: true },
///     { type: 'Item', id: 'do-remove', text: 'Remove', enabled: true, shortcut: 'CmdOrCtrl+Backspace' },
///     { type: 'Separator' },
///     { type: 'Check', id: 'flag', text: 'Pinned', checked: false, enabled: true },
///     { type: 'Submenu', text: 'More', items: [ { type: 'Item', id: 'info', text: 'Info', enabled: true } ] },
///   ],
///   options: { window: 'main' } // or at_logical: [x,y]
/// });
/// ```
#[tauri::command]
pub async fn dtr_context_menu_popup(
  app: AppHandle,
  items: Vec<CmNode>,
  options: Option<CmPopupOptions>,
) -> Result<Option<String>, String> {
  // Resolve window
  let opts = options.unwrap_or(CmPopupOptions {
    window: None,
    at_logical: None,
    at_physical: None,
    dismiss_outside: Some(true),
    timeout_ms: Some(15_000),
  });
  let label = opts.window.unwrap_or_else(|| "main".to_string());
  let win = app
    .get_webview_window(&label)
    .ok_or_else(|| format!("window '{label}' not found"))?;

  // Build the menu (collecting mapping MenuId -> user id)
  let mut id_map: HashMap<MenuId, String> = HashMap::new();
  let menu = build_menu_recursive(&app, &items, &mut id_map)
    .map_err(|e| e.to_string())?;

  // Create a oneshot and register it in the global await map
  let (tx, rx) = oneshot::channel::<Option<String>>();
  let ticket = next_ticket();
  {
    let mut g = global_await_map().lock().unwrap();
    g.insert(ticket, AwaitOnce { tx, id_map });
  }

  // Temporary menu-event handler: on click, resolve the ticket and unregister
  let handler = win.on_menu_event(move |_w, ev: MenuEvent| {
    // Acquire map; if ticket still present, match ev.id
    let maybe_tx = {
      let mut g = global_await_map().lock().unwrap();
      g.remove(&ticket)
    };
    if let Some(mut payload) = maybe_tx {
      // Translate MenuId -> user id
      let clicked = payload.id_map.remove(&ev.id).map(Some).unwrap_or(None);
      // Best-effort send (ignore if receiver dropped)
      let _ = payload.tx.send(clicked);
    }
    // NOTE: handler is not automatically removed; it’s fine since it captures
    // only a ticket consumed once. If you need to hard-remove, keep the id and call window.unlisten.
  });

  // Popup the context menu
  let popup_res = if let Some([x, y]) = opts.at_logical {
    win.popup_menu_at(&menu, Position::Logical((x, y).into()))
  } else if let Some([x, y]) = opts.at_physical {
    win.popup_menu_at(&menu, Position::Physical((x, y).into()))
  } else {
    win.popup_menu(&menu)
  };
  if let Err(e) = popup_res {
    // Cleanup await entry if popup failed
    let maybe_tx = {
      let mut g = global_await_map().lock().unwrap();
      g.remove(&ticket)
    };
    if let Some(payload) = maybe_tx {
      let _ = payload.tx.send(None);
    }
    return Err(format!("popup_menu failed: {e}"));
  }

  // Wait for selection or timeout (null on dismiss)
  let timeout = std::time::Duration::from_millis(opts.timeout_ms.unwrap_or(15_000));
  let out = match tokio::time::timeout(timeout, rx).await {
    Ok(Ok(choice)) => choice,
    _ => {
      // On timeout, remove pending entry if still present
      let maybe_tx = {
        let mut g = global_await_map().lock().unwrap();
        g.remove(&ticket)
      };
      if let Some(payload) = maybe_tx {
        let _ = payload.tx.send(None);
      }
      None
    }
  };

  Ok(out)
}