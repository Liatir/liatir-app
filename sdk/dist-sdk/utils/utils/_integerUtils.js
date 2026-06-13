"use strict";
// numberUtils.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Num = exports.Pred = void 0;
// ---------- Runtime helpers ----------
function isIntegerInRange(v, min, max) {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function isF32Runtime(v) {
    return typeof v === "number" && Math.fround(v) === v;
}
// Predicati tipizzati e riusabili
exports.Pred = {
    // Unsigned
    isU8: (v) => isIntegerInRange(v, 0, 0xFF),
    isU16: (v) => isIntegerInRange(v, 0, 0xFFFF),
    isU32: (v) => isIntegerInRange(v, 0, 0xFFFFFFFF),
    isU64: (v) => isIntegerInRange(v, 0, Number.MAX_SAFE_INTEGER),
    // Signed
    isI8: (v) => isIntegerInRange(v, -0x80, 0x7F),
    isI16: (v) => isIntegerInRange(v, -0x8000, 0x7FFF),
    isI32: (v) => isIntegerInRange(v, -0x80000000, 0x7FFFFFFF),
    isI64: (v) => typeof v === "number" &&
        Number.isInteger(v) &&
        v >= Number.MIN_SAFE_INTEGER &&
        v <= Number.MAX_SAFE_INTEGER,
    // Floats
    isF32: (v) => isF32Runtime(v),
    isF64: (v) => typeof v === "number",
};
// Factory per i refinements
function makeRefinement(tag, isFn) {
    return {
        is: (v) => isFn(v),
        as: (v) => {
            if (!isFn(v))
                throw new TypeError(`Expected ${tag}, got ${String(v)}`);
            return v;
        },
        try: (v) => (isFn(v) ? v : null),
        parse: (s) => {
            const n = Number(s);
            if (!Number.isFinite(n) || !isFn(n)) {
                throw new TypeError(`Invalid ${tag} from "${s}"`);
            }
            return n;
        },
    };
}
// Implementazione + tipizzazione esplicita
exports.Num = {
    // Predicates (stile number.is...)
    isU8: exports.Pred.isU8,
    isU16: exports.Pred.isU16,
    isU32: exports.Pred.isU32,
    isU64: exports.Pred.isU64,
    isI8: exports.Pred.isI8,
    isI16: exports.Pred.isI16,
    isI32: exports.Pred.isI32,
    isI64: exports.Pred.isI64,
    isF32: exports.Pred.isF32,
    isF64: exports.Pred.isF64,
    // Branded constructors / refiners
    U8: makeRefinement("u8", exports.Pred.isU8),
    U16: makeRefinement("u16", exports.Pred.isU16),
    U32: makeRefinement("u32", exports.Pred.isU32),
    U64: makeRefinement("u64", exports.Pred.isU64),
    I8: makeRefinement("i8", exports.Pred.isI8),
    I16: makeRefinement("i16", exports.Pred.isI16),
    I32: makeRefinement("i32", exports.Pred.isI32),
    I64: makeRefinement("i64", exports.Pred.isI64),
    F32: makeRefinement("f32", exports.Pred.isF32),
    F64: makeRefinement("f64", exports.Pred.isF64),
};
