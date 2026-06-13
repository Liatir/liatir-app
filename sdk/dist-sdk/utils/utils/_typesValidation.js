"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
// ------------------ helpers ------------------
function validateUrl(input) {
    if (typeof input !== "string")
        return false;
    const s = input.trim();
    if (s.length === 0)
        return false;
    try {
        new URL(s); // richiede schema (es. https://)
        return true;
    }
    catch {
        return false;
    }
}
function isValidDateString(value) {
    if (typeof value !== "string")
        return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
}
function isValidDateObject(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
}
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// YYYY-MM-DDThh:mm(:ss(.sss)?)?(Z|±HH:MM)
const ISO_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+\-](?:[01]\d|2[0-3]):?[0-5]\d)$/;
function isIsoDateString(value) {
    if (typeof value !== "string" || !ISO_DATE_RE.test(value))
        return false;
    // validazione calendario: costruisci la data e verifica corrispondenza
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d);
}
function isIsoDateTimeString(value) {
    if (typeof value !== "string" || !ISO_DATETIME_RE.test(value))
        return false;
    const dt = new Date(value);
    return !Number.isNaN(dt.getTime());
}
// RFC 5322-lite (pragmatico)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// UUID v1–v5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// #RGB o #RRGGBB
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// IPv4
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
// IPv6 (compressa o piena) — accetta forme valide comuni
const IPV6_RE = /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(([0-9A-Fa-f]{1,4}:){1,7}:)|(([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2})|(([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3})|(([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4})|(([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5})|([0-9A-Fa-f]{1,4}:((:[0-9A-Fa-f]{1,4}){1,6}))|(:((:[0-9A-Fa-f]{1,4}){1,7}|:)))(%[0-9A-Za-z]{1,})?$/;
// ------------------ implementation ------------------
exports.validate = {
    // base
    string: (v) => typeof v === "string",
    url: (v) => typeof v === "string" && validateUrl(v),
    nonEmptyString: (v) => typeof v === "string" && v.trim().length > 0,
    number: (v) => typeof v === "number" && !Number.isNaN(v),
    integer: (v) => typeof v === "number" && Number.isInteger(v),
    boolean: (v) => typeof v === "boolean",
    bigint: (v) => typeof v === "bigint",
    symbol: (v) => typeof v === "symbol",
    numeric: (v) => (typeof v === "number" ? !Number.isNaN(v) : !Number.isNaN(Number(v))),
    finiteNumber: (v) => typeof v === "number" && Number.isFinite(v),
    // date
    dateString: (v) => typeof v === "string" && isValidDateString(v),
    date: (v) => isValidDateObject(v),
    isoDateString: (v) => typeof v === "string" && isIsoDateString(v),
    isoDateTimeString: (v) => typeof v === "string" && isIsoDateTimeString(v),
    // null/undefined
    null: (v) => v === null,
    undefined: (v) => typeof v === "undefined",
    defined: (v) => v !== null && v !== undefined,
    nan: (v) => typeof v === "number" && Number.isNaN(v),
    // oggetti/collezioni
    object: (v) => v !== null && typeof v === "object",
    plainObject: (v) => {
        if (v === null || typeof v !== "object" || Array.isArray(v))
            return false;
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
        if (typeof v !== "string")
            return false;
        try {
            JSON.parse(v);
            return true;
        }
        catch {
            return false;
        }
    },
    // truthiness
    truthy: (v) => !!v,
    falsy: (v) => !v,
};
