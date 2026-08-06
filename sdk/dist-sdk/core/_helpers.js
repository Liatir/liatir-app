"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowTauriProxy = exports.ensureCore = void 0;
exports.extractCore = extractCore;
function extractCore(source) {
    if (!source)
        return null;
    if (typeof source === "object" && "invoke" in source) {
        const core = source;
        if (typeof core.invoke === "function")
            return core;
    }
    if (typeof source === "object" && "core" in source) {
        const maybe = source.core;
        if (maybe && typeof maybe.invoke === "function")
            return maybe;
    }
    return null;
}
const ensureCore = () => new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    (function tick() {
        const core = extractCore(window?.__TAURI__);
        if (core)
            return resolve(core);
        if (Date.now() > deadline)
            return reject(new Error("Tauri core.invoke not available"));
        requestAnimationFrame(tick);
    })();
});
exports.ensureCore = ensureCore;
// Universal Proxy for window.__TAURI__ with safety checks
exports.windowTauriProxy = new Proxy({}, {
    get(_target, prop) {
        const propName = String(prop);
        // 1. SSR / ambiente non-browser
        if (typeof window === "undefined") {
            console.warn(`[TAURI PROXY] window is undefined (SSR).`);
            return undefined;
        }
        const tauri = window.__TAURI__;
        // 2. Tauri is not available.
        if (!tauri) {
            console.warn(`[TAURI PROXY] window.__TAURI__ missing.`);
            return undefined;
        }
        const value = tauri[propName];
        // 3. Missing property.
        if (value === undefined) {
            // Keep the proxy quiet for feature checks such as "if (proxy.mocks)".
            // console.warn(`[TAURI PROXY] '${propName}' not found.`);
            return undefined;
        }
        // Safe executor reused for both root-level and nested Tauri functions.
        const createSafeExecutor = (fn, context, fnName) => {
            return (...args) => {
                try {
                    return fn.apply(context, args);
                }
                catch (err) {
                    console.error(`[TAURI PROXY] Error calling '${fnName}':`, err);
                    if (typeof err?.message === "string" && err.message.includes("not allowed")) {
                        console.warn(`[TAURI PROXY] Permission missing for '${fnName}'. Check capabilities.`);
                    }
                    throw err;
                }
            };
        };
        // 4. Root-level function.
        if (typeof value === "function") {
            return createSafeExecutor(value, tauri, propName);
        }
        // 5. Nested object, such as "core", "event", or "window".
        // Return a proxy so nested functions such as core.invoke are protected too.
        if (typeof value === "object" && value !== null) {
            return new Proxy(value, {
                get(nestedTarget, nestedProp) {
                    const nestedValue = nestedTarget[nestedProp];
                    const nestedName = `${propName}.${String(nestedProp)}`;
                    // Protect nested functions, for example core.invoke.
                    if (typeof nestedValue === "function") {
                        return createSafeExecutor(nestedValue, nestedTarget, nestedName);
                    }
                    // Return primitive values and shallow nested objects as-is. Tauri v2
                    // APIs used here are normally only one level deep.
                    return nestedValue;
                }
            });
        }
        // 6. Primitive value.
        return value;
    }
});
