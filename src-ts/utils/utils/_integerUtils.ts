// numberUtils.ts

// ---------- Branding ----------
export type Brand<Base, Tag extends string> = Base & { readonly __brand: Tag };

// Branded number types
export type U8  = Brand<number, "u8">;
export type U16 = Brand<number, "u16">;
export type U32 = Brand<number, "u32">;
export type U64 = Brand<number, "u64">;
export type I8  = Brand<number, "i8">;
export type I16 = Brand<number, "i16">;
export type I32 = Brand<number, "i32">;
export type I64 = Brand<number, "i64">;
export type F32 = Brand<number, "f32">;
export type F64 = Brand<number, "f64">;

// ---------- Predicates ----------
export type NumberPredicate = (v: unknown) => v is number;

export interface NumPredicates {
  // Unsigned
  isU8: NumberPredicate;
  isU16: NumberPredicate;
  isU32: NumberPredicate;
  isU64: NumberPredicate;
  // Signed
  isI8: NumberPredicate;
  isI16: NumberPredicate;
  isI32: NumberPredicate;
  isI64: NumberPredicate;
  // Floats
  isF32: NumberPredicate;
  isF64: NumberPredicate;
}

// ---------- Refinement API ----------
export interface Refinement<TBrand extends string> {
  /** Type guard verso il tipo brandizzato */
  is(v: unknown): v is Brand<number, TBrand>;
  /** Costruttore che valida e lancia su input invalido */
  as(v: unknown): Brand<number, TBrand>;
  /** Costruttore “safe” che restituisce null se non valido */
  try(v: unknown): Brand<number, TBrand> | null;
  /** Parser da stringa (usa Number), valida e lancia su input invalido */
  parse(s: string): Brand<number, TBrand>;
}

// ---------- Oggetto pubblico Num (tipizzato) ----------
export interface NumAPI extends NumPredicates {
  U8:  Refinement<"u8">;
  U16: Refinement<"u16">;
  U32: Refinement<"u32">;
  U64: Refinement<"u64">;
  I8:  Refinement<"i8">;
  I16: Refinement<"i16">;
  I32: Refinement<"i32">;
  I64: Refinement<"i64">;
  F32: Refinement<"f32">;
  F64: Refinement<"f64">;
}

// ---------- Runtime helpers ----------
function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function isF32Runtime(v: unknown): v is number {
  return typeof v === "number" && Math.fround(v) === v;
}

// Predicati tipizzati e riusabili
export const Pred: Readonly<NumPredicates> = {
  // Unsigned
  isU8:  (v): v is number => isIntegerInRange(v, 0, 0xFF),
  isU16: (v): v is number => isIntegerInRange(v, 0, 0xFFFF),
  isU32: (v): v is number => isIntegerInRange(v, 0, 0xFFFFFFFF),
  isU64: (v): v is number => isIntegerInRange(v, 0, Number.MAX_SAFE_INTEGER),

  // Signed
  isI8:  (v): v is number => isIntegerInRange(v, -0x80, 0x7F),
  isI16: (v): v is number => isIntegerInRange(v, -0x8000, 0x7FFF),
  isI32: (v): v is number => isIntegerInRange(v, -0x80000000, 0x7FFFFFFF),
  isI64: (v): v is number =>
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= Number.MIN_SAFE_INTEGER &&
    v <= Number.MAX_SAFE_INTEGER,

  // Floats
  isF32: (v): v is number => isF32Runtime(v),
  isF64: (v): v is number => typeof v === "number",
} as const;

// Factory per i refinements
function makeRefinement<TBrand extends string>(
  tag: TBrand,
  isFn: NumberPredicate
): Refinement<TBrand> {
  return {
    is: (v): v is Brand<number, TBrand> => isFn(v),
    as: (v) => {
      if (!isFn(v)) throw new TypeError(`Expected ${tag}, got ${String(v)}`);
      return v as Brand<number, TBrand>;
    },
    try: (v) => (isFn(v) ? (v as Brand<number, TBrand>) : null),
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !isFn(n)) {
        throw new TypeError(`Invalid ${tag} from "${s}"`);
      }
      return n as Brand<number, TBrand>;
    },
  };
}

// Implementazione + tipizzazione esplicita
export const Num: NumAPI = {
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
  U8:  makeRefinement("u8",  Pred.isU8),
  U16: makeRefinement("u16", Pred.isU16),
  U32: makeRefinement("u32", Pred.isU32),
  U64: makeRefinement("u64", Pred.isU64),
  I8:  makeRefinement("i8",  Pred.isI8),
  I16: makeRefinement("i16", Pred.isI16),
  I32: makeRefinement("i32", Pred.isI32),
  I64: makeRefinement("i64", Pred.isI64),
  F32: makeRefinement("f32", Pred.isF32),
  F64: makeRefinement("f64", Pred.isF64),
};
