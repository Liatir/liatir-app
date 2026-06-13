use std::path::Path;

use serde::Serialize;
use tauri::{
  App, AppHandle, Wry, Emitter, Manager,
  menu::{Menu, MenuItemKind, IsMenuItem, Submenu,
    MenuBuilder, SubmenuBuilder, MenuItemBuilder, CheckMenuItemBuilder, IconMenuItemBuilder
  },
  path::BaseDirectory
};
use std::fs;
use std::collections::HashMap;
use std::sync::Mutex;
use crate::helpers::menu_builder::*;
use crate::bridge::tray::init_tray_from_section;
use crate::helpers::states::*;

#[derive(Clone)]
pub struct MenuMeta {
  pub section: String,
  pub parent_label: Option<String>,      // label del submenu genitore (se presente)
  pub parent_id: Option<String>,         // id del submenu genitore (se presente)
}

pub struct MenuIndex {
  pub by_id: HashMap<String, MenuMeta>,
}

struct CheckState {
  map: Mutex<HashMap<String, bool>>,
}

struct CxCheckState {
  map: Mutex<HashMap<String, bool>>, // id -> checked (context menu only)
}

// -------- init --------


// Applies a MenuConfig to the app, building and setting the menu and tray, and managing state.
fn apply_menu_config(app: &AppHandle<Wry>, cfg: MenuConfig) -> tauri::Result<()> {
  if !cfg.enabled || !is_current_platform_in(&cfg.platforms) {
    return Ok(());
  }

  // 🔎 indice id -> { section, parent }
  let mut index_map: HashMap<String, MenuMeta> = HashMap::new();
  // 🔘 stato check id -> bool
  let mut check_map: HashMap<String, bool> = HashMap::new();

  let mut subs: Vec<tauri::menu::Submenu<Wry>> = Vec::new();

  #[cfg(target_os = "macos")]
  if let Some(sec) = cfg.macos_root.as_ref() {
    index_section_items(&mut index_map, "Desktopr", &sec.items, None, None);
    collect_check_items(&mut check_map, &sec.items);
    subs.push(build_submenu_from_section_handle(app, "Desktopr", sec)?);
  }

  if let Some(sec) = cfg.file.as_ref() {
    index_section_items(&mut index_map, "File", &sec.items, None, None);
    collect_check_items(&mut check_map, &sec.items);
    subs.push(build_submenu_from_section_handle(app, "File", sec)?);
  }
  if let Some(sec) = cfg.edit.as_ref() {
    index_section_items(&mut index_map, "Edit", &sec.items, None, None);
    collect_check_items(&mut check_map, &sec.items);
    subs.push(build_submenu_from_section_handle(app, "Edit", sec)?);
  }
  if let Some(sec) = cfg.view.as_ref() {
    index_section_items(&mut index_map, "View", &sec.items, None, None);
    collect_check_items(&mut check_map, &sec.items);
    subs.push(build_submenu_from_section_handle(app, "View", sec)?);
  }
  if let Some(sec) = cfg.window.as_ref() {
    index_section_items(&mut index_map, "Window", &sec.items, None, None);
    collect_check_items(&mut check_map, &sec.items);
    subs.push(build_submenu_from_section_handle(app, "Window", sec)?);
  }
  if let Some(sec) = cfg.tray.as_ref() {
    let mut tray_items: Vec<MenuItemUnion> = vec![
      MenuItemUnion::Custom(MenuConfigCustomItem {
        id: "tray.show".to_string(),
        label: "Show".to_string(),
        enabled: true,
        interaction: MenuInteraction::Click,
        checked: None,
        accelerator: None,
      }),
      MenuItemUnion::Custom(MenuConfigCustomItem {
        id: "tray.hide".to_string(),
        label: "Hide".to_string(),
        enabled: true,
        interaction: MenuInteraction::Click,
        checked: None,
        accelerator: None,
      }),
      MenuItemUnion::Custom(MenuConfigCustomItem {
        id: "tray.close".to_string(),
        label: "Close".to_string(),
        enabled: true,
        interaction: MenuInteraction::Click,
        checked: None,
        accelerator: None,
      }),
      MenuItemUnion::Custom(MenuConfigCustomItem {
        id: "tray.quit".to_string(),
        label: "Quit".to_string(),
        enabled: true,
        interaction: MenuInteraction::Click,
        checked: None,
        accelerator: None,
      }),
      MenuItemUnion::Separator,
    ];
    tray_items.extend(sec.items.clone());
    index_section_items(&mut index_map, "Tray", &tray_items, None, None);
    collect_check_items(&mut check_map, &tray_items);
    let sec_augmented = MenuSectionConfig {
      section: MenuSection::Tray,
      items: tray_items,
    };
    init_tray_from_section(app, &sec_augmented)?;
  }

  let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
    subs.iter().map(|s| s as &dyn tauri::menu::IsMenuItem<Wry>).collect();
  let root = tauri::menu::Menu::with_items(app, &refs)?;
  app.set_menu(root)?;

  app.manage(MenuIndex { by_id: index_map });
  app.manage(CheckState { map: Mutex::new(check_map) });
  app.manage(CxCheckState { map: Mutex::new(HashMap::new()) });

  attach_menu_events(app.clone());
  Ok(())
}

