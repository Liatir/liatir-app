import { TauriCore, WindowTauri } from "../types";

export function extractCore(source: unknown): TauriCore | null {
  if (!source) return null;
  if (typeof source === "object" && "invoke" in (source as any)) {
    const core = source as TauriCore;
    if (typeof core.invoke === "function") return core;
  }
  if (typeof source === "object" && "core" in (source as any)) {
    const maybe = (source as any).core;
    if (maybe && typeof maybe.invoke === "function") return maybe as TauriCore;
  }
  return null;
}

export const ensureCore = (): Promise<TauriCore> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    (function tick() {
      const core = extractCore((window as any)?.__TAURI__);
      if (core) return resolve(core);
      if (Date.now() > deadline) return reject(new Error("Tauri core.invoke not available"));
      requestAnimationFrame(tick);
    })();
  });

// Universal Proxy for window.__TAURI__ with safety checks
export const windowTauriProxy = new Proxy(
  {} as WindowTauri, {
  get(_target, prop: string | symbol) {
    const propName = String(prop);

    // 1. SSR / ambiente non-browser
    if (typeof window === "undefined") {
      console.warn(`[TAURI PROXY] window is undefined (SSR).`);
      return undefined;
    }

    const tauri = (window as any).__TAURI__;

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
    const createSafeExecutor = (fn: Function, context: any, fnName: string) => {
      return (...args: any[]) => {
        try {
          return fn.apply(context, args);
        } catch (err: any) {
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
        get(nestedTarget, nestedProp: string | symbol) {
          const nestedValue = (nestedTarget as any)[nestedProp];
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
}
) as WindowTauri;
