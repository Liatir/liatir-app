import { CmListenerCallback, CmNode, CmType } from "../../../types";
export declare const CM_TYPES: string[];
export declare function isCmType(value: unknown): value is CmType;
/**
 * Normalize any unknown value into a CmType if possible:
 * - must be a non-empty string
 * - lowercased
 * - whitespace removed
 * - must be one of CM_TYPES
 */
export declare function parseCmType(value: unknown): CmType | null;
/**
 * Return only entries with a valid, normalized type.
 * Does not mutate input entries.
 */
export declare function normalizeEntries(entries: ReadonlyArray<CmNode>): CmNode[];
export declare const initContextMenuListener: (callback: CmListenerCallback, preventDefault?: boolean) => void;
export declare const removeContextMenuListener: () => void;
