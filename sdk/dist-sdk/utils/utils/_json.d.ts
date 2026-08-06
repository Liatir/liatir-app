import { AnySchema } from "ajv";
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
    validate<T = unknown>(jsonStr: string, schema?: AnySchema | string): {
        ok: true;
        data: T;
    } | {
        ok: false;
        errors: string[];
    };
    /** Safely parse a JSON string without throwing. */
    parse<T = unknown>(jsonStr: string): {
        ok: true;
        data: T;
    } | {
        ok: false;
        error: string;
    };
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
    diff(a: unknown, b: unknown): Record<string, {
        oldValue: any;
        newValue: any;
    }>;
    /** Summarize a JSON Schema for quick inspection (types, enums, properties). */
    schemaSummary(schema: AnySchema): string;
    /** Infer a minimal JSON Schema from an example value. */
    inferSchema(example: unknown): AnySchema;
}
/**
 * A small toolkit for working with JSON strings.
 *
 * @remarks
 * - The only exported API is this default object `jsonTools`.
 * - All functions are documented with JSDoc so tooltips are shown in IDEs.
 */
export declare const jsonTools: JsonTools;
