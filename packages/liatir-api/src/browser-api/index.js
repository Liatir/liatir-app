// src-ts/core/_helpers.ts
function extractCore(source) {
  if (!source) return null;
  if (typeof source === "object" && "invoke" in source) {
    const core = source;
    if (typeof core.invoke === "function") return core;
  }
  if (typeof source === "object" && "core" in source) {
    const maybe = source.core;
    if (maybe && typeof maybe.invoke === "function") return maybe;
  }
  return null;
}
var ensureCore = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 1e4;
  (function tick() {
    const core = extractCore(window?.__TAURI__);
    if (core) return resolve(core);
    if (Date.now() > deadline) return reject(new Error("Tauri core.invoke not available"));
    requestAnimationFrame(tick);
  })();
});
var windowTauriProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const propName = String(prop);
      if (typeof window === "undefined") {
        console.warn(`[TAURI PROXY] window is undefined (SSR).`);
        return void 0;
      }
      const tauri = window.__TAURI__;
      if (!tauri) {
        console.warn(`[TAURI PROXY] window.__TAURI__ missing.`);
        return void 0;
      }
      const value = tauri[propName];
      if (value === void 0) {
        return void 0;
      }
      const createSafeExecutor = (fn, context, fnName) => {
        return (...args) => {
          try {
            return fn.apply(context, args);
          } catch (err) {
            console.error(`[TAURI PROXY] Error calling '${fnName}':`, err);
            if (typeof err?.message === "string" && err.message.includes("not allowed")) {
              console.warn(`[TAURI PROXY] Permission missing for '${fnName}'. Check capabilities.`);
            }
            throw err;
          }
        };
      };
      if (typeof value === "function") {
        return createSafeExecutor(value, tauri, propName);
      }
      if (typeof value === "object" && value !== null) {
        return new Proxy(value, {
          get(nestedTarget, nestedProp) {
            const nestedValue = nestedTarget[nestedProp];
            const nestedName = `${propName}.${String(nestedProp)}`;
            if (typeof nestedValue === "function") {
              return createSafeExecutor(nestedValue, nestedTarget, nestedName);
            }
            return nestedValue;
          }
        });
      }
      return value;
    }
  }
);

// src-ts/utils/utils/_pageStore.ts
function pageStore() {
  let listeners = [];
  function getPage() {
    const url = new URL(window.location.href);
    return {
      url,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      origin: url.origin,
      pathname: url.pathname,
      fullPath: url.pathname + url.search + url.hash,
      query: Object.fromEntries(url.searchParams.entries()),
      search: url.search,
      hash: url.hash,
      params: {},
      // da riempire se implementi parsing tipo /user/:id
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    };
  }
  function notify() {
    const page = getPage();
    for (const cb of listeners) cb(page);
  }
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function(...args) {
      original.apply(this, args);
      notify();
    };
  }
  return {
    subscribe(callback) {
      listeners.push(callback);
      callback(getPage());
      return () => {
        listeners = listeners.filter((cb) => cb !== callback);
      };
    },
    get: getPage
  };
}

// src-ts/utils/utils/_logger.ts
var noop = () => {
};
var dev = () => {
  try {
    return isDev();
  } catch {
    return false;
  }
};
var logger = {
  log: dev() ? console.log.bind(console) : noop,
  warn: dev() ? console.warn.bind(console) : noop,
  error: console.error.bind(console),
  // always logs
  devError: dev() ? console.error.bind(console) : noop,
  logCaller: dev() ? (...args) => {
    const name = callerName(3);
    console.log(`${name}()`, ...args);
  } : noop,
  page: dev() ? () => {
    console.log("Page:", pageStore().get());
  } : noop,
  prod: {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    logCaller: (...args) => {
      const name = callerName(3);
      console.log(`${name}()`, ...args);
    },
    page: () => {
      console.log("Page:", pageStore().get());
    }
  }
};

// src-ts/utils/utils/_typesValidation.ts
function validateUrl(input) {
  if (typeof input !== "string") return false;
  const s = input.trim();
  if (s.length === 0) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
function isValidDateString(value) {
  if (typeof value !== "string") return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}
function isValidDateObject(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
var ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
var ISO_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+\-](?:[01]\d|2[0-3]):?[0-5]\d)$/;
function isIsoDateString(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isIsoDateTimeString(value) {
  if (typeof value !== "string" || !ISO_DATETIME_RE.test(value)) return false;
  const dt = new Date(value);
  return !Number.isNaN(dt.getTime());
}
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
var IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
var IPV6_RE = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(([0-9A-Fa-f]{1,4}:){1,7}:)|(([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2})|(([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3})|(([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4})|(([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5})|([0-9A-Fa-f]{1,4}:((:[0-9A-Fa-f]{1,4}){1,6}))|(:((:[0-9A-Fa-f]{1,4}){1,7}|:)))(%[0-9A-Za-z]{1,})?$/;
var validate = {
  // base
  string: (v) => typeof v === "string",
  url: (v) => typeof v === "string" && validateUrl(v),
  nonEmptyString: (v) => typeof v === "string" && v.trim().length > 0,
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  bigint: (v) => typeof v === "bigint",
  symbol: (v) => typeof v === "symbol",
  numeric: (v) => typeof v === "number" ? !Number.isNaN(v) : !Number.isNaN(Number(v)),
  finiteNumber: (v) => typeof v === "number" && Number.isFinite(v),
  // date
  dateString: (v) => typeof v === "string" && isValidDateString(v),
  date: (v) => isValidDateObject(v),
  isoDateString: (v) => typeof v === "string" && isIsoDateString(v),
  isoDateTimeString: (v) => typeof v === "string" && isIsoDateTimeString(v),
  // null/undefined
  null: (v) => v === null,
  undefined: (v) => typeof v === "undefined",
  defined: (v) => v !== null && v !== void 0,
  nan: (v) => typeof v === "number" && Number.isNaN(v),
  // oggetti/collezioni
  object: (v) => v !== null && typeof v === "object",
  plainObject: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  },
  emptyObject: (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0,
  array: (v) => Array.isArray(v),
  nonEmptyArray: (v) => Array.isArray(v) && v.length > 0,
  set: (v) => v instanceof Set,
  map: (v) => v instanceof Map,
  weakSet: (v) => v instanceof WeakSet,
  weakMap: (v) => v instanceof WeakMap,
  // binari / typed arrays
  arrayBuffer: (v) => v instanceof ArrayBuffer,
  dataView: (v) => v instanceof DataView,
  typedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  // regex / promise / function
  regexp: (v) => v instanceof RegExp,
  promise: (v) => !!v && typeof v.then === "function",
  function: (v) => typeof v === "function",
  asyncFunction: (v) => typeof v === "function" && v.constructor?.name === "AsyncFunction",
  generatorFunction: (v) => typeof v === "function" && v.constructor?.name === "GeneratorFunction",
  // stringhe con pattern
  email: (v) => typeof v === "string" && EMAIL_RE.test(v),
  uuid: (v) => typeof v === "string" && UUID_RE.test(v),
  hexColor: (v) => typeof v === "string" && HEX_COLOR_RE.test(v),
  ipv4: (v) => typeof v === "string" && IPV4_RE.test(v),
  ipv6: (v) => typeof v === "string" && IPV6_RE.test(v),
  jsonString: (v) => {
    if (typeof v !== "string") return false;
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  },
  // truthiness
  truthy: (v) => !!v,
  falsy: (v) => !v
};

// src-ts/utils/utils/_utils.ts
var isDev = () => {
  const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const nodeEnv = process?.env?.NODE_ENV;
  return nodeEnv !== "production" || isLocalhost;
};
function callerName(level = 2) {
  const err = new Error();
  const stack = err.stack?.split("\n");
  if (stack && stack.length > level) {
    const match = stack[level].trim().match(/^at\s+([^\s(]+)/);
    return match?.[1] || "<anonymous>";
  }
  return "<unknown>";
}
var wait = (timeout = 100, callback) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      callback?.();
      resolve();
    }, timeout);
  });
};