// Applies a MenuConfig only to a specific window.
// It builds a menu from the given config and attaches it to the target window,
// without touching the global app menu or shared MenuIndex/CheckState state.
fn apply_menu_config_to_window(
  app: &AppHandle<Wry>,
  window_label: &str,
  cfg: MenuConfig,
) -> tauri::Result<()> {
  // On macOS window-specific native menus are not supported, so we skip any work here.
  #[cfg(target_os = "macos")]
  {
    eprintln!(
      "[Desktopr][menu] Window-specific native menu is not supported on macOS; \
dtr_init_menu_for_window_from_json is a no-op on this platform."
    );
    return Ok(());
  }

  #[cfg(not(target_os = "macos"))]
  {
    if !cfg.enabled || !is_current_platform_in(&cfg.platforms) {
      return Ok(());
    }

    // Resolve target window
    let window = app
      .get_webview_window(window_label)
      .ok_or_else(|| {
        let e: tauri::Error = anyhow::anyhow!(
          "Window '{}' not found while initializing window-specific menu",
          window_label
        ).into();
        e
      })?;

    let mut subs: Vec<tauri::menu::Submenu<Wry>> = Vec::new();

    #[cfg(target_os = "macos")]
    if let Some(sec) = cfg.macos_root.as_ref() {
      subs.push(build_submenu_from_section_handle(app, "Desktopr", sec)?);
    }

    if let Some(sec) = cfg.file.as_ref() {
      subs.push(build_submenu_from_section_handle(app, "File", sec)?);
    }
    if let Some(sec) = cfg.edit.as_ref() {
      subs.push(build_submenu_from_section_handle(app, "Edit", sec)?);
    }
    if let Some(sec) = cfg.view.as_ref() {
      subs.push(build_submenu_from_section_handle(app, "View", sec)?);
    }
    if let Some(sec) = cfg.window.as_ref() {
      subs.push(build_submenu_from_section_handle(app, "Window", sec)?);
    }

    // NB: tray is still managed by the global menu; we do not touch it here.

    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
      subs.iter().map(|s| s as &dyn tauri::menu::IsMenuItem<Wry>).collect();

    // Build menu in the context of the target window
    let root = tauri::menu::Menu::with_items(&window, &refs)?;
    window.set_menu(root)?;

    Ok(())
  }
}

// Internal helpers for menu initialization from file and JSON
fn init_menu_from_file_internal(app: &AppHandle<Wry>, path: &Path) -> tauri::Result<()> {
  let s = fs::read_to_string(path).map_err(|e| -> tauri::Error {
    anyhow::anyhow!(
      "Impossibile leggere il file di configurazione del menu '{}': {}",
      path.display(),
      e
    ).into()
  })?;
  let cfg: MenuConfig = serde_json::from_str(&s).map_err(|e| -> tauri::Error {
    anyhow::anyhow!(
      "Impossibile fare il parse del file di configurazione del menu '{}': {}",
      path.display(),
      e
    ).into()
  })?;
  apply_menu_config(app, cfg)
}

fn init_menu_from_json_internal(app: &AppHandle<Wry>, cfg_json: &serde_json::Value) -> tauri::Result<()> {
  let cfg: MenuConfig = serde_json::from_value(cfg_json.clone()).map_err(|e| -> tauri::Error {
    anyhow::anyhow!(
      "Impossibile fare il parse della configurazione del menu da JSON: {}",
      e
    ).into()
  })?;
  apply_menu_config(app, cfg)
}

