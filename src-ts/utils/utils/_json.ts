// jsonTools.ts
// --- All comments are in English as requested ---

import Ajv, { AnySchema, DefinedError } from "ajv";
import addFormats from "ajv-formats";
import { validate as _validate } from "./_typesValidation";

/**
 * Public interface for the jsonTools utility.
 * Import this if you want to type variables or parameters that expose
 * the same API surface as `jsonTools`.
 */
export interface JsonTools {
  /**
   * Validate a JSON string against an optional schema.
   * - If `schema` is omitted: only checks JSON validity and returns the parsed value.
   * - If `schema` is provided: validates using Ajv (draft-07 friendly).
   */
  validate<T = unknown>(
    jsonStr: string,
    schema?: AnySchema | string
  ): { ok: true; data: T } | { ok: false; errors: string[] };

  /** Safely parse a JSON string without throwing. */
  parse<T = unknown>(jsonStr: string): { ok: true; data: T } | { ok: false; error: string };

  /** Safely stringify any value to JSON (handles circular refs and never throws). */
  stringify(value: any, space?: number): string;

  /** Pretty-print a JSON string with a given indentation (returns original if invalid). */
  pretty(jsonStr: string, indent?: number): string;

  /** Minify a JSON string by removing whitespace (returns original if invalid). */
  compact(jsonStr: string): string;

  /** Deep structural equality for JSON-compatible values (key-order insensitive for objects). */
  isEqual(a: unknown, b: unknown): boolean;

  /** Safely access nested properties via dot-path (supports numeric indices). */
  get<T = unknown>(obj: any, path: string): T | undefined;

  /**
   * Non-mutating deep merge of two objects (arrays are overwritten).
   * Returns a new object typed as the intersection T & U.
   */
  merge<T extends object, U extends object>(target: T, source: U): T & U;

  /**
   * Compute a flat diff map of paths to old/new values.
   * Paths use dot notation; "(root)" indicates the root value.
   */
  diff(a: unknown, b: unknown): Record<string, { oldValue: any; newValue: any }>;

  /** Summarize a JSON Schema for quick inspection (types, enums, properties). */
  schemaSummary(schema: AnySchema): string;

  /** Infer a minimal JSON Schema from an example value. */
  inferSchema(example: unknown): AnySchema;
}

/**
 * A parsed JSON validation result: either success with data, or failure with readable errors.
 * @template T Parsed JSON value type (defaults to unknown)
 * @property {true} ok Indicates success
 * @property {T} data Parsed JSON value
 */
/**
 * @template T
 * @typedef {object} Ok
 * @property {true} ok
 * @property {T} data
 */

/**
 * A parsed JSON validation failure result.
 * @property {false} ok Indicates failure
 * @property {string[]} errors Human-readable error messages
 */
/**
 * @typedef {object} Err
 * @property {false} ok
 * @property {string[]} errors
 */

/**
 * Union result type for validation outcomes.
 * @template T
 * @typedef {(Ok<T> | Err)} ValidationResult
 */

/** Global singleton Ajv to avoid recompilation overhead */
const ajv = new Ajv({
  allErrors: true, // richer error messages
  strict: false    // plays nice with draft-07 and relaxed schemas
});
addFormats(ajv);

/** Cache compiled validators per schema object for efficiency */
const validatorCache = new WeakMap<object, (data: unknown) => boolean>();

/* -------------------------------------------------------------------------- */
/* Internal helpers (not exported)                                            */
/* -------------------------------------------------------------------------- */

/** Fast-check for plain JSON-like objects */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Safe JSON.stringify with circular reference handling */
function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  const replacer = (key: string, val: any) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    // Drop undefined to be consistent with native JSON.stringify
    return val === undefined ? undefined : val;
  };
  try {
    return JSON.stringify(value, replacer, space);
  } catch {
    // As a last resort, coerce to string to avoid throwing
    return String(value);
  }
}

/** Fast deep equality for JSON-compatible values (objects/arrays/primitives) */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    // Key order-insensitive
    for (const k of ak) {
      if (!(k in b)) return false;
      if (!deepEqual(a[k], (b as any)[k])) return false;
    }
    return true;
  }

  // For numbers, handle NaN equality per JSON (NaN isn't valid JSON, but be safe)
  if (ta === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;

  return false;
}