// src-ts/utils/utils/_integerUtils.ts
function isIntegerInRange(v, min, max) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function isF32Runtime(v) {
  return typeof v === "number" && Math.fround(v) === v;
}
var Pred = {
  // Unsigned
  isU8: (v) => isIntegerInRange(v, 0, 255),
  isU16: (v) => isIntegerInRange(v, 0, 65535),
  isU32: (v) => isIntegerInRange(v, 0, 4294967295),
  isU64: (v) => isIntegerInRange(v, 0, Number.MAX_SAFE_INTEGER),
  // Signed
  isI8: (v) => isIntegerInRange(v, -128, 127),
  isI16: (v) => isIntegerInRange(v, -32768, 32767),
  isI32: (v) => isIntegerInRange(v, -2147483648, 2147483647),
  isI64: (v) => typeof v === "number" && Number.isInteger(v) && v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER,
  // Floats
  isF32: (v) => isF32Runtime(v),
  isF64: (v) => typeof v === "number"
};
function makeRefinement(tag, isFn) {
  return {
    is: (v) => isFn(v),
    as: (v) => {
      if (!isFn(v)) throw new TypeError(`Expected ${tag}, got ${String(v)}`);
      return v;
    },
    try: (v) => isFn(v) ? v : null,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !isFn(n)) {
        throw new TypeError(`Invalid ${tag} from "${s}"`);
      }
      return n;
    }
  };
}
var Num = {
  // Predicates (stile number.is...)
  isU8: Pred.isU8,
  isU16: Pred.isU16,
  isU32: Pred.isU32,
  isU64: Pred.isU64,
  isI8: Pred.isI8,
  isI16: Pred.isI16,
  isI32: Pred.isI32,
  isI64: Pred.isI64,
  isF32: Pred.isF32,
  isF64: Pred.isF64,
  // Branded constructors / refiners
  U8: makeRefinement("u8", Pred.isU8),
  U16: makeRefinement("u16", Pred.isU16),
  U32: makeRefinement("u32", Pred.isU32),
  U64: makeRefinement("u64", Pred.isU64),
  I8: makeRefinement("i8", Pred.isI8),
  I16: makeRefinement("i16", Pred.isI16),
  I32: makeRefinement("i32", Pred.isI32),
  I64: makeRefinement("i64", Pred.isI64),
  F32: makeRefinement("f32", Pred.isF32),
  F64: makeRefinement("f64", Pred.isF64)
};

// src-ts/utils/utils/_json.ts
import Ajv from "ajv";
import addFormats from "ajv-formats";
var ajv = new Ajv({
  allErrors: true,
  // richer error messages
  strict: false
  // plays nice with draft-07 and relaxed schemas
});
addFormats(ajv);

// src-ts/liatir/_helpers.ts
var normalizeString = (str, options = {
  toLowerCase: true,
  spacesFiller: ""
}) => {
  if (!validate.nonEmptyString(str)) return "";
  let normalized = "";
  if (options.toLowerCase)
    normalized = String(str).toLowerCase().trim().replace(/\s+/g, options.spacesFiller);
  else normalized = String(str).trim().replace(/\s+/g, options.spacesFiller);
  return normalized;
};
var platformSpecifcFilter = async (platforms) => {
  const appInfo = await window.Liatir?.desktop.app.info();
  if (!appInfo) throw "Failed to check platform";
  const plat = appInfo.os;
  if (!platforms.includes(plat))
    throw `[unsupported platform] this method is not supported on ${plat}`;
};
var getAppVersion = async () => {
  const liatir = window?.Liatir;
  if (!liatir) throw "[getAppVersion] Liatir is not available";
  const appInfo = await liatir.desktop.app.info();
  const version = appInfo.version;
  return version ?? "";
};

// src-ts/modules/rs/events/_helpers.ts
var listenForEvent = async (event, handler) => {
  const tauri = window.__TAURI__;
  const eventApi = tauri?.event;
  if (!eventApi?.listen) throw new Error("Tauri event API not available");
  const unlisten = await eventApi.listen(event, (e) => {
    handler(e?.payload);
  });
  return unlisten;
};

// src-ts/modules/rs/shortcuts/_helpers.ts
var tauriGlobalShortcut = () => {
  const g = window.__TAURI__?.globalShortcut;
  if (!g) throw new Error("Global Shortcut plugin not available");
  return g;
};