fn init_menu_for_window_from_json_internal(
  app: &AppHandle<Wry>,
  window_label: &str,
  cfg_json: &serde_json::Value,
) -> tauri::Result<()> {
  let cfg: MenuConfig = serde_json::from_value(cfg_json.clone()).map_err(|e| -> tauri::Error {
    anyhow::anyhow!(
      "Impossibile fare il parse della configurazione del menu da JSON (window '{}'): {}",
      window_label,
      e
    ).into()
  })?;
  apply_menu_config_to_window(app, window_label, cfg)
}

#[tauri::command]
pub fn dtr_init_menu_from_file(app: AppHandle<Wry>, path: String) -> Result<(), String> {
  let path_ref = Path::new(&path);
  init_menu_from_file_internal(&app, path_ref).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_init_menu_from_json(app: AppHandle<Wry>, cfg_json: serde_json::Value) -> Result<(), String> {
  init_menu_from_json_internal(&app, &cfg_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_init_menu_for_window_from_json(
  app: AppHandle<Wry>,
  window_label: String,
  cfg_json: serde_json::Value,
) -> Result<(), String> {
  init_menu_for_window_from_json_internal(&app, &window_label, &cfg_json)
    .map_err(|e| e.to_string())
}

pub fn init_menu(app: &App<Wry>) -> tauri::Result<()> {
  let cfg = match parse_menu_config(app) {
    Some(c) => c,
    None => return Ok(()),
  };
  apply_menu_config(&app.handle(), cfg)
}

// raccoglie tutti i check dell'albero e li mette in map (id -> checked)

fn collect_check_items(map: &mut HashMap<String, bool>, items: &[MenuItemUnion]) {
  for it in items {
    match it {
      MenuItemUnion::Custom(MenuConfigCustomItem { id, interaction, checked, .. }) => {
        if matches!(interaction, crate::helpers::menu_builder::MenuInteraction::Check) {
          map.insert(id.clone(), checked.unwrap_or(false));
        }
      }
      MenuItemUnion::Submenu(MenuConfigSubmenuItem { items, .. }) => {
        collect_check_items(map, items);
      }
      _ => {}
    }
  }
}

fn predefined_ids_and_label(
  item: &MenuPredefinedMenuItemSlug,
  custom_label: &Option<String>,
) -> (String, String, Option<&'static str>) {
  // If a custom label is provided, always use it and no accelerator
  if let Some(lbl) = custom_label {
    return (
      format!("predefined.{}", item_to_slug(item)),
      lbl.clone(),
      None,
    );
  }

  match item {
    MenuPredefinedMenuItemSlug::About => (
      "predefined.about".to_string(),
      "About".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::CloseWindow => (
      "predefined.close_window".to_string(),
      "Close Window".to_string(),
      Some("CmdOrCtrl+W"),
    ),
    MenuPredefinedMenuItemSlug::Copy => (
      "predefined.copy".to_string(),
      "Copy".to_string(),
      Some("CmdOrCtrl+C"),
    ),
    MenuPredefinedMenuItemSlug::Cut => (
      "predefined.cut".to_string(),
      "Cut".to_string(),
      Some("CmdOrCtrl+X"),
    ),
    MenuPredefinedMenuItemSlug::Fullscreen => (
      "predefined.fullscreen".to_string(),
      "Fullscreen".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::Hide => (
      "predefined.hide".to_string(),
      "Hide".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::HideOthers => (
      "predefined.hide_others".to_string(),
      "Hide Others".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::Maximize => (
      "predefined.maximize".to_string(),
      "Maximize".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::Minimize => (
      "predefined.minimize".to_string(),
      "Minimize".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::Paste => (
      "predefined.paste".to_string(),
      "Paste".to_string(),
      Some("CmdOrCtrl+V"),
    ),
    MenuPredefinedMenuItemSlug::Quit => (
      "predefined.quit".to_string(),
      "Quit".to_string(),
      Some("CmdOrCtrl+Q"),
    ),
    MenuPredefinedMenuItemSlug::Redo => (
      "predefined.redo".to_string(),
      "Redo".to_string(),
      Some("CmdOrCtrl+Shift+Z"),
    ),
    MenuPredefinedMenuItemSlug::SelectAll => (
      "predefined.select_all".to_string(),
      "Select All".to_string(),
      Some("CmdOrCtrl+A"),
    ),
    MenuPredefinedMenuItemSlug::Services => (
      "predefined.services".to_string(),
      "Services".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::ShowAll => (
      "predefined.show_all".to_string(),
      "Show All".to_string(),
      None,
    ),
    MenuPredefinedMenuItemSlug::Undo => (
      "predefined.undo".to_string(),
      "Undo".to_string(),
      Some("CmdOrCtrl+Z"),
    ),
    // For a predefined "separator" slug, caller should handle it as a separator
    MenuPredefinedMenuItemSlug::Separator => (
      "predefined.separator".to_string(),
      "".to_string(),
      None,
    ),
  }
}

fn item_to_slug(item: &MenuPredefinedMenuItemSlug) -> &'static str {
  match item {
    MenuPredefinedMenuItemSlug::About => "about",
    MenuPredefinedMenuItemSlug::CloseWindow => "close_window",
    MenuPredefinedMenuItemSlug::Copy => "copy",
    MenuPredefinedMenuItemSlug::Cut => "cut",
    MenuPredefinedMenuItemSlug::Fullscreen => "fullscreen",
    MenuPredefinedMenuItemSlug::Hide => "hide",
    MenuPredefinedMenuItemSlug::HideOthers => "hide_others",
    MenuPredefinedMenuItemSlug::Maximize => "maximize",
    MenuPredefinedMenuItemSlug::Minimize => "minimize",
    MenuPredefinedMenuItemSlug::Paste => "paste",
    MenuPredefinedMenuItemSlug::Quit => "quit",
    MenuPredefinedMenuItemSlug::Redo => "redo",
    MenuPredefinedMenuItemSlug::SelectAll => "select_all",
    MenuPredefinedMenuItemSlug::Separator => "separator",
    MenuPredefinedMenuItemSlug::Services => "services",
    MenuPredefinedMenuItemSlug::ShowAll => "show_all",
    MenuPredefinedMenuItemSlug::Undo => "undo",
  }
}

fn add_if_some(
  app: &App<Wry>,
  acc: &mut Vec<Submenu<Wry>>,
  title: &str,
  sec: Option<&MenuSectionConfig>,
) -> tauri::Result<()> {
  if let Some(section) = sec {
    acc.push(build_submenu_from_section(app, title, section)?);
  }
  Ok(())
}

// Local builder that mirrors helpers::menu_builder::build_submenu_from_section
// but accepts an AppHandle (works at runtime commands). It only uses public
// Tauri builders that accept any Manager (AppHandle implements Manager).
fn build_submenu_from_section_handle(
  app: &AppHandle<Wry>,
  title: &str,
  sec: &MenuSectionConfig,
) -> tauri::Result<Submenu<Wry>> {
  let mut built_menu_items: Vec<tauri::menu::MenuItem<Wry>> = Vec::new();
  let mut built_check_items: Vec<tauri::menu::CheckMenuItem<Wry>> = Vec::new();
  let mut built_icon_items: Vec<tauri::menu::IconMenuItem<Wry>> = Vec::new();
  let mut built_submenus: Vec<Submenu<Wry>> = Vec::new();

  let mut builder = SubmenuBuilder::new(app, title);

  for item in &sec.items {
    match item {
      MenuItemUnion::Separator => {
        builder = builder.separator();
      }
      MenuItemUnion::Custom(MenuConfigCustomItem { id, label, enabled, interaction, checked, accelerator }) => {
        match interaction {
          MenuInteraction::Click => {
            let mut b = MenuItemBuilder::with_id(id, label).enabled(*enabled);
            if let Some(acc) = accelerator.as_ref() { b = b.accelerator(acc); }
            let mi = b.build(app)?;
            built_menu_items.push(mi);
            builder = builder.item(built_menu_items.last().unwrap());
          }
          MenuInteraction::Check => {
            let mut b = CheckMenuItemBuilder::with_id(id, label).enabled(*enabled);
            b = b.checked(checked.unwrap_or(false));
            let ci = b.build(app)?;
            built_check_items.push(ci);
            builder = builder.item(built_check_items.last().unwrap());
          }
        }
      }
      MenuItemUnion::Predefined(MenuConfigPredefinedItem { item, custom_label, .. }) => {
        if let MenuPredefinedMenuItemSlug::Separator = item {
          builder = builder.separator();
        } else {
          let (id, label, acc) = predefined_ids_and_label(item, custom_label);
          let mut b = MenuItemBuilder::with_id(&id, &label).enabled(true);
          if let Some(accel) = acc { b = b.accelerator(accel); }
          let mi = b.build(app)?;
          built_menu_items.push(mi);
          builder = builder.item(built_menu_items.last().unwrap());
        }
      }
      MenuItemUnion::Submenu(MenuConfigSubmenuItem { id, label, items }) => {
        // Only one level of submenu allowed — no recursion
        let mut nested_builder = SubmenuBuilder::with_id(app, id, label);
        let mut nested_menu_items: Vec<tauri::menu::MenuItem<Wry>> = Vec::new();
        let mut nested_check_items: Vec<tauri::menu::CheckMenuItem<Wry>> = Vec::new();

        for subitem in items {
          match subitem {
            MenuItemUnion::Separator => {
              nested_builder = nested_builder.separator();
            }
            MenuItemUnion::Custom(MenuConfigCustomItem { id, label, enabled, interaction, checked, accelerator }) => {
              match interaction {
                MenuInteraction::Click => {
                  let mut b = MenuItemBuilder::with_id(id, label).enabled(*enabled);
                  if let Some(acc) = accelerator.as_ref() { b = b.accelerator(acc); }
                  let mi = b.build(app)?;
                  nested_menu_items.push(mi);
                  nested_builder = nested_builder.item(nested_menu_items.last().unwrap());
                }
                MenuInteraction::Check => {
                  let mut b = CheckMenuItemBuilder::with_id(id, label).enabled(*enabled);
                  b = b.checked(checked.unwrap_or(false));
                  let ci = b.build(app)?;
                  nested_check_items.push(ci);
                  nested_builder = nested_builder.item(nested_check_items.last().unwrap());
                }
              }
            }
            MenuItemUnion::Predefined(MenuConfigPredefinedItem { item, custom_label, .. }) => {
              if let MenuPredefinedMenuItemSlug::Separator = item {
                nested_builder = nested_builder.separator();
              } else {
                let (id, label, acc) = predefined_ids_and_label(item, custom_label);
                let mut b = MenuItemBuilder::with_id(&id, &label).enabled(true);
                if let Some(accel) = acc { b = b.accelerator(accel); }
                let mi = b.build(app)?;
                nested_menu_items.push(mi);
                nested_builder = nested_builder.item(nested_menu_items.last().unwrap());
              }
            }
            _ => {}
          }
        }

        let nested_submenu = nested_builder.build()?;
        built_submenus.push(nested_submenu);
        builder = builder.item(built_submenus.last().unwrap());
      }
      _ => {}
    }
  }

  builder.build()
}

fn is_current_platform_in(list: &[MenuPlatform]) -> bool {
  #[cfg(target_os = "macos")]   { list.contains(&MenuPlatform::Macos) }
  #[cfg(target_os = "windows")] { list.contains(&MenuPlatform::Windows) }
  #[cfg(target_os = "linux")]   { list.contains(&MenuPlatform::Linux) }
}

// -------- config parsing (risorse) --------

fn parse_menu_config(app: &App<Wry>) -> Option<MenuConfig> {
  #[cfg(debug_assertions)]
  {
    if let Ok(root) = app.path().resolve("", BaseDirectory::Resource) {
      eprintln!("[RES] root: {:?}", root);
      if let Ok(entries) = fs::read_dir(&root) {
        eprintln!("[RES] entries at root:");
        for e in entries.flatten() {
          eprintln!("  - {:?}", e.path());
        }
      }
    }
  }

  // Copre sia la dichiarazione glob ("resources/**") sia il singolo file
  let candidates = [
    "menu/menu.config.json",           // se bundle: "resources/**"
    "menu.config.json",                // se bundle: "resources/menu/menu.config.json"
    "resources/menu/menu.config.json", // fallback
    "resources/menu.config.json",
  ];

  for candidate in candidates {
    if let Ok(path) = app.path().resolve(candidate, BaseDirectory::Resource) {
      if let Ok(s) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<MenuConfig>(&s) {
          #[cfg(debug_assertions)]
          eprintln!("[RES] loaded: {:?}", path);
          return Some(cfg);
        }
      }
    }
  }

  #[cfg(debug_assertions)]
  eprintln!("⚠️  No menu config found in resources (tried multiple candidates)");
  None
}

// indicizza tutti gli item (custom) con sezione (lowercase) e parent (label+id)
fn index_section_items(
  map: &mut HashMap<String, MenuMeta>,
  section_title: &str,
  items: &[MenuItemUnion],
  parent_label: Option<&str>,
  parent_id: Option<&str>,
) {
  let section_lc = section_title.to_ascii_lowercase();

  for it in items {
    match it {
      MenuItemUnion::Custom(MenuConfigCustomItem { id, .. }) => {
        map.insert(
          id.clone(),
          MenuMeta {
            section: section_lc.clone(),
            parent_label: parent_label.map(|s| s.to_string()),
            parent_id: parent_id.map(|s| s.to_string()),
          },
        );
      }
      MenuItemUnion::Submenu(MenuConfigSubmenuItem { id, label, items }) => {
        // ricorsione: passa label + id del submenu come parent
        index_section_items(map, section_title, items, Some(label.as_str()), Some(id.as_str()));
      }
      _ => {}
    }
  }
}

// -------- event bridge --------

#[derive(Serialize, Clone)]
struct MenuEventPayload<'a> {
  id: &'a str,
  #[serde(skip_serializing_if = "Option::is_none")]
  checked: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  section: Option<String>,        // sempre lowercase
  #[serde(skip_serializing_if = "Option::is_none")]
  parent_label: Option<String>,   // se annidato
  #[serde(skip_serializing_if = "Option::is_none")]
  parent_id: Option<String>,      // se annidato
  #[serde(skip_serializing_if = "Option::is_none")]
  last_focused_window_label: Option<String>,
}

fn attach_menu_events(app: AppHandle<Wry>) {
  app.on_menu_event(move |app, ev| {
    let id = ev.id().as_ref();

    // 🔘 Deterministic check-state handling:
    // First try main menu CheckState; if not present, fall back to context-menu state.
    let checked = if let Some(state) = app.try_state::<CheckState>() {
      let mut map = state.map.lock().unwrap();
      if let Some(val) = map.get_mut(id) {
        *val = !*val;                 // toggle known main-menu check item
        let new_val = *val;
        // align UI (idempotent even if OS already updated)
        let _ = super::set_checked(&app, id, new_val);
        Some(new_val)
      } else {
        // Not a known main-menu check item → maybe a context-menu check
        if let Some(cx) = app.try_state::<CxCheckState>() {
          let mut cmap = cx.map.lock().unwrap();
          if let Some(val) = cmap.get_mut(id) {
            *val = !*val; // toggle existing context item
            Some(*val)
          } else {
            // unknown context item: do not assume it's a check; no "checked" field
            None
          }
        } else {
          None
        }
      }
    } else {
      None
    };

    // 🔎 lookup in indice (se presente: section + parent)
    let (section, parent_label, parent_id) = if let Some(idx) = app.try_state::<MenuIndex>() {
      if let Some(meta) = idx.by_id.get(id) {
        (Some(meta.section.clone()), meta.parent_label.clone(), meta.parent_id.clone())
      } else {
        // Not in the main menu index → treat as context menu
        (Some("context_menu".to_string()), None, None)
      }
    } else {
      (Some("context_menu".to_string()), None, None)
    };
    let window_label = get_latest_window_label(app);
    let _ = app.emit(
      "menu:event",
      MenuEventPayload { id, checked, section, parent_label, parent_id, last_focused_window_label: Some(window_label) }
    );
  });
}

// -------- runtime mutators --------

pub fn set_enabled(app: &AppHandle<Wry>, id: &str, enabled: bool) -> tauri::Result<()> {
  if let Some(menu) = app.menu() {
    if let Some(kind) = menu.get(id) {
      match kind {
        MenuItemKind::MenuItem(mi) => mi.set_enabled(enabled)?,
        MenuItemKind::Check(mi)    => mi.set_enabled(enabled)?,
        MenuItemKind::Icon(mi)     => mi.set_enabled(enabled)?,
        _ => {}
      }
    }
  }
  Ok(())
}

pub fn set_checked(app: &AppHandle<Wry>, id: &str, checked: bool) -> tauri::Result<()> {
  if let Some(menu) = app.menu() {
    if let Some(MenuItemKind::Check(mi)) = menu.get(id) {
      mi.set_checked(checked)?;
    }
  }
  Ok(())
}

#[tauri::command]
pub fn dtr_menu_set_enabled(app: AppHandle<Wry>, id: String, enabled: bool) -> Result<(), String> {
  set_enabled(&app, &id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dtr_menu_set_checked(app: AppHandle<Wry>, id: String, checked: bool) -> Result<(), String> {
  set_checked(&app, &id, checked).map_err(|e| e.to_string())
}