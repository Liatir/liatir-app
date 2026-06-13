use serde::Deserialize;
use tauri::{
  App, Manager, Runtime,
  menu::{Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem, IsMenuItem},
};

const NO_ACCEL: Option<&str> = None;

// ========= Tipi coerenti con i "CORRECT MENU CONFIGURATION TYPES" =========

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuConfig {
  pub enabled: bool,
  pub platforms: Vec<MenuPlatform>,
  // Chiavi opzionali: file/view/edit/window/macosRoot -> MenuSectionConfig
  #[serde(default)] pub file: Option<MenuSectionConfig>,
  #[serde(default)] pub view: Option<MenuSectionConfig>,
  #[serde(default)] pub edit: Option<MenuSectionConfig>,
  #[serde(default)] pub window: Option<MenuSectionConfig>,
  #[serde(default)] pub macos_root: Option<MenuSectionConfig>, // camelCase -> macosRoot
  #[serde(default)] pub tray: Option<MenuSectionConfig>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "lowercase")]
pub enum MenuPlatform { Macos, Windows, Linux }

// Valore della chiave: { section: "...", items: [...] }
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuSectionConfig {
  pub section: MenuSection,
  pub items: Vec<MenuItemUnion>,
}

// "file" | "view" | "edit" | "window" | "macosRoot"
#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub enum MenuSection { File, View, Edit, Window, MacosRoot, Tray }

// Unione TAGGATA sul campo "type" degli item
#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MenuItemUnion {
  Custom(MenuConfigCustomItem),
  Predefined(MenuConfigPredefinedItem),
  Submenu(MenuConfigSubmenuItem),
  Separator, // item con { "type": "separator" }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuConfigCustomItem {
  pub id: String,
  pub label: String,
  pub enabled: bool,
  pub interaction: MenuInteraction,
  #[serde(default)] pub checked: Option<bool>,
  #[serde(default)] pub accelerator: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuConfigPredefinedItem {
  pub item: MenuPredefinedMenuItemSlug,
  #[serde(default)] pub custom_label: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum MenuInteraction { Click, Check }

// NB: niente "bring_all_to_front" in Tauri v2
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum MenuPredefinedMenuItemSlug {
  About, CloseWindow, Copy, Cut, Fullscreen, Hide, HideOthers, Maximize,
  Minimize, Paste, Quit, Redo, SelectAll, Separator, Services, ShowAll, Undo,
}

// Per i submenu ricorsivi: il tag "type":"submenu" è gestito dall’enum
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuConfigSubmenuItem {
  pub id: String,
  pub label: String,
  pub items: Vec<MenuItemUnion>,
}

// ============================= Builders =============================

pub fn build_submenu_from_section<R: Runtime>(
  app: &App<R>,
  title: &str,
  section: &MenuSectionConfig,
) -> tauri::Result<Submenu<R>> {
  // eprintln!("Building section {}: {:#?}", title, section.items); // prints the parsed json
  let mut boxed: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
  for it in &section.items {
    if let Some(b) = build_menu_item(app, it)? {
      boxed.push(b);
    }
  }
  let refs: Vec<&dyn IsMenuItem<R>> = boxed.iter().map(|b| b.as_ref()).collect();
  Submenu::with_items(app, title, true, &refs)
}

fn build_menu_item<R: Runtime>(
  app: &App<R>,
  it: &MenuItemUnion
) -> tauri::Result<Option<Box<dyn IsMenuItem<R>>>> {
  Ok(match it {
    MenuItemUnion::Custom(c) => {
      match c.interaction {
        MenuInteraction::Click => {
          let mi = MenuItem::with_id(
            app, &c.id, &c.label, c.enabled, c.accelerator.as_deref() // ✅ usa accelerator se presente
          )?;
          Some(Box::new(mi))
        }
        MenuInteraction::Check => {
          let mi = CheckMenuItem::with_id(
            app, &c.id, &c.label, c.enabled, c.checked.unwrap_or(false), c.accelerator.as_deref() // ✅
          )?;
          Some(Box::new(mi))
        }
      }
    }
    MenuItemUnion::Predefined(p) => {
      if let MenuPredefinedMenuItemSlug::Separator = p.item {
        Some(Box::new(PredefinedMenuItem::separator(app)?))
      } else {
        build_predefined(app, p)?
      }
    }
    MenuItemUnion::Separator => {
      Some(Box::new(PredefinedMenuItem::separator(app)?))
    }
    MenuItemUnion::Submenu(sm) => {
      // ricorsione
      let mut children: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
      for child in &sm.items {
        if let Some(b) = build_menu_item(app, child)? {
          children.push(b);
        }
      }
      let refs: Vec<&dyn IsMenuItem<R>> = children.iter().map(|b| b.as_ref()).collect();
      let submenu = Submenu::with_items(app, &sm.label, true, &refs)?;
      Some(Box::new(submenu))
    }
  })
}

fn build_predefined<R: Runtime>(
  app: &App<R>,
  p: &MenuConfigPredefinedItem
) -> tauri::Result<Option<Box<dyn IsMenuItem<R>>>> {
  let label = p.custom_label.as_deref();
  let out: Option<Box<dyn IsMenuItem<R>>> = match p.item {
    MenuPredefinedMenuItemSlug::Copy       => Some(Box::new(PredefinedMenuItem::copy(app, label)?)),
    MenuPredefinedMenuItemSlug::Cut        => Some(Box::new(PredefinedMenuItem::cut(app, label)?)),
    MenuPredefinedMenuItemSlug::Paste      => Some(Box::new(PredefinedMenuItem::paste(app, label)?)),
    MenuPredefinedMenuItemSlug::SelectAll  => Some(Box::new(PredefinedMenuItem::select_all(app, label)?)),
    MenuPredefinedMenuItemSlug::CloseWindow=> Some(Box::new(PredefinedMenuItem::close_window(app, label)?)),
    MenuPredefinedMenuItemSlug::Quit       => Some(Box::new(PredefinedMenuItem::quit(app, label)?)),
    MenuPredefinedMenuItemSlug::Minimize   => Some(Box::new(PredefinedMenuItem::minimize(app, label)?)),
    MenuPredefinedMenuItemSlug::Maximize   => Some(Box::new(PredefinedMenuItem::maximize(app, label)?)),
    // macOS only
    MenuPredefinedMenuItemSlug::About => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::about(app, label, None)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Services => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::services(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Hide => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::hide(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::HideOthers => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::hide_others(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::ShowAll => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::show_all(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Fullscreen => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::fullscreen(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Undo => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::undo(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Redo => {
      #[cfg(target_os = "macos")] { Some(Box::new(PredefinedMenuItem::redo(app, label)?)) }
      #[cfg(not(target_os = "macos"))] { None }
    }
    MenuPredefinedMenuItemSlug::Separator => None, // già gestito sopra
  };
  Ok(out)
}