// src-ts/sdk/_proxy.ts
function getWindow() {
  if (typeof window === "undefined") {
    throw new Error("[Liatir] window is not defined. Are you running in SSR?");
  }
  return window;
}
function getGlobalBridge() {
  const w = getWindow();
  const bridge = w.Liatir;
  if (!bridge) {
    console.error(
      "[Liatir] window.Liatir is not available. Is the desktop wrapper loaded?"
    );
    return;
  }
  return bridge;
}
var Liatir = new Proxy({}, {
  get(_target, prop, _receiver) {
    const bridge = getGlobalBridge() ?? void 0;
    const value = bridge[prop];
    if (typeof value === "function") {
      return value.bind(bridge);
    }
    return value;
  },
  set(_target, prop, value) {
    const bridge = getGlobalBridge() ?? void 0;
    bridge[prop] = value;
    return true;
  }
});

// src-ts/bridge.constants.json
var bridge_constants_default = {
  appUrl: "http://blank.html",
  apiVersion: "0.2.1"
};

// src-ts/constants.ts
var APP_URL = bridge_constants_default.appUrl;
var API_VERSION = bridge_constants_default.apiVersion;
var READY_EVENT_NAME = "liaReady";
var WINDOWS_LABELS_TRACKER_VARIABLE_NAME = "open-windows-labels-tracker-rpkw6kjzxn8bfhj5u74q";
var BROWSER_STORAGE_NAMESPACE = "lia_xam8wknpz1vf";

// src-ts/modules/rs/window/_helpers.ts
var newWindow = async (core, options) => {
  if (options?.label) {
    if (options.label.trim().toLowerCase().startsWith("main")) throw new Error(`[Reserved window label] 'main' is an app reserved label`);
  }
  const randomWindowLabel = `w_${Math.random().toString(36).substring(2, 2 + 8)}`;
  const labelToSet = options?.label ?? randomWindowLabel;
  try {
    const usedLabelsJSON = await Liatir.desktop.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
    let usedLabelsObj = await JSON.parse(usedLabelsJSON);
    usedLabelsObj[labelToSet] = true;
    const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
    await Liatir.desktop.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }
  core.invoke("lia_win_open", {
    label: labelToSet,
    fullscreen: options?.fullscreen || false,
    url: options?.url ?? ""
  });
};
var closeWindow = async (core, label) => {
  const trimmedLabel = label?.trim() ?? "";
  const _label = trimmedLabel ?? "main";
  try {
    if (trimmedLabel) {
      const usedLabelsJSON = await Liatir.desktop.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
      let usedLabelsObj = await JSON.parse(usedLabelsJSON);
      delete usedLabelsObj[trimmedLabel];
      const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
      await Liatir.desktop.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
    }
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }
  core.invoke("lia_win_close", { label: _label });
};

// src-ts/modules/rs/menu/_helpers.ts
function isMacOS() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return true;
}
var initMenuConfig = async (core, menuConfig, windowLabel) => {
  validateMenuConfig(menuConfig);
  if (windowLabel) {
    if (isMacOS()) {
      console.warn(
        "[Liatir] Native window-specific menus are not supported on macOS."
      );
      return;
    }
    await core.invoke("lia_init_menu_for_window_from_json", {
      windowLabel,
      cfgJson: menuConfig
    });
  } else {
    await core.invoke("lia_init_menu_from_json", {
      cfgJson: menuConfig
    });
  }
};
function validateMenuConfig(config) {
  _validateMenuConfig(config);
}
function _validateMenuConfig(config) {
  if (typeof config !== "object" || config === null)
    throw new Error("Menu config must be an object.");
  if (validate.emptyObject(config))
    throw new Error(`Menu config is an empty object:

${config}`);
  if (typeof config.enabled !== "boolean")
    throw new Error("Missing or invalid 'enabled' (boolean required).");
  if (!Array.isArray(config.platforms))
    throw new Error("Missing or invalid 'platforms' (array required).");
  for (const p of config.platforms) {
    if (!["macos", "windows", "linux"].includes(p))
      throw new Error(`Invalid platform '${p}'.`);
  }
  const validSections = ["macosRoot", "file", "edit", "view", "window", "tray"];
  for (const key of validSections) {
    if (config[key]) {
      validateSection(config[key], key);
    }
  }
}
function validateSection(section, name) {
  if (typeof section !== "object" || section === null)
    throw new Error(`Section '${name}' must be an object.`);
  if (!Array.isArray(section.items))
    throw new Error(`Section '${name}' missing or invalid 'items' array.`);
  validateItems(section.items, `${name}.items`);
}
function validateItems(items, path) {
  if (!Array.isArray(items)) throw new Error(`${path} must be an array.`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const loc = `${path}[${i}]`;
    if (typeof item !== "object" || item === null)
      throw new Error(`${loc} must be an object.`);
    const type = item.type;
    if (typeof type !== "string")
      throw new Error(`${loc} missing 'type' field.`);
    switch (type) {
      case "custom": {
        if (typeof item.id !== "string")
          throw new Error(`${loc} missing 'id' (string).`);
        if (typeof item.label !== "string")
          throw new Error(`${loc} missing 'label' (string).`);
        if (item.enabled !== void 0 && typeof item.enabled !== "boolean")
          throw new Error(`${loc} invalid 'enabled' type (boolean expected).`);
        if (item.interaction !== void 0 && !["click", "check"].includes(item.interaction))
          throw new Error(`${loc} invalid 'interaction' value.`);
        if (item.interaction === "check" && item.checked !== void 0 && typeof item.checked !== "boolean")
          throw new Error(
            `${loc} invalid 'checked' for checkable item (boolean expected).`
          );
        if (item.accelerator !== void 0 && typeof item.accelerator !== "string")
          throw new Error(
            `${loc} invalid 'accelerator' type (string expected).`
          );
        break;
      }
      case "submenu": {
        if (typeof item.label !== "string")
          throw new Error(`${loc} submenu missing 'label' (string).`);
        if (!Array.isArray(item.items))
          throw new Error(`${loc} submenu missing 'items' array.`);
        for (const sub of item.items) {
          if (sub.type === "submenu") {
            throw new Error(
              `${loc} submenu contains another submenu \u2014 only one level of depth allowed.`
            );
          }
        }
        break;
      }
      case "predefined": {
        if (typeof item.item !== "string")
          throw new Error(`${loc} predefined item missing 'item' field.`);
        if (item.customLabel !== void 0 && typeof item.customLabel !== "string")
          throw new Error(
            `${loc} invalid 'customLabel' type (string expected).`
          );
        break;
      }
      case "separator":
        break;
      default:
        throw new Error(`${loc} has unknown type '${type}'.`);
    }
  }
}

