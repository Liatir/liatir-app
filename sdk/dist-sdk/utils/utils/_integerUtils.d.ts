export type Brand<Base, Tag extends string> = Base & {
    readonly __brand: Tag;
};
export type U8 = Brand<number, "u8">;
export type U16 = Brand<number, "u16">;
export type U32 = Brand<number, "u32">;
export type U64 = Brand<number, "u64">;
export type I8 = Brand<number, "i8">;
export type I16 = Brand<number, "i16">;
export type I32 = Brand<number, "i32">;
export type I64 = Brand<number, "i64">;
export type F32 = Brand<number, "f32">;
export type F64 = Brand<number, "f64">;
export type NumberPredicate = (v: unknown) => v is number;
export interface NumPredicates {
    isU8: NumberPredicate;
    isU16: NumberPredicate;
    isU32: NumberPredicate;
    isU64: NumberPredicate;
    isI8: NumberPredicate;
    isI16: NumberPredicate;
    isI32: NumberPredicate;
    isI64: NumberPredicate;
    isF32: NumberPredicate;
    isF64: NumberPredicate;
}
export interface Refinement<TBrand extends string> {
    /** Type guard for the branded type. */
    is(v: unknown): v is Brand<number, TBrand>;
    /** Constructor that validates and throws on invalid input. */
    as(v: unknown): Brand<number, TBrand>;
    /** Safe constructor that returns null on invalid input. */
    try(v: unknown): Brand<number, TBrand> | null;
    /** String parser using Number, with validation and throwing on invalid input. */
    parse(s: string): Brand<number, TBrand>;
}
export interface NumAPI extends NumPredicates {
    U8: Refinement<"u8">;
    U16: Refinement<"u16">;
    U32: Refinement<"u32">;
    U64: Refinement<"u64">;
    I8: Refinement<"i8">;
    I16: Refinement<"i16">;
    I32: Refinement<"i32">;
    I64: Refinement<"i64">;
    F32: Refinement<"f32">;
    F64: Refinement<"f64">;
}
export declare const Pred: Readonly<NumPredicates>;
export declare const Num: NumAPI;
