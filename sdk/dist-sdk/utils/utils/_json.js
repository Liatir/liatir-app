"use strict";
// jsonTools.ts
// --- All comments are in English as requested ---
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonTools = void 0;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const _typesValidation_1 = require("./_typesValidation");
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
const ajv = new ajv_1.default({
    allErrors: true, // richer error messages
    strict: false // plays nice with draft-07 and relaxed schemas
});
(0, ajv_formats_1.default)(ajv);
/** Cache compiled validators per schema object for efficiency */
const validatorCache = new WeakMap();
/* -------------------------------------------------------------------------- */
/* Internal helpers (not exported)                                            */
/* -------------------------------------------------------------------------- */
/** Fast-check for plain JSON-like objects */
function isPlainObject(value) {
    if (value === null || typeof value !== "object")
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
/** Safe JSON.stringify with circular reference handling */
function safeStringify(value, space) {
    const seen = new WeakSet();
    const replacer = (key, val) => {
        if (typeof val === "object" && val !== null) {
            if (seen.has(val))
                return "[Circular]";
            seen.add(val);
        }
        // Drop undefined to be consistent with native JSON.stringify
        return val === undefined ? undefined : val;
    };
    try {
        return JSON.stringify(value, replacer, space);
    }
    catch {
        // As a last resort, coerce to string to avoid throwing
        return String(value);
    }
}
/** Fast deep equality for JSON-compatible values (objects/arrays/primitives) */
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (a === null || b === null)
        return a === b;
    const ta = typeof a;
    const tb = typeof b;
    if (ta !== tb)
        return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i]))
                return false;
        }
        return true;
    }
    if (isPlainObject(a)) {
        if (!isPlainObject(b))
            return false;
        const ak = Object.keys(a);
        const bk = Object.keys(b);
        if (ak.length !== bk.length)
            return false;
        // Key order-insensitive
        for (const k of ak) {
            if (!(k in b))
                return false;
            if (!deepEqual(a[k], b[k]))
                return false;
        }
        return true;
    }
    // For numbers, handle NaN equality per JSON (NaN isn't valid JSON, but be safe)
    if (ta === "number" && Number.isNaN(a) && Number.isNaN(b))
        return true;
    return false;
}
/** Non-mutating deep merge for JSON-compatible objects; arrays are overwritten */
function deepMerge(a, b) {
    const out = { ...a };
    for (const key of Object.keys(b)) {
        const vB = b[key];
        const vA = a[key];
        if (Array.isArray(vB)) {
            // Overwrite arrays (common for configs)
            out[key] = vB.slice();
        }
        else if (isPlainObject(vB) && isPlainObject(vA)) {
            out[key] = deepMerge(vA, vB);
        }
        else if (isPlainObject(vB)) {
            out[key] = deepMerge({}, vB);
        }
        else {
            out[key] = vB;
        }
    }
    return out;
}
/** Produce a flat diff of paths to {oldValue,newValue} */
function computeDiff(a, b, basePath = "") {
    if (deepEqual(a, b))
        return {};
    const changes = {};
    const pathOf = (p, key) => (p ? `${p}.${String(key)}` : String(key));
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
function inferSimpleSchema(value) {
    const t = typeof value;
    if (value === null)
        return { type: "null" };
    if (t === "string" || t === "number" || t === "boolean") {
        return { type: t };
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            // Unknown items; keep it permissive
            return { type: "array" };
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
        const props = {};
        const required = [];
        for (const key of Object.keys(value)) {
            required.push(key);
            props[key] = inferSimpleSchema(value[key]);
        }
        return {
            type: "object",
            properties: props,
            required,
            additionalProperties: false
        };
    }
    // Fallback - JSON incompatible values get stringified
    return { type: "string" };
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
exports.jsonTools = {
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
    validate(jsonStr, schema) {
        // 1) Parse the JSON safely
        let parsed;
        let isValidJSON = false;
        let notValidJSONError;
        try {
            parsed = JSON.parse(jsonStr);
            isValidJSON = _typesValidation_1.validate.jsonString(jsonStr);
        }
        catch (err) {
            isValidJSON = false;
            notValidJSONError = err;
        }
        finally {
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
            return { ok: true, data: parsed };
        }
        // 3) Normalize schema (accept object/boolean or JSON string)
        let normalizedSchema;
        if (typeof schema === "string") {
            try {
                normalizedSchema = JSON.parse(schema);
            }
            catch (e) {
                return {
                    ok: false,
                    errors: [
                        "Schema malformato (non è JSON valido): " +
                            (e instanceof Error ? e.message : String(e))
                    ]
                };
            }
        }
        else {
            normalizedSchema = schema;
        }
        // 4) Compile (with cache) and validate
        let validateFn;
        if (normalizedSchema && typeof normalizedSchema === "object") {
            validateFn = validatorCache.get(normalizedSchema);
            if (!validateFn) {
                validateFn = ajv.compile(normalizedSchema);
                validatorCache.set(normalizedSchema, validateFn);
            }
        }
        else {
            // boolean schemas (true/false) or non-object: compile directly (no cache)
            validateFn = ajv.compile(normalizedSchema);
        }
        const isValid = validateFn(parsed);
        if (isValid) {
            return { ok: true, data: parsed };
        }
        // 5) Collect and format Ajv errors
        const ajvErrors = validateFn.errors;
        const errors = ajvErrors?.map((err) => {
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
    parse(jsonStr) {
        try {
            // Double-check with the same fast validator you already rely on.
            if (!_typesValidation_1.validate.jsonString(jsonStr)) {
                return { ok: false, error: "Invalid JSON string." };
            }
            return { ok: true, data: JSON.parse(jsonStr) };
        }
        catch (e) {
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
    stringify(value, space) {
        return safeStringify(value, space);
    },
    /**
     * Beautify (pretty-print) a JSON string.
     * - If input is invalid JSON, the original string is returned unchanged.
     * @param {string} jsonStr The JSON string to format.
     * @param {number} [indent=2] Number of spaces for indentation.
     * @returns {string} A formatted JSON string, or the original input if invalid.
     */
    pretty(jsonStr, indent = 2) {
        try {
            if (!_typesValidation_1.validate.jsonString(jsonStr))
                return jsonStr;
            const obj = JSON.parse(jsonStr);
            return safeStringify(obj, indent);
        }
        catch {
            return jsonStr;
        }
    },
    /**
     * Compact (minify) a JSON string by removing whitespace and indentation.
     * - If input is invalid JSON, the original string is returned unchanged.
     * @param {string} jsonStr The JSON string to minify.
     * @returns {string} A minified JSON string, or the original input if invalid.
     */
    compact(jsonStr) {
        try {
            if (!_typesValidation_1.validate.jsonString(jsonStr))
                return jsonStr;
            const obj = JSON.parse(jsonStr);
            return safeStringify(obj);
        }
        catch {
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
    isEqual(a, b) {
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
    get(obj, path) {
        if (!path)
            return obj;
        const parts = path.split(".");
        let cur = obj;
        for (const p of parts) {
            if (cur == null)
                return undefined;
            // Support numeric array indices
            const idx = Number(p);
            if (Array.isArray(cur) && Number.isInteger(idx)) {
                cur = cur[idx];
            }
            else {
                cur = cur[p];
            }
        }
        return cur;
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
    merge(target, source) {
        // We sanitize inputs to plain objects at runtime, but preserve the compile-time T & U contract.
        // TypeScript cannot infer that deepMerge returns T & U when given widened Records,
        // so we cast the merged result back to T & U (safe by construction for JSON-compatible objects).
        const a = isPlainObject(target) ? target : {};
        const b = isPlainObject(source) ? source : {};
        const merged = deepMerge(a, b);
        return merged;
    },
    /**
     * Compute a structural diff between two JSON-compatible values.
     * - Returns a flat map of `path -> { oldValue, newValue }` for changed leaves.
     * - Paths use dot notation; "(root)" indicates the root value.
     * @param {unknown} a Original value.
     * @param {unknown} b New value.
     * @returns {Record<string, { oldValue: any; newValue: any }>} Diff map.
     */
    diff(a, b) {
        return computeDiff(a, b);
    },
    /**
     * Generate a short human-readable summary of a JSON Schema.
     * - Lists top-level `type`, enumerations and object properties (with required flags).
     * - Intended for debugging and quick docs.
     * @param {AnySchema} schema A JSON Schema object.
     * @returns {string} A readable, multi-line summary.
     */
    schemaSummary(schema) {
        try {
            const lines = [];
            const s = schema;
            if (s.type)
                lines.push(`type: ${Array.isArray(s.type) ? s.type.join("|") : s.type}`);
            if (s.enum)
                lines.push(`enum: [${s.enum.join(", ")}]`);
            const defs = s.definitions || s.$defs;
            if (defs && isPlainObject(defs)) {
                lines.push(`definitions: ${Object.keys(defs).length}`);
            }
            const props = s.properties;
            if (props && isPlainObject(props)) {
                const required = Array.isArray(s.required) ? s.required : [];
                lines.push("properties:");
                for (const key of Object.keys(props)) {
                    const prop = props[key];
                    const t = prop && typeof prop === "object" && "type" in prop
                        ? Array.isArray(prop.type) ? prop.type.join("|") : prop.type
                        : "(any)";
                    const req = required.includes(key) ? " (required)" : "";
                    lines.push(`  - ${key}: ${t}${req}`);
                }
            }
            return lines.join("\n") || "[empty schema]";
        }
        catch {
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
    inferSchema(example) {
        return inferSimpleSchema(example);
    }
};