// src-ts/modules/rs/diagnostics/_helpers.ts
var diagnosticsSettings = async (core, settings) => {
  const s = settings;
  const retDaysAnalytics = s?.retentionDaysAnalytics ?? s?.retention_days_analytics;
  const retDaysLogs = s?.retentionDaysLogs ?? s?.retention_days_logs;
  const retDaysCrashes = s?.retentionDaysCrashes ?? s?.retention_days_crashes;
  if (retDaysAnalytics != null && !Num.isU32(retDaysAnalytics)) throw "[retentionDaysAnalytics] the value must be a U32 integer number";
  if (retDaysLogs != null && !Num.isU32(retDaysLogs)) throw "[retentionDaysLogs] the value must be a U32 integer number";
  if (retDaysCrashes != null && !Num.isU32(retDaysCrashes)) throw "[retentionDaysCrashes] the value must be a U32 integer number";
  return await core.invoke("lia_logs_set_privacy", {
    patch: {
      analytics_enabled: s?.analyticsEnabled ?? s?.analytics_enabled,
      crash_reports_enabled: s?.crashReportsEnabled ?? s?.crash_reports_enabled,
      retention_days_analytics: retDaysAnalytics,
      retention_days_logs: retDaysLogs,
      retention_days_crashes: retDaysCrashes
    }
  });
};
var deriveAppVersion = async (v) => {
  if (v) return v;
  const version = await getAppVersion();
  return version;
};
function buildDiagnosticsTestFunctions(core) {
  return {
    testGenerateRecords: (n = 200) => core.invoke("lia_logs_test_record_n", { n }),
    // This can throw a JS error directly; no invoke call is needed.
    testThrowJsError: async () => {
      throw new Error("DEV: test JS error");
    },
    testPanicRust: () => core.invoke("lia_logs_test_panic", {}),
    testExportZip: () => core.invoke("lia_logs_export_zip", {}),
    testForceRetention: (area) => core.invoke("lia_logs_test_force_retention", { area })
  };
}

// src-ts/modules/rs/worker/_helpers.ts
var normalizeModuleName = (name) => {
  const sanitizeWasmExtensions = name.replaceAll(".wasm", "");
  const addWasmExtensions = `${sanitizeWasmExtensions}.wasm`;
  return addWasmExtensions;
};

// src-ts/modules/rs/contextMenu/_helpers.ts
var CM_TYPES = [
  "item",
  "check",
  "separator",
  "submenu",
  "predefined"
];
function isCmType(value) {
  return typeof value === "string" && CM_TYPES.includes(value);
}
function parseCmType(value) {
  if (!validate.nonEmptyString(value)) return null;
  const normalized = normalizeString(value);
  return isCmType(normalized) ? normalized : null;
}
function normalizeEntries(entries) {
  const out = [];
  for (const entry of entries) {
    const t = parseCmType(entry?.type);
    if (!t) continue;
    out.push({ ...entry, type: t });
  }
  return out;
}
var onCmClick = (ev, callback, preventDefault = true) => {
  try {
    if (preventDefault) ev.preventDefault();
    const target = ev.target;
    const ancestorActionable = target?.closest("[data-lia-contextmenu]") ?? null;
    const descendantActionable = target?.querySelector("[data-lia-contextmenu]") ?? null;
    const info = {
      targetTag: target?.tagName ?? null,
      targetId: target?.id ?? null,
      targetClasses: target?.className ?? null,
      ancestorActionable,
      descendantActionable,
      // coordinate
      pageX: ev.pageX,
      // rispetto al documento (scorrimento incluso)
      pageY: ev.pageY,
      clientX: ev.clientX,
      // rispetto alla viewport
      clientY: ev.clientY,
      screenX: ev.screenX,
      // coordinate dello schermo
      screenY: ev.screenY,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      metaKey: ev.metaKey
    };
    if (!window?.Liatir)
      throw new Error("[contextmenu listener] Liatir not found");
    window.Liatir.desktop.events.emit("cm:click", info);
    const callbackPlayload = {
      event: ev,
      ...info
    };
    if (callback) callback(callbackPlayload);
  } catch (error) {
    console.error(error);
  }
};
var initContextMenuListener = (callback, preventDefault = true) => {
  if (!window?.Liatir)
    throw new Error("[contextmenu listener] Liatir not found");
  const listening = window.Liatir.desktop.contextMenu.listening;
  if (listening) return console.warn("[contextmenu listener] already initialized");
  const listener = (ev) => onCmClick(ev, callback, preventDefault);
  window.Liatir.desktop.contextMenu.listener = listener;
  document.addEventListener("contextmenu", listener);
  window.Liatir.desktop.contextMenu.listening = true;
};
var removeContextMenuListener = () => {
  if (!window?.Liatir) throw new Error("[contextmenu listener] Liatir not found");
  const listening = window.Liatir.desktop.contextMenu.listening;
  if (!listening) return;
  const listener = window.Liatir.desktop.contextMenu.listener ?? (() => {
  });
  document.removeEventListener("contextmenu", listener);
  window.Liatir.desktop.contextMenu.listening = false;
  window.Liatir.desktop.contextMenu.listener = void 0;
};

// src-ts/helpers.ts
var tauriReadyCheck = () => typeof window !== "undefined" && window.__TAURI__ && window.Liatir;
var waitTauri = async () => {
  const interval = 500;
  let counter = 0;
  while (counter <= 3e4 && !tauriReadyCheck()) {
    await wait(interval);
    counter = counter + interval;
  }
};
function isTauri() {
  if (typeof window !== "undefined" && (typeof window.__TAURI__ !== "undefined" || typeof window.__TAURI_INTERNALS__ !== "undefined")) return true;
  else return false;
}