/** Non-mutating deep merge for JSON-compatible objects; arrays are overwritten */
function deepMerge<T extends Record<string, any>, U extends Record<string, any>>(a: T, b: U): T & U {
  const out: Record<string, any> = { ...a };
  for (const key of Object.keys(b)) {
    const vB = (b as any)[key];
    const vA = (a as any)[key];

    if (Array.isArray(vB)) {
      // Overwrite arrays (common for configs)
      out[key] = vB.slice();
    } else if (isPlainObject(vB) && isPlainObject(vA)) {
      out[key] = deepMerge(vA, vB);
    } else if (isPlainObject(vB)) {
      out[key] = deepMerge({}, vB);
    } else {
      out[key] = vB;
    }
  }
  return out as T & U;
}

/** Produce a flat diff of paths to {oldValue,newValue} */
function computeDiff(a: any, b: any, basePath = ""): Record<string, { oldValue: any; newValue: any }> {
  if (deepEqual(a, b)) return {};
  const changes: Record<string, { oldValue: any; newValue: any }> = {};

  const pathOf = (p: string, key: string | number) => (p ? `${p}.${String(key)}` : String(key));

  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const sub = computeDiff(a[i], b[i], pathOf(basePath, i));
      Object.assign(changes, sub);
    }
    return changes;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const sub = computeDiff(a[k], b[k], pathOf(basePath, k));
      Object.assign(changes, sub);
    }
    return changes;
  }

  // Primitive or different shapes
  changes[basePath || "(root)"] = { oldValue: a, newValue: b };
  return changes;
}

/** Infer a minimal JSON Schema for a given JSON-compatible value */
function inferSimpleSchema(value: any): AnySchema {
  const t = typeof value;

  if (value === null) return { type: "null" } as any;

  if (t === "string" || t === "number" || t === "boolean") {
    return { type: t } as AnySchema;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      // Unknown items; keep it permissive
      return { type: "array" } as AnySchema;
    }
    // Union item types, then simplify identical types
    const itemsSchemas = value.map(inferSimpleSchema);
    // Try to collapse to single type if all equal
    const allSame = itemsSchemas.every(s => JSON.stringify(s) === JSON.stringify(itemsSchemas[0]));
    return allSame
      ? { type: "array", items: itemsSchemas[0] }
      : { type: "array", items: { anyOf: itemsSchemas } };
  }

  if (isPlainObject(value)) {
    const props: Record<string, AnySchema> = {};
    const required: string[] = [];
    for (const key of Object.keys(value)) {
      required.push(key);
      props[key] = inferSimpleSchema(value[key]);
    }
    return {
      type: "object",
      properties: props,
      required,
      additionalProperties: false
    } as AnySchema;
  }

  // Fallback - JSON incompatible values get stringified
  return { type: "string" } as AnySchema;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A small toolkit for working with JSON strings.
 *
 * @remarks
 * - The only exported API is this default object `jsonTools`.
 * - All functions are documented with JSDoc so tooltips are shown in IDEs.
 */
