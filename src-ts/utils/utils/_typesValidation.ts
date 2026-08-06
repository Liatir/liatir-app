// ------------------ helpers ------------------
function validateUrl(input: string): boolean {
  if (typeof input !== "string") return false;
  const s = input.trim();
  if (s.length === 0) return false;
  try {
    new URL(s); // richiede schema (es. https://)
    return true;
  } catch {
    return false;
  }
}

function isValidDateString(value: string): boolean {
  if (typeof value !== "string") return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function isValidDateObject(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}


const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// YYYY-MM-DDThh:mm(:ss(.sss)?)?(Z|±HH:MM)
const ISO_DATETIME_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+\-](?:[01]\d|2[0-3]):?[0-5]\d)$/;

function isIsoDateString(value: string): boolean {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  // validazione calendario: costruisci la data e verifica corrispondenza
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isIsoDateTimeString(value: string): boolean {
  if (typeof value !== "string" || !ISO_DATETIME_RE.test(value)) return false;
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
const IPV6_RE =
  /^(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(([0-9A-Fa-f]{1,4}:){1,7}:)|(([0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})|(([0-9A-Fa-f]{1,4}:){1,5}(:[0-9A-Fa-f]{1,4}){1,2})|(([0-9A-Fa-f]{1,4}:){1,4}(:[0-9A-Fa-f]{1,4}){1,3})|(([0-9A-Fa-f]{1,4}:){1,3}(:[0-9A-Fa-f]{1,4}){1,4})|(([0-9A-Fa-f]{1,4}:){1,2}(:[0-9A-Fa-f]{1,4}){1,5})|([0-9A-Fa-f]{1,4}:((:[0-9A-Fa-f]{1,4}){1,6}))|(:((:[0-9A-Fa-f]{1,4}){1,7}|:)))(%[0-9A-Za-z]{1,})?$/;

type AnyFunc = (...args: any[]) => any;
type AsyncFunc = (...args: any[]) => Promise<any>;
type GenFunc = (...args: any[]) => Generator<any, any, any>;

// ------------------ types ------------------
interface Validate {
  // primitivi / base
  string(v: unknown): v is string;
  url(v: unknown): v is string;
  nonEmptyString(v: unknown): v is string;

  number(v: unknown): v is number;
  integer(v: unknown): v is number;
  boolean(v: unknown): v is boolean;
  bigint(v: unknown): v is bigint;
  symbol(v: unknown): v is symbol;

  numeric(v: unknown): boolean;
  finiteNumber(v: unknown): v is number;

  // date
  dateString(v: unknown): v is string;
  date(v: unknown): v is Date;
  isoDateString(v: unknown): v is string;
  isoDateTimeString(v: unknown): v is string;

  // null/undefined
  null(v: unknown): v is null;
  undefined(v: unknown): v is undefined;
  defined<T>(v: T | null | undefined): v is T;
  nan(v: unknown): v is number;

  // oggetti/collezioni
  object(v: unknown): v is Record<string, unknown>;
  plainObject(v: unknown): v is Record<string, unknown>;
  emptyObject(v: unknown): v is Record<string, never>;

  array<T = unknown>(v: unknown): v is T[];
  nonEmptyArray<T = unknown>(v: unknown): v is T[];

  set<T = unknown>(v: unknown): v is Set<T>;
  map<K = unknown, V = unknown>(v: unknown): v is Map<K, V>;
  weakSet<T extends object = object>(v: unknown): v is WeakSet<T>;
  weakMap<K extends object = object, V = unknown>(v: unknown): v is WeakMap<K, V>;

  // binari / typed arrays
  arrayBuffer(v: unknown): v is ArrayBuffer;
  dataView(v: unknown): v is DataView;
  typedArray(v: unknown): v is Exclude<ArrayBufferView, DataView>;

  // regex / promise / function
  regexp(v: unknown): v is RegExp;
  promise<T = unknown>(v: unknown): v is Promise<T>;
  function(v: unknown): v is AnyFunc;
  asyncFunction(v: unknown): v is AsyncFunc;
  generatorFunction(v: unknown): v is GenFunc;

  // stringhe con pattern
  email(v: unknown): v is string;
  uuid(v: unknown): v is string;
  hexColor(v: unknown): v is string;
  ipv4(v: unknown): v is string;
  ipv6(v: unknown): v is string;
  jsonString(v: unknown): v is string;

  // truthiness
  truthy(v: unknown): boolean;
  falsy(v: unknown): boolean;
}

// ------------------ implementation ------------------
export const validate: Validate = {
  // base
  string: (v): v is string => typeof v === "string",
  url: (v): v is string => typeof v === "string" && validateUrl(v),
  nonEmptyString: (v): v is string => typeof v === "string" && v.trim().length > 0,

  number: (v): v is number => typeof v === "number" && !Number.isNaN(v),
  integer: (v): v is number => typeof v === "number" && Number.isInteger(v),
  boolean: (v): v is boolean => typeof v === "boolean",
  bigint: (v): v is bigint => typeof v === "bigint",
  symbol: (v): v is symbol => typeof v === "symbol",

  numeric: (v): boolean => (typeof v === "number" ? !Number.isNaN(v) : !Number.isNaN(Number(v))),
  finiteNumber: (v): v is number => typeof v === "number" && Number.isFinite(v),

  // date
  dateString: (v): v is string => typeof v === "string" && isValidDateString(v),
  date: (v): v is Date => isValidDateObject(v),
  isoDateString: (v): v is string => typeof v === "string" && isIsoDateString(v),
  isoDateTimeString: (v): v is string => typeof v === "string" && isIsoDateTimeString(v),

  // null/undefined
  null: (v): v is null => v === null,
  undefined: (v): v is undefined => typeof v === "undefined",
  defined: <T>(v: T | null | undefined): v is T => v !== null && v !== undefined,
  nan: (v): v is number => typeof v === "number" && Number.isNaN(v),

  // oggetti/collezioni
  object: (v): v is Record<string, unknown> => v !== null && typeof v === "object",
  plainObject: (v): v is Record<string, unknown> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  },
  emptyObject: (v): v is Record<string, never> =>
    v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0,

  array: <T = unknown>(v: unknown): v is T[] => Array.isArray(v),
  nonEmptyArray: <T = unknown>(v: unknown): v is T[] => Array.isArray(v) && v.length > 0,

  set: <T = unknown>(v: unknown): v is Set<T> => v instanceof Set,
  map: <K = unknown, V = unknown>(v: unknown): v is Map<K, V> => v instanceof Map,
  weakSet: <T extends object = object>(v: unknown): v is WeakSet<T> => v instanceof WeakSet,
  weakMap: <K extends object = object, V = unknown>(v: unknown): v is WeakMap<K, V> => v instanceof WeakMap,

  // binari / typed arrays
  arrayBuffer: (v): v is ArrayBuffer => v instanceof ArrayBuffer,
  dataView: (v): v is DataView => v instanceof DataView,
  typedArray: (v): v is Exclude<ArrayBufferView, DataView> =>
    ArrayBuffer.isView(v) && !(v instanceof DataView),

  // regex / promise / function
  regexp: (v): v is RegExp => v instanceof RegExp,
  promise: <T = unknown>(v: unknown): v is Promise<T> => !!v && typeof (v as any).then === "function",
  function: (v): v is AnyFunc => typeof v === "function",
  asyncFunction: (v): v is AsyncFunc =>
    typeof v === "function" && (v as Function).constructor?.name === "AsyncFunction",
  generatorFunction: (v): v is GenFunc =>
    typeof v === "function" && (v as Function).constructor?.name === "GeneratorFunction",

  // stringhe con pattern
  email: (v): v is string => typeof v === "string" && EMAIL_RE.test(v),
  uuid: (v): v is string => typeof v === "string" && UUID_RE.test(v),
  hexColor: (v): v is string => typeof v === "string" && HEX_COLOR_RE.test(v),
  ipv4: (v): v is string => typeof v === "string" && IPV4_RE.test(v),
  ipv6: (v): v is string => typeof v === "string" && IPV6_RE.test(v),
  jsonString: (v): v is string => {
    if (typeof v !== "string") return false;
    try { JSON.parse(v); return true; } catch { return false; }
  },

  // truthiness
  truthy: (v): boolean => !!v,
  falsy: (v): boolean => !v,
};