// src-ts/core/_main.ts
function buildCore() {
  return {
    get ready() {
      return ensureCore().then(() => true);
    },
    async invoke(cmd, payload) {
      const core = await ensureCore();
      return core.invoke(cmd, payload);
    }
  };
}

// src-ts/liatir/_main.ts
var LiatirInstance = {
  ready: () => {
    if (!window?.Liatir) return false;
    return true;
  },
  get: () => {
    if (!LiatirInstance.ready()) throw "'window.Liatir' not found";
    return window?.Liatir;
  }
};
var liaInitiators = async () => {
  try {
    if (!LiatirInstance.ready()) throw "Liatir instance not found";
    console.log("## READY ##");
    const eventReady = new CustomEvent(READY_EVENT_NAME);
    window?.dispatchEvent(eventReady);
  } catch (error) {
    console.error(error);
  }
};
var liaReadyEventListener = (callback) => window.addEventListener(READY_EVENT_NAME, () => callback());

// src-ts/modules/rs/files/_main.ts
function buildFiles(core) {
  return {
    open: (options) => core.invoke("lia_file_open", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
    openWithBytes: (options) => core.invoke("lia_file_open_with_bytes", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
    save: (defaultName) => core.invoke("lia_file_save", { defaultName: defaultName ?? null })
  };
}

// src-ts/modules/rs/events/_main.ts
function buildEvents(core) {
  return {
    emit: (event, payload) => core.invoke("lia_event_emit_to_current_window", { event, payload }),
    emitToAll: (event, payload) => core.invoke("lia_event_emit", { event, payload }),
    emitTo: (windowLabel, event, payload) => core.invoke("lia_event_emit_to", { windowLabel, event, payload }),
    on: async (event, handler) => listenForEvent(event, handler),
    once: (event) => new Promise(async (resolve) => {
      const off = await listenForEvent(event, (p) => {
        off();
        resolve(p);
      });
    }),
    onMany: async (events, handler) => {
      const offs = await Promise.all(events.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },
    onNetworkStatus: async (handler) => listenForEvent("network:status", handler),
    onDeeplink: async (handler) => listenForEvent("deeplink", handler),
    onShortcut: async (handler) => listenForEvent("shortcut:event", handler),
    onDragDrop: async (handler, options) => {
      const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
      if (options?.includeHover) evs.push("dragdrop:hover");
      const offs = await Promise.all(evs.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },
    onMenuEvent: async (handler) => listenForEvent("menu:event", handler),
    onTrayIconEvent: async (handler) => listenForEvent("tray:icon", handler)
  };
}

// src-ts/modules/rs/plugins/_helpers.ts
var normalizePluginName = (name) => {
  const sanitizeWasmExtensions = name.replaceAll(".wasm", "");
  const addWasmExtensions = `${sanitizeWasmExtensions}.wasm`;
  return addWasmExtensions;
};

// src-ts/modules/rs/fs/_main.ts
function scopeCoreMethods(core, permanent, plugin) {
  const ensureDataNotIsolated = () => {
  };
  const pluginStoragePlugin = plugin?.trim() ?? void 0;
  return {
    listContent: (rel = "") => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_list_dir", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    newDirectory: (rel) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_mkdir", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    remove: (rel, recursive = false) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_rm", {
        rel,
        recursive,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    stat: (rel = "") => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_stat", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    writeText: (rel, contents, opts) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_write_text", {
        rel,
        permanent,
        contents,
        createDirs: opts?.createDirs,
        append: opts?.append,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    readText: (rel) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_read_text", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    writeBytes: (rel, base64, opts) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_write_bytes", {
        rel,
        permanent,
        dataBase64: base64,
        createDirs: opts?.createDirs,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    readBytes: (rel) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_read_bytes", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    exists: (rel) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_exists", {
        rel,
        permanent,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    move: (src, dest, opts) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_move", {
        src,
        dest,
        permanent,
        createDirs: opts?.createDirs,
        overwrite: opts?.overwrite,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    },
    copy: (src, dest, opts) => {
      ensureDataNotIsolated();
      return core.invoke("lia_fs_copy", {
        src,
        dest,
        permanent,
        recursive: opts?.recursive,
        createDirs: opts?.createDirs,
        overwrite: opts?.overwrite,
        windowLabel: void 0,
        pluginStoragePlugin
      });
    }
  };
}
function scope(core, permanent) {
  const ensureDataNotIsolated = () => {
  };
  const coreMethods = scopeCoreMethods(core, permanent);
  const mainScopeMethods = {
    ...coreMethods,
    path: async () => {
      ensureDataNotIsolated();
      const p = await core.invoke("lia_fs_paths");
      return permanent ? p.data : p.cache;
    },
    clear: async () => {
      ensureDataNotIsolated();
      if (permanent) {
        return core.invoke("lia_fs_clear_data");
      }
      return core.invoke("lia_fs_clear_cache");
    },
    base: permanent ? ".data" : ".cache"
  };
  return mainScopeMethods;
}
function pluginFsScope(core, plugin) {
  const pluginName = plugin?.trim() ?? void 0;
  const sanitizedPluginName = normalizePluginName(pluginName)?.trim() ?? void 0;
  if (!sanitizedPluginName) throw "Invalid plugin name";
  const coreMethods = scopeCoreMethods(core, true, sanitizedPluginName);
  return {
    ...coreMethods,
    clearStorage: async () => core.invoke("lia_plugin_storage_clear", { plugin: sanitizedPluginName })
  };
}
function buildFs(core) {
  const cache = scope(core, false);
  const data = scope(core, true);
  return {
    cache,
    data,
    pluginFs: (plugin) => pluginFsScope(core, plugin),
    paths: async () => core.invoke("lia_fs_paths"),
    base: { cache: ".cache", data: ".data" },
    trash: {
      clear: async () => core.invoke("lia_fs_data_clear_trash"),
      recover: async () => core.invoke("lia_fs_data_recover_trash"),
      listContent: async (rel = "") => core.invoke("lia_fs_trash_list_dir", { rel }),
      stat: async (rel = "") => core.invoke("lia_fs_trash_stat", { rel }),
      exists: async (rel = "") => core.invoke("lia_fs_trash_exists", { rel }),
      readText: async (rel) => core.invoke("lia_fs_trash_read_text", { rel }),
      readBytes: async (rel) => core.invoke("lia_fs_trash_read_bytes", { rel })
    },
    diagnostics: {
      clear: async () => core.invoke("lia_fs_diagnostics_clear"),
      remove: async (rel, recursive = false) => core.invoke("lia_fs_diagnostics_rm", { rel, recursive }),
      listContent: async (rel = "") => core.invoke("lia_fs_diagnostics_list_dir", { rel }),
      stat: async (rel = "") => core.invoke("lia_fs_diagnostics_stat", { rel }),
      exists: async (rel = "") => core.invoke("lia_fs_diagnostics_exists", { rel }),
      readText: async (rel) => core.invoke("lia_fs_diagnostics_read_text", { rel }),
      readBytes: async (rel) => core.invoke("lia_fs_diagnostics_read_bytes", { rel })
    }
  };
}

// src-ts/modules/rs/clipboard/_main.ts
function buildClipboard(core) {
  return {
    readText: () => core.invoke("lia_clipboard_read"),
    writeText: (text) => core.invoke("lia_clipboard_write", { text })
  };
}

// src-ts/modules/rs/shortcuts/_main.ts
function buildShortcuts(core) {
  return {
    register: async (accelerator, cb, options) => {
      const gs = tauriGlobalShortcut();
      await gs.register(accelerator, async (e) => {
        const payload = { accelerator, ...e };
        if (options?.emitEvent) await core.invoke("lia_event_emit", { event: "shortcut:event", payload });
        cb(payload);
      });
    },
    unregister: async (accelerator) => {
      const gs = tauriGlobalShortcut();
      const reg = await gs.isRegistered(accelerator);
      if (reg) await gs.unregister(accelerator);
    },
    unregisterAll: async () => {
      const gs = tauriGlobalShortcut();
      await gs.unregisterAll();
    },
    isRegistered: async (accelerator) => {
      const gs = tauriGlobalShortcut();
      return gs.isRegistered(accelerator);
    }
  };
}

// src-ts/modules/rs/notifications/_main.ts
function buildNotifications(core) {
  return {
    state: () => core.invoke("lia_notification_state"),
    request: () => core.invoke("lia_request_permission"),
    show: (title, body) => core.invoke("lia_notify", { title, body })
  };
}

// src-ts/modules/rs/app/_main.ts
function buildAppInfo(core) {
  return {
    info: () => core.invoke("lia_app_info"),
    exit: (code) => core.invoke("lia_app_exit", { code: code ?? 0 })
  };
}

// src-ts/modules/rs/window/_main.ts
function buildWindow(core) {
  const randomWindowLabel = `w_${Math.random().toString(36).substring(2, 2 + 8)}`;
  return {
    minimize: (label) => core.invoke("lia_win_minimize", { label: label ?? "main" }),
    maximizeToggle: (label) => core.invoke("lia_win_maximize", { label: label ?? "main" }),
    fullscreen: (enable, label) => core.invoke("lia_win_fullscreen", { enable, label: label ?? "main" }),
    new: async (options) => newWindow(core, options),
    close: (label) => closeWindow(core, label),
    getInfo: (label) => core.invoke("lia_win_get_info", { label })
  };
}

// src-ts/modules/rs/dragdrop/_main.ts
function buildDragDrop() {
  return {
    on: async (handler, options) => {
      const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
      if (options?.includeHover) evs.push("dragdrop:hover");
      const offs = await Promise.all(evs.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    }
  };
}

// src-ts/modules/rs/menu/_main.ts
function buildMenu(core) {
  return {
    setEnabled: (id, enabled) => core.invoke("lia_menu_set_enabled", { id, enabled }),
    setChecked: (id, checked) => core.invoke("lia_menu_set_checked", { id, checked }),
    init: {
      fromConfig: (config, windowLabel) => initMenuConfig(core, config, windowLabel),
      fromJsonFile: (filePath) => core.invoke("lia_init_menu_from_file", { filePath })
    }
  };
}

// src-ts/modules/rs/diagnostics/_main.ts
function buildDiagnostics(core) {
  return {
    settings: {
      // set: mappa ai parametri snake_case attesi da Rust (tutti opzionali)
      set: (settings) => diagnosticsSettings(core, settings),
      get: () => core.invoke("lia_logs_get_privacy", {})
    },
    // SOLO analytics (Rust vuole AnalyticsRecord), usa key record_type
    newRecord: async (recordType, payload, env, appVersion) => {
      const v = await deriveAppVersion(appVersion);
      return await core.invoke("lia_logs_new_record", {
        recordType,
        payload,
        env,
        appVersion: v
      });
    },
    newError: {
      js: async (payload, appVersion) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("lia_logs_record_js_error", { payload, appVersion: v });
      },
      native: async (payload, appVersion) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("lia_logs_record_native_error", { payload, appVersion: v });
      },
      // Rust richiede 'env' obbligatorio: di default "generic" se non passato
      generic: async (payload, env = "generic", appVersion) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("lia_logs_record_error", { payload, env, appVersion: v });
      }
    },
    readRecordsFile: (relPath) => core.invoke("lia_logs_read_file", { relPath }),
    // qui avevi chiamato lia_logs_read_file: correggo su lia_logs_list_files
    listRecordsFiles: (area) => core.invoke("lia_logs_list_files", { area }),
    runRetention: () => core.invoke("lia_logs_run_retention", {}),
    export: () => core.invoke("lia_logs_export_zip", {}),
    test: buildDiagnosticsTestFunctions(core)
  };
}

// src-ts/modules/rs/network/_main.ts
function buildNetwork(core) {
  return {
    status: () => core.invoke("lia_network_get_status"),
    ping: (url, timeoutMs) => core.invoke("lia_network_ping", { url: url ?? "", timeoutMs }),
    resolve: (host) => core.invoke("lia_network_resolve", { host }),
    estimateBandwidth: (url, sizeHintBytes, timeoutMs) => core.invoke("lia_network_bandwidth_estimate", { url, sizeHintBytes, timeoutMs }),
    setMonitor: (intervalMs, targets) => core.invoke("lia_network_set_monitor", { intervalMs: intervalMs ?? 3e3, targets }),
    stopMonitor: () => core.invoke("lia_network_stop_monitor")
  };
}

// src-ts/modules/rs/autostart/_main.ts
function buildAutostart(core) {
  return {
    enable: () => core.invoke("lia_autostart_enable"),
    disable: () => core.invoke("lia_autostart_disable"),
    isEnabled: () => core.invoke("lia_autostart_status"),
    mode: {
      get: () => core.invoke("lia_get_autostart_mode"),
      set: (mode) => core.invoke("lia_set_autostart_mode", { mode })
    }
  };
}

// src-ts/modules/rs/badge/_main.ts
function buildBadge(core) {
  return {
    set: async (count) => {
      await platformSpecifcFilter(["macos"]);
      core.invoke("lia_badge_set", { count });
    },
    clear: async () => {
      await platformSpecifcFilter(["macos"]);
      core.invoke("lia_badge_clear");
    }
  };
}

// src-ts/modules/rs/worker/_main.ts
function buildWorker(core) {
  return {
    call: (method, payload, timeoutMs) => core.invoke("lia_worker_call", { modulePath: normalizeModuleName(method), payload, timeoutMs }),
    status: () => core.invoke("lia_worker_status"),
    restart: () => core.invoke("lia_worker_restart"),
    // delivery: (id: string, result: string): Promise<boolean> => core.invoke("lia_worker_delivery", {id, result}),
    modules: {
      list: () => core.invoke("lia_worker_list_modules"),
      remove: (name) => core.invoke("lia_worker_remove_module", { name: normalizeModuleName(name) }),
      addFromBytes: (name, contents) => core.invoke("lia_worker_add_module", { name: normalizeModuleName(name), contents }),
      add: (name, maxBytes) => core.invoke("lia_worker_pick_and_add_module", { maxBytes, defaultName: normalizeModuleName(name) })
    },
    clearSandbox: () => core.invoke("lia_worker_clear_all"),
    paths: () => core.invoke("lia_worker_paths")
  };
}

// src-ts/modules/rs/contextMenu/_main.ts
function buildContextMenu(core) {
  return {
    show: (entries, options) => core.invoke("lia_context_menu_popup", { items: normalizeEntries(entries), options }),
    handler: {
      init: initContextMenuListener,
      remove: removeContextMenuListener
    }
  };
}

// src-ts/modules/rs/globalVariables/_main.ts
function buildGlobVar(core) {
  return {
    get: async (key) => core.invoke("lia_global_vars_get", { key }),
    set: async (key, value) => core.invoke("lia_global_vars_set", { key, value }),
    remove: async (key) => core.invoke("lia_global_vars_remove", { key }),
    list: async () => core.invoke("lia_global_vars_list")
  };
}

// src-ts/modules/rs/sidecar/_main.ts
function buildSidecar(core) {
  return {
    run: (name, args) => core.invoke("lia_sidecar_run", { name, args })
  };
}

// src-ts/modules/bio/pipeline/_main.ts
function buildPipeline(deps) {
  return {
    run: async (steps, opts = {}) => {
      const { continueOnError = false } = opts;
      const results = [];
      const pipelineStart = Date.now();
      let failedAt = null;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStart = Date.now();
        let result = {
          label: step.label,
          status: "running",
          durationMs: 0,
          output: null,
          error: null
        };
        try {
          const output = await deps.sidecar.run(step.binary, step.args);
          result.output = output;
          result.status = output.ok ? "done" : "error";
          if (!output.ok) {
            result.error = output.error ?? `exit code ${output.exitCode}`;
          }
        } catch (err) {
          result.status = "error";
          result.error = err instanceof Error ? err.message : String(err);
        }
        result.durationMs = Date.now() - stepStart;
        results.push(result);
        if (result.status === "error") {
          if (failedAt === null) failedAt = i;
          if (!continueOnError) break;
        }
      }
      for (let i = results.length; i < steps.length; i++) {
        results.push({
          label: steps[i].label,
          status: "pending",
          durationMs: 0,
          output: null,
          error: null
        });
      }
      return {
        ok: failedAt === null,
        steps: results,
        totalDurationMs: Date.now() - pipelineStart,
        failedAt
      };
    }
  };
}

// src-ts/modules/rs/jobs/_main.ts
function buildJobs(core) {
  return {
    spawn: (cmd, args, opts = {}) => core.invoke("lia_jobs_spawn", {
      cmd,
      args,
      cwd: opts.cwd,
      env: opts.env,
      label: opts.label,
      kind: opts.kind,
      metadata: opts.metadata
    }),
    kill: (jobId) => core.invoke("lia_jobs_kill", { jobId }),
    status: (jobId) => core.invoke("lia_jobs_status", { jobId }),
    list: () => core.invoke("lia_jobs_list"),
    clearDone: () => core.invoke("lia_jobs_clear_done")
  };
}

// src-ts/modules/rs/deps/_main.ts
function buildDeps(core) {
  return {
    check: (binary) => core.invoke("lia_deps_check", { binary }),
    checkMany: (binaries) => core.invoke("lia_deps_check_many", { binaries })
  };
}

// src-ts/modules/qc/fastqc/_main.ts
var MODULE = "fastqc.wasm";
function parentDir(filePath) {
  const sep = filePath.includes("/") ? "/" : "\\";
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.substring(0, idx) : sep;
}
function barColor(q) {
  if (q >= 30) return "#10b981";
  if (q >= 20) return "#f59e0b";
  return "#ef4444";
}
function qualityGrade(q) {
  if (q >= 30) return "Excellent";
  if (q >= 20) return "Acceptable";
  return "Poor";
}
function formatBases(b) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} Gb`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mb`;
  return `${b.toLocaleString()} bp`;
}
function toToolOutput(r) {
  const qColor = barColor(r.meanQuality);
  const grade = qualityGrade(r.meanQuality);
  const sections = [
    {
      type: "stats",
      cols: 4,
      items: [
        {
          label: "Reads",
          value: r.readCount.toLocaleString(),
          description: "Total number of reads in the FASTQ file."
        },
        {
          label: "Total Bases",
          value: formatBases(r.totalBases),
          description: "Sum of all base pairs across all reads."
        },
        {
          label: "Mean Length",
          value: `${r.meanLength.toFixed(0)} bp`,
          description: "Average read length in base pairs."
        },
        {
          label: "GC Content",
          value: `${(r.gcContent * 100).toFixed(1)}%`,
          description: "Fraction of bases that are G or C. Expected range is 40\u201360% for most organisms; deviations may indicate contamination or sequencing bias."
        }
      ]
    },
    {
      type: "stats",
      cols: 3,
      items: [
        {
          label: "Mean Quality",
          value: `Q${r.meanQuality.toFixed(1)}`,
          color: qColor,
          description: "Mean Phred quality score across all bases. Q30 = 99.9% base-call accuracy; Q20 = 99%."
        },
        {
          label: "Read Length Range",
          value: `${r.minLength}\u2013${r.maxLength} bp`,
          description: "Shortest and longest reads found in the file. A narrow range is typical of Illumina short reads."
        },
        {
          label: "Quality Grade",
          value: grade,
          color: qColor,
          description: "Overall quality assessment derived from mean Phred score: Excellent (Q\u226530), Acceptable (Q\u226520), Poor (Q<20)."
        }
      ]
    }
  ];
  if (r.qualityPerPosition.length > 0) {
    sections.push({
      type: "plotly",
      plotlyType: "bar",
      title: "Per-position Mean Quality",
      subtitle: "Green = Q\u226530 \xB7 Amber = Q\u226520 \xB7 Red < Q20",
      description: "Mean Phred quality score at each cycle position across all reads. Quality typically drops toward the 3\u2032 end. Dotted lines mark the Q30 and Q20 thresholds.",
      data: [
        {
          x: r.qualityPerPosition.map((_, i) => i + 1),
          y: r.qualityPerPosition,
          type: "bar",
          marker: { color: r.qualityPerPosition.map(barColor) },
          hovertemplate: "Position %{x}<br>Q%{y:.1f}<extra></extra>"
        }
      ],
      layout: {
        bargap: 0.1,
        shapes: [
          { type: "line", x0: 0, x1: 1, xref: "paper", y0: 30, y1: 30, line: { color: "#10b981", width: 1, dash: "dot" } },
          { type: "line", x0: 0, x1: 1, xref: "paper", y0: 20, y1: 20, line: { color: "#f59e0b", width: 1, dash: "dot" } }
        ],
        yaxis: { range: [0, Math.max(42, ...r.qualityPerPosition) + 2] }
      }
    });
  }
  return { sections };
}
function buildFastqc(core) {
  return {
    run: async (args) => {
      const hostReadPaths = [parentDir(args.input)];
      const result = await core.invoke("lia_plugin_call", {
        plugin: MODULE,
        payload: { fn: "run", args },
        timeoutMs: args.timeoutMs ?? 3e5,
        hostReadPaths
      });
      if (!result.ok) {
        const msg = result.stderr?.trim() || result.error || "fastqc failed";
        throw new Error(msg);
      }
      return toToolOutput(result.value);
    }
  };
}

// src-ts/modules/qc/_main.ts
function buildQc(core) {
  return {
    fastqc: buildFastqc(core)
  };
}

// src-ts/bridge.ts
(() => {
  if (typeof window === "undefined") return;
  if (window.Liatir) return;
  console.log("[Liatir bridge] init script evaluated");
  const core = buildCore();
  const sidecar = buildSidecar(core);
  const api = {
    get isAvailable() {
      return true;
    },
    apiVersion: API_VERSION,
    get ready() {
      return core.ready;
    },
    invoke: core.invoke,
    isDesktop: true,
    desktop: {
      notifications: buildNotifications(core),
      clipboard: buildClipboard(core),
      files: buildFiles(core),
      app: buildAppInfo(core),
      window: buildWindow(core),
      events: buildEvents(core),
      globalShortcut: buildShortcuts(core),
      fs: buildFs(core),
      menu: buildMenu(core),
      diagnostics: buildDiagnostics(core),
      network: buildNetwork(core),
      autostart: buildAutostart(core),
      badge: buildBadge(core),
      contextMenu: buildContextMenu(core),
      globalVariables: buildGlobVar(core)
    },
    sidecar,
    pipeline: buildPipeline({ sidecar }),
    jobs: buildJobs(core),
    deps: buildDeps(core),
    qc: buildQc(core),
    tauri: windowTauriProxy,
    onReady: liaReadyEventListener,
    openBrowser: (url) => window.__TAURI__?.shell?.open(url)
  };
  Object.defineProperty(window, "Liatir", {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false
  });
  console.log("[Liatir bridge] window.Liatir assigned", window.Liatir);
})();
(async () => {
  await waitTauri();
  if (tauriReadyCheck()) {
    liaInitiators();
  } else {
    console.error("[Liatir bridge] Tauri did not become ready in time");
  }
})();
export {
  API_VERSION,
  APP_URL,
  BROWSER_STORAGE_NAMESPACE,
  CM_TYPES,
  LiatirInstance,
  READY_EVENT_NAME,
  WINDOWS_LABELS_TRACKER_VARIABLE_NAME,
  buildAppInfo,
  buildAutostart,
  buildBadge,
  buildClipboard,
  buildContextMenu,
  buildCore,
  buildDeps,
  buildDiagnostics,
  buildDiagnosticsTestFunctions,
  buildDragDrop,
  buildEvents,
  buildFastqc,
  buildFiles,
  buildFs,
  buildGlobVar,
  buildJobs,
  buildMenu,
  buildNetwork,
  buildNotifications,
  buildPipeline,
  buildQc,
  buildShortcuts,
  buildSidecar,
  buildWindow,
  buildWorker,
  closeWindow,
  deriveAppVersion,
  diagnosticsSettings,
  ensureCore,
  extractCore,
  getAppVersion,
  initContextMenuListener,
  initMenuConfig,
  isCmType,
  isTauri,
  liaInitiators,
  liaReadyEventListener,
  listenForEvent,
  newWindow,
  normalizeEntries,
  normalizeModuleName,
  normalizeString,
  parseCmType,
  platformSpecifcFilter,
  removeContextMenuListener,
  tauriGlobalShortcut,
  tauriReadyCheck,
  waitTauri,
  windowTauriProxy
};