export const jsonTools: JsonTools = {
  /**
   * Validate a JSON string.
   *
   * - If `schema` is **omitted**: only checks that the string is valid JSON and returns the parsed value.
   * - If `schema` is **provided** (object/boolean or JSON string): validates against the schema using Ajv.
   *
   * @template T
   * @param {string} jsonStr The JSON string to parse.
   * @param {AnySchema | string} [schema] Optional JSON Schema as an object/boolean or as a JSON string.
   * @returns {ValidationResult<T>} On success, `{ ok: true, data }`; on failure, `{ ok: false, errors }`.
   *
   * @example
   * // Just check if it's valid JSON
   * const r1 = jsonTools.validate('{"a":1}');
   * if (r1.ok) {
   *   // r1.data is the parsed value
   *   console.log(r1.data);
   * }
   *
   * @example
   * // Validate against a schema (object)
   * const schema = {
   *   type: "object",
   *   required: ["a"],
   *   properties: { a: { type: "number" } },
   *   additionalProperties: false
   * } as const;
   * const r2 = jsonTools.validate<{ a: number }>('{"a":1}', schema);
   * console.log(r2.ok ? "valid" : r2.errors.join("\\n"));
   *
   * @example
   * // Validate against a schema (string)
   * const schemaStr = JSON.stringify({ type: "array", items: { type: "string" } });
   * const r3 = jsonTools.validate<string[]>('["x","y"]', schemaStr);
   * if (r3.ok) console.log(r3.data.length);
   */
  validate<T = unknown>(
    jsonStr: string,
    schema?: AnySchema | string
  ):
    | { ok: true; data: T }
    | { ok: false; errors: string[] } {
    // 1) Parse the JSON safely
    let parsed: unknown;
    let isValidJSON: boolean = false;
    let notValidJSONError: unknown;
    try {
      parsed = JSON.parse(jsonStr);
      isValidJSON = _validate.jsonString(jsonStr);
    } catch (err) {
      isValidJSON = false;
      notValidJSONError = err;
    } finally {
      if (!isValidJSON) {
        let e = notValidJSONError;
        return {
          ok: false,
          errors: ["JSON malformato: " + (e instanceof Error ? e.message : String(e))]
        };
      }
    }

    // 2) If no schema, parsing success is enough
    if (schema === undefined) {
      return { ok: true, data: parsed as T };
    }

    // 3) Normalize schema (accept object/boolean or JSON string)
    let normalizedSchema: AnySchema;
    if (typeof schema === "string") {
      try {
        normalizedSchema = JSON.parse(schema) as AnySchema;
      } catch (e) {
        return {
          ok: false,
          errors: [
            "Schema malformato (non è JSON valido): " +
              (e instanceof Error ? e.message : String(e))
          ]
        };
      }
    } else {
      normalizedSchema = schema;
    }

    // 4) Compile (with cache) and validate
    let validateFn: ((data: unknown) => boolean) | undefined;

    if (normalizedSchema && typeof normalizedSchema === "object") {
      validateFn = validatorCache.get(normalizedSchema as object);
      if (!validateFn) {
        validateFn = ajv.compile(normalizedSchema);
        validatorCache.set(normalizedSchema as object, validateFn);
      }
    } else {
      // boolean schemas (true/false) or non-object: compile directly (no cache)
      validateFn = ajv.compile(normalizedSchema);
    }

    const isValid = validateFn(parsed);
    if (isValid) {
      return { ok: true, data: parsed as T };
    }

    // 5) Collect and format Ajv errors
    const ajvErrors = (validateFn as any).errors as DefinedError[] | null | undefined;
    const errors =
      ajvErrors?.map((err) => {
        const path = err.instancePath || "(root)";
        const keyword = err.keyword;
        const msg = err.message || "schema validation error";
        const params = err.params ? JSON.stringify(err.params) : "";
        return `${path} – ${keyword}: ${msg}${params ? ` ${params}` : ""}`;
      }) ?? ["Schema validation failed (unknown error)"];

    return { ok: false, errors };
  },

  /**
   * Safely parse a JSON string without throwing.
   * @template T
   * @param {string} jsonStr The JSON string to parse.
   * @returns {{ ok: true; data: T } | { ok: false; error: string }}
   * Returns the parsed value on success, or a readable error on failure.
   */
  parse<T = unknown>(jsonStr: string):
    | { ok: true; data: T }
    | { ok: false; error: string } {
    try {
      // Double-check with the same fast validator you already rely on.
      if (!_validate.jsonString(jsonStr)) {
        return { ok: false, error: "Invalid JSON string." };
      }
      return { ok: true, data: JSON.parse(jsonStr) as T };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  },

  /**
   * Safely stringify any value to JSON.
   * - Handles circular references by inserting the literal string "[Circular]".
   * - Skips `undefined` fields like native JSON.stringify.
   * - Never throws: returns a string representation even on edge cases.
   * @param {any} value The value to serialize.
   * @param {number} [space] Optional indentation (e.g., 2).
   * @returns {string} The JSON string (or a safe fallback string).
   */
  stringify(value: any, space?: number): string {
    return safeStringify(value, space);
  },

  /**
   * Beautify (pretty-print) a JSON string.
   * - If input is invalid JSON, the original string is returned unchanged.
   * @param {string} jsonStr The JSON string to format.
   * @param {number} [indent=2] Number of spaces for indentation.
   * @returns {string} A formatted JSON string, or the original input if invalid.
   */
  pretty(jsonStr: string, indent: number = 2): string {
    try {
      if (!_validate.jsonString(jsonStr)) return jsonStr;
      const obj = JSON.parse(jsonStr);
      return safeStringify(obj, indent);
    } catch {
      return jsonStr;
    }
  },

  /**
   * Compact (minify) a JSON string by removing whitespace and indentation.
   * - If input is invalid JSON, the original string is returned unchanged.
   * @param {string} jsonStr The JSON string to minify.
   * @returns {string} A minified JSON string, or the original input if invalid.
   */
  compact(jsonStr: string): string {
    try {
      if (!_validate.jsonString(jsonStr)) return jsonStr;
      const obj = JSON.parse(jsonStr);
      return safeStringify(obj);
    } catch {
      return jsonStr;
    }
  },

  /**
   * Deep equality check for JSON-compatible values.
   * - Order-insensitive for object keys.
   * - Arrays must match in order and length.
   * @param {unknown} a First value.
   * @param {unknown} b Second value.
   * @returns {boolean} True if structurally equal, false otherwise.
   */
  isEqual(a: unknown, b: unknown): boolean {
    return deepEqual(a, b);
  },

  /**
   * Safely access nested properties using a dot path.
   * - Example: `jsonTools.get(obj, "user.settings.theme")`
   * - Returns `undefined` if any segment is missing.
   * @template T
   * @param {any} obj The object to query.
   * @param {string} path Dot-separated path (supports numeric indices for arrays).
   * @returns {T | undefined} The found value or undefined.
   */
  get<T = unknown>(obj: any, path: string): T | undefined {
    if (!path) return obj as T;
    const parts = path.split(".");
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      // Support numeric array indices
      const idx = Number(p);
      if (Array.isArray(cur) && Number.isInteger(idx)) {
        cur = cur[idx];
      } else {
        cur = cur[p];
      }
    }
    return cur as T | undefined;
  },

  /**
   * Deep merge two JSON-compatible objects (non-mutating).
   * - Arrays are overwritten by default.
   * - Objects are merged recursively.
   * @template T extends object
   * @template U extends object
   * @param {T} target Base object.
   * @param {U} source Override object.
   * @returns {T & U} A new merged object.
   */
  merge<T extends object, U extends object>(target: T, source: U): T & U {
    // We sanitize inputs to plain objects at runtime, but preserve the compile-time T & U contract.
    // TypeScript cannot infer that deepMerge returns T & U when given widened Records,
    // so we cast the merged result back to T & U (safe by construction for JSON-compatible objects).
    const a = isPlainObject(target) ? (target as Record<string, any>) : {};
    const b = isPlainObject(source) ? (source as Record<string, any>) : {};
    const merged = deepMerge(a, b);
    return merged as unknown as T & U;
  },

  /**
   * Compute a structural diff between two JSON-compatible values.
   * - Returns a flat map of `path -> { oldValue, newValue }` for changed leaves.
   * - Paths use dot notation; "(root)" indicates the root value.
   * @param {unknown} a Original value.
   * @param {unknown} b New value.
   * @returns {Record<string, { oldValue: any; newValue: any }>} Diff map.
   */
  diff(a: unknown, b: unknown): Record<string, { oldValue: any; newValue: any }> {
    return computeDiff(a, b);
  },

  /**
   * Generate a short human-readable summary of a JSON Schema.
   * - Lists top-level `type`, enumerations and object properties (with required flags).
   * - Intended for debugging and quick docs.
   * @param {AnySchema} schema A JSON Schema object.
   * @returns {string} A readable, multi-line summary.
   */
  schemaSummary(schema: AnySchema): string {
    try {
      const lines: string[] = [];
      const s = schema as any;

      if (s.type) lines.push(`type: ${Array.isArray(s.type) ? s.type.join("|") : s.type}`);
      if (s.enum) lines.push(`enum: [${s.enum.join(", ")}]`);

      const defs = s.definitions || s.$defs;
      if (defs && isPlainObject(defs)) {
        lines.push(`definitions: ${Object.keys(defs).length}`);
      }

      const props = s.properties;
      if (props && isPlainObject(props)) {
        const required: string[] = Array.isArray(s.required) ? s.required : [];
        lines.push("properties:");
        for (const key of Object.keys(props)) {
          const prop = props[key];
          const t =
            prop && typeof prop === "object" && "type" in prop
              ? Array.isArray(prop.type) ? prop.type.join("|") : prop.type
              : "(any)";
          const req = required.includes(key) ? " (required)" : "";
          lines.push(`  - ${key}: ${t}${req}`);
        }
      }

      return lines.join("\n") || "[empty schema]";
    } catch {
      return "[unreadable schema]";
    }
  },

  /**
   * Infer a minimal JSON Schema from a JSON-compatible example.
   * - Produces a conservative, validation-ready schema:
   *   * objects -> `type: object`, `properties`, `required` (all present keys), `additionalProperties: false`
   *   * arrays  -> `type: array`, `items` inferred (union if mixed)
   * @param {unknown} example Example value to infer from.
   * @returns {AnySchema} A minimal JSON Schema.
   */
  inferSchema(example: unknown): AnySchema {
    return inferSimpleSchema(example);
  }
} as const;