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
        // 2. Tauri non disponibile
        if (!tauri) {
            console.warn(`[TAURI PROXY] window.__TAURI__ missing.`);
            return undefined;
        }
        const value = tauri[propName];
        // 3. Proprietà non esistente
        if (value === undefined) {
            // Opzionale: Rimuovi il warn se ti dà fastidio per controlli tipo 'if (proxy.mocks)'
            // console.warn(`[TAURI PROXY] '${propName}' not found.`);
            return undefined;
        }
        // --- FUNZIONE DI SUPPORTO PER ESECUZIONE SICURA ---
        // La definiamo qui per riusarla sia sul livello base che su quelli annidati
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
        // 4. Se è una FUNZIONE (es. nel caso ci siano funzioni alla radice)
        if (typeof value === "function") {
            return createSafeExecutor(value, tauri, propName);
        }
        // 5. [NUOVO] Se è un OGGETTO (es. 'core', 'event', 'window')
        // Dobbiamo restituire un Proxy anche per questo oggetto, altrimenti
        // le funzioni al suo interno (es. core.invoke) non saranno protette!
        if (typeof value === "object" && value !== null) {
            return new Proxy(value, {
                get(nestedTarget, nestedProp) {
                    const nestedValue = nestedTarget[nestedProp];
                    const nestedName = `${propName}.${String(nestedProp)}`;
                    // Se troviamo una funzione dentro l'oggetto annidato (es. invoke dentro core)
                    if (typeof nestedValue === "function") {
                        return createSafeExecutor(nestedValue, nestedTarget, nestedName);
                    }
                    // Ritorna il valore (potresti dover fare ricorsione infinita qui se 
                    // hai oggetti dentro oggetti dentro oggetti, ma per Tauri V2 basta 1 livello solitamente)
                    return nestedValue;
                }
            });
        }
        // 6. Ritorna il valore primitivo (stringhe, numeri, boolean)
        return value;
    }
});
