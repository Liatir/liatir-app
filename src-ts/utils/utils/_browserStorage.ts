import {logger} from "./_logger";

export type BrowserStorageType = "local" | "session";

interface _StoredValue {
  value: unknown;
  expiresAt?: number;
}

interface _BrowserStorageAPI {
  getItem(key: string): unknown | null;
  getNamespaceItems(): { key: string; value: unknown }[];
  getItemsByKeys(keys: string[]): { key: string; value: unknown }[];
  setItem(key: string, value: unknown, options?: { expiresIn?: number }): void;
  removeItem(key: string): void;
  clear(): void;
  clearExpired(): void;
  length(): number;
  keysList(): string[];
}

const _isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

export function browserStorage(
  type: BrowserStorageType,
  namespace?: string
): _BrowserStorageAPI {
  const _storage = _isBrowser
    ? type === "local"
      ? localStorage
      : sessionStorage
    : undefined;

  const _prefix = namespace ? `${namespace}:` : "";

  function _fullKey(key: string): string {
    return `${_prefix}${key}`;
  }

  function getItem(key: string): unknown | null {
    if (!_isBrowser) return null;

    const raw = _storage?.getItem(_fullKey(key));
    if (!raw) return null;

    try {
      const parsed: _StoredValue = JSON.parse(raw);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        _storage?.removeItem(_fullKey(key));
        return null;
      }
      return parsed.value;
    } catch {
      return null;
    }
  }

function getNamespaceItems(): { key: string; value: unknown }[] {
  if (!_isBrowser) return [];

  const items: { key: string; value: unknown }[] = [];

  for (let i = 0; i < (_storage?.length ?? 0); i++) {
    const fullKey = _storage?.key(i);
    if (!fullKey || (_prefix && !fullKey.startsWith(_prefix))) continue;

    const key = fullKey.slice(_prefix.length); // rimuove il namespace
    const raw = _storage?.getItem(fullKey);
    if (!raw) continue;

    try {
      const parsed: _StoredValue = JSON.parse(raw);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) continue;

      items.push({ key, value: parsed.value });
    } catch {
      // ignora valori corrotti
    }
  }

  return items;
}

function getItemsByKeys(keys: string[]): { key: string; value: unknown }[] {
  if (!_isBrowser) return [];

  const items: { key: string; value: unknown }[] = [];

  for (const key of keys) {
    const fullKey = _fullKey(key);
    const raw = _storage?.getItem(fullKey);
    if (!raw) continue;

    try {
      const parsed: _StoredValue = JSON.parse(raw);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) continue;

      items.push({ key, value: parsed.value });
    } catch {
      // ignora valori corrotti
    }
  }

  return items;
}


  function setItem(
    key: string,
    value: unknown,
    options?: { expiresIn?: number }
  ): void {
    if (!_isBrowser) return;

    const expiresAt = options?.expiresIn
      ? Date.now() + options.expiresIn * 1000
      : undefined;

    const payload: _StoredValue = { value, expiresAt };

    try {
      _storage?.setItem(_fullKey(key), JSON.stringify(payload));
    } catch (err) {
      logger.warn(`[browserStorage] Failed to set key "${key}"`, err);
    }
  }

  function removeItem(key: string): void {
    if (!_isBrowser) return;
    _storage?.removeItem(_fullKey(key));
  }

  function clear(): void {
    if (!_isBrowser) return;
    keysList().forEach((key) => _storage?.removeItem(key));
  }

  function clearExpired(): void {
    if (!_isBrowser) return;
    keysList().forEach((key) => {
      const raw = _storage?.getItem(key);
      if (!raw) return;
      try {
        const parsed: _StoredValue = JSON.parse(raw);
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          _storage?.removeItem(key);
        }
      } catch {
        // ignore
      }
    });
  }

  function length(): number {
    if (!_isBrowser) return 0;
    return keysList().length;
  }

  function keysList(): string[] {
    if (!_isBrowser) return [];
    const keys: string[] = [];
    for (let i = 0; i < (_storage?.length ?? 0); i++) {
      const key = _storage?.key(i);
      if (key && (!_prefix || key.startsWith(_prefix))) {
        keys.push(key);
      }
    }
    return keys;
  }

  return {
    getItem,
    getNamespaceItems,
    getItemsByKeys,
    setItem,
    removeItem,
    clear,
    clearExpired,
    length,
    keysList,
  };
}
