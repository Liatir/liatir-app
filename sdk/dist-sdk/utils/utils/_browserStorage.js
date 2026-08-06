"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserStorage = browserStorage;
const _logger_1 = require("./_logger");
const _isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
function browserStorage(type, namespace) {
    const _storage = _isBrowser
        ? type === "local"
            ? localStorage
            : sessionStorage
        : undefined;
    const _prefix = namespace ? `${namespace}:` : "";
    function _fullKey(key) {
        return `${_prefix}${key}`;
    }
    function getItem(key) {
        if (!_isBrowser)
            return null;
        const raw = _storage?.getItem(_fullKey(key));
        if (!raw)
            return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
                _storage?.removeItem(_fullKey(key));
                return null;
            }
            return parsed.value;
        }
        catch {
            return null;
        }
    }
    function getNamespaceItems() {
        if (!_isBrowser)
            return [];
        const items = [];
        for (let i = 0; i < (_storage?.length ?? 0); i++) {
            const fullKey = _storage?.key(i);
            if (!fullKey || (_prefix && !fullKey.startsWith(_prefix)))
                continue;
            const key = fullKey.slice(_prefix.length); // rimuove il namespace
            const raw = _storage?.getItem(fullKey);
            if (!raw)
                continue;
            try {
                const parsed = JSON.parse(raw);
                if (parsed.expiresAt && Date.now() > parsed.expiresAt)
                    continue;
                items.push({ key, value: parsed.value });
            }
            catch {
                // ignora valori corrotti
            }
        }
        return items;
    }
    function getItemsByKeys(keys) {
        if (!_isBrowser)
            return [];
        const items = [];
        for (const key of keys) {
            const fullKey = _fullKey(key);
            const raw = _storage?.getItem(fullKey);
            if (!raw)
                continue;
            try {
                const parsed = JSON.parse(raw);
                if (parsed.expiresAt && Date.now() > parsed.expiresAt)
                    continue;
                items.push({ key, value: parsed.value });
            }
            catch {
                // ignora valori corrotti
            }
        }
        return items;
    }
    function setItem(key, value, options) {
        if (!_isBrowser)
            return;
        const expiresAt = options?.expiresIn
            ? Date.now() + options.expiresIn * 1000
            : undefined;
        const payload = { value, expiresAt };
        try {
            _storage?.setItem(_fullKey(key), JSON.stringify(payload));
        }
        catch (err) {
            _logger_1.logger.warn(`[browserStorage] Failed to set key "${key}"`, err);
        }
    }
    function removeItem(key) {
        if (!_isBrowser)
            return;
        _storage?.removeItem(_fullKey(key));
    }
    function clear() {
        if (!_isBrowser)
            return;
        keysList().forEach((key) => _storage?.removeItem(key));
    }
    function clearExpired() {
        if (!_isBrowser)
            return;
        keysList().forEach((key) => {
            const raw = _storage?.getItem(key);
            if (!raw)
                return;
            try {
                const parsed = JSON.parse(raw);
                if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
                    _storage?.removeItem(key);
                }
            }
            catch {
                // ignore
            }
        });
    }
    function length() {
        if (!_isBrowser)
            return 0;
        return keysList().length;
    }
    function keysList() {
        if (!_isBrowser)
            return [];
        const keys = [];
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
