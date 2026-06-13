export const tauriGlobalShortcut = () => {
    const g = (window as any).__TAURI__?.globalShortcut;
    if (!g) throw new Error("Global Shortcut plugin not available");
    return g;
  };