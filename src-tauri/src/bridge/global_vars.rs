// src/bridge/env.rs

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri::path::BaseDirectory;

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct EnvStore {
    /// Map of "environment-like" variables
    pub vars: HashMap<String, String>,
}

pub struct EnvState {
    /// In-memory store protected by a mutex
    store: Mutex<EnvStore>,
    /// JSON file path on disk
    path: PathBuf,
}

impl EnvState {
    /// Create state loading from disk if the file exists.
    pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Self> {
        // Resolve `env.json` inside the app config directory
        // e.g. $CONFIG_DIR/<bundle_id>/env.json
        let path = app
            .path()
            .resolve("env.json", BaseDirectory::AppConfig)?;

        // Try to load existing data
        let store = if path.exists() {
            let content = fs::read_to_string(&path)
                .unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str::<EnvStore>(&content).unwrap_or_default()
        } else {
            EnvStore::default()
        };

        Ok(Self {
            store: Mutex::new(store),
            path,
        })
    }

    /// Save the current in-memory store to disk.
    fn save(&self, store: &EnvStore) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Err(format!("Failed to create env store directory: {e}"));
            }
        }

        let json = serde_json::to_string_pretty(store)
            .map_err(|e| format!("Failed to serialize env store: {e}"))?;

        fs::write(&self.path, json)
            .map_err(|e| format!("Failed to write env store file: {e}"))
    }

    /// Helper to lock the store and run a closure with mutable access.
    fn with_mut<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut EnvStore) -> Result<T, String>,
    {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| "EnvState mutex poisoned".to_string())?;

        let result = f(&mut guard)?;
        // Persist any change
        self.save(&guard)?;
        Ok(result)
    }

    /// Helper to lock the store for read-only operations.
    fn with<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&EnvStore) -> Result<T, String>,
    {
        let guard = self
            .store
            .lock()
            .map_err(|_| "EnvState mutex poisoned".to_string())?;
        f(&guard)
    }
}

// ------- Commands -------

#[tauri::command]
pub fn dtr_global_vars_get(
    key: String,
    state: State<'_, EnvState>,
) -> Result<Option<String>, String> {
    state.with(|store| {
        Ok(store.vars.get(&key).cloned())
    })
}

#[tauri::command]
pub fn dtr_global_vars_set(
    key: String,
    value: String,
    state: State<'_, EnvState>,
) -> Result<(), String> {
    state.with_mut(|store| {
        store.vars.insert(key, value);
        Ok(())
    })
}

#[tauri::command]
pub fn dtr_global_vars_remove(
    key: String,
    state: State<'_, EnvState>,
) -> Result<bool, String> {
    state.with_mut(|store| {
        Ok(store.vars.remove(&key).is_some())
    })
}

#[tauri::command]
pub fn dtr_global_vars_list(
    state: State<'_, EnvState>,
) -> Result<HashMap<String, String>, String> {
    state.with(|store| {
        // Clone to avoid leaking the internal reference
        Ok(store.vars.clone())
    })
}