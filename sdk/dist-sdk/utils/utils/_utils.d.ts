import type { AnyObject, DropdownOption, HexColor, PasswordStrength } from "../shared/_types";
export declare const isBrowser: () => boolean;
export declare const isWindowAvailable: () => boolean;
export declare const isDev: () => boolean;
export declare function stringStartsWith(input: string, prefix: string, caseSensitive?: boolean): boolean;
type FileValidationResult = {
    valid: boolean;
    error?: string;
};
/**
 * Validates a file by checking its MIME type and maximum size.
 * @param file - The file to validate (can be null or undefined).
 * @param maxSizeMB - Maximum allowed size in MB (default: 2).
 * @param allowedTypes - Allowed MIME types (default: empty = all types allowed).
 * @returns Validation result object.
 */
export declare function validateFile(file: File | Blob | null | undefined, maxSizeMB?: number, allowedTypes?: string[]): FileValidationResult;
export declare function imageExistsAtURL(url: string, bustCache?: boolean): Promise<boolean>;
export declare function clearUrl(input: string, domainOnly?: boolean): string | null;
/**
 * Estrae il sottodominio da un URL o dal dominio corrente (es. builder.bubbledesk.app → "builder").
 *
 * ⚠️ Restituisce `null` se non è presente alcun sottodominio (es. bubbledesk.app o localhost).
 *
 * @param url - (opzionale) Una stringa URL da cui estrarre il sottodominio. Se non fornita, usa `window.location.hostname`.
 * @returns Il sottodominio come stringa, oppure `null` se non rilevabile.
 *
 * @example
 * getSubdomain("https://auth.bubbledesk.app"); // "auth"
 * getSubdomain(); // se eseguito su builder.bubbledesk.app → "builder"
 * getSubdomain("https://bubbledesk.app"); // null
 * getSubdomain("http://localhost:5173"); // null
 */
export declare const getSubdomain: (url?: string) => string | null;
/**
 *
 * @param options.reload If true, redirect url and related logic will be ignored
 */
export declare const redirectOrReload: (options?: {
    redirectUrl?: string;
    reload?: boolean;
    redirectReplace?: boolean;
}) => void;
export declare function checkPasswordStrength(password: string): PasswordStrength;
export declare function capitalize(str: string): string;
export declare function formSubmit(callback: () => void | Promise<void>): (event: SubmitEvent) => Promise<void>;
export declare function capitalizeEachWord(input: string): string;
export declare function parseCookie(header: string): Record<string, string>;
export declare function isLocalhost(): boolean;
export declare function getUrlParam(param: string): string | null;
export declare function sleep(seconds: number): Promise<void>;
export declare const removeWWW: (host: string | null) => string | null;
export declare function mapToObject(value: any): any;
export declare function getRandomNumber(min?: number, max?: number, integer?: boolean): number;
export declare function getRandomString(options?: {
    length?: number;
    includeUppercase?: boolean;
    prefix?: string;
}): string;
export declare function arrrayGetLast<T>(arr: T[]): T | undefined;
export declare function getPathList(path?: string): string[] | null | undefined;
export declare function getCurrentPath(path?: string): string | null | undefined;
export declare function buildPath(parts: string[], endIndex?: number): string;
export declare function detectAnalysisFileType(filename: string): string;
export declare function scrollToElement(target: string | HTMLElement, offset?: number, scrollBehavior?: ScrollBehavior): void;
export declare function clickOutside(node: HTMLElement, callback: () => void): {
    destroy(): void;
};
export declare const setHiddenStatus: (element: string | HTMLElement, hidden: boolean) => void;
export declare const toggleHiddenStatus: (element: string | HTMLElement) => void;
export declare function toHtmlId(str: string): string;
export declare function toggleArrayItem<T>(array: T[], item: T): T[];
export declare function updateUniqueArray<T>(array: T[], item: T, action: "add" | "remove"): T[];
export declare function updateArrayByKey<T, K extends keyof T>(array: T[], item: T, action: "add" | "remove", key?: K): T[];
export declare function toCamelCase(input: string): string;
export declare function toSnakeCase(input: string): string;
export declare function portal(node: HTMLElement, target?: HTMLElement): {
    destroy(): void;
};
export declare function isValidTimeStr(timeStr: string): boolean;
export declare function isValidDate(date: Date): boolean;
export declare function formatDateForInput(date: Date): string | undefined;
export declare function addMinutesToTime(timeStr: string, minutesToAdd: number): string | undefined;
export declare function setTimeForDate(date: Date, timeStr: string): Date;
export declare function addMinutesToDate(date: Date, minutesToAdd: number, dateTimeStr?: string): Date | undefined;
export declare function parseDate(dateStr: string, fallbackToToday?: boolean): Date | null;
export declare function dateToTime24h(date: Date): string | null;
export declare function dateToTime12h(date: Date): string | null;
export declare function URLGetParam(paramName: string, url?: string): string | null;
export declare function isSameMonth(date1: Date, date2: Date): boolean;
export declare function isSameYear(date1: unknown, date2: unknown): boolean;
export declare function getMidpointDate(date1: Date, date2: Date): Date;
export declare function getYearBounds(date?: Date): {
    start: Date;
    end: Date;
};
export declare function callerName(level?: number): string;
export declare function arrayGetByKey<T, K extends keyof T>(array: T[], value: T[K], key?: K): T[];
export declare function checkFileSize(files: FileList | File[], maxSizeMB: number): {
    valid: boolean;
    message?: string;
};
export declare function getMatchScore(text: string, term: string): number;
export declare const componentCallbackDispatcher: (callback: Function, data?: any) => void;
export declare function objectsDiffer<T extends Record<string, any>>(a: Partial<T>, b: Partial<T>, strict?: boolean): boolean;
export declare function removeNullish<T extends object>(obj: T): Partial<T>;
type FlattenOptions = {
    useDotNotation?: boolean;
};
export declare function flattenObject(obj: Record<string, any>, options?: FlattenOptions): Record<string, any>;
/**
 * @param normalizeMonthly If true and units is months or years, it will normalize the start and end date to the first and last day of the first and last month.
 */
export declare function getTimeBounds(midpoint: Date | string, before: number, after: number, unit: "minutes" | "days" | "months" | "years", normalizeMonthly?: boolean): {
    start: Date;
    end: Date;
};
export declare function listMonthsInRange(start: Date | string, end: Date | string, format?: "YYYY-MM" | "YYYY-MMM" | "YYYY-MMMM", options?: {
    locale?: string;
    excludeStart?: boolean;
    excludeEnd?: boolean;
    descending?: boolean;
}): string[];
/**
 * @param monthKey (deve essere in formato YYYY-MM)
 * @returns Restituisce un oggetto contente start e end
 */
export declare function getMonthBoundsByYearMonthString(monthKey: string): {
    start: Date;
    end: Date;
};
/**
 * @returns The month of the passed date as string in the format YYYY-MM (eg. 2025-05), in UTC
 */
export declare function getYearMonthStringFromDate(date: Date): string;
/**
 * @returns Restituisce un oggetto contente start e end
 */
export declare function getMonthBounds(date: Date): {
    start: Date;
    end: Date;
};
/**
 * Unisce l'array originale con nuovi oggetti, sovrascrivendo quelli con la stessa chiave.
 * @param original Array originale
 * @param updates Nuovi oggetti da aggiungere o aggiornare
 * @param key Chiave identificativa (default: "id")
 * @returns Nuovo array aggiornato
 */
export declare function mergeByKey<T extends AnyObject>(original: T[], updates: T[], key?: keyof T): T[];
/**
 * Rimuove un elemento da un array di oggetti confrontando un campo chiave.
 *
 * @param array - L'array di oggetti da cui rimuovere l'elemento
 * @param value - Il valore da confrontare per la rimozione
 * @param key - Il campo su cui fare il confronto (default: "id")
 * @returns Un nuovo array senza l'elemento corrispondente
 */
export declare function removeFromArrayByKey<T extends Record<string, any>>(array: T[], value: any, key?: string): T[];
export declare function hexToRgb(hexString?: HexColor): string | "";
export declare function copyToClipboard(text: string, callback?: Function): Promise<void>;
/**
 * Reloads the page with the given query parameters if they are not already present or different.
 * Prevents infinite loops by comparing current parameters with target ones.
 * Optionally appends a hash anchor (e.g., #section) for native browser scrolling.
 *
 * @param newParams An object containing key-value pairs to be added to the URL.
 * @param anchor Optional ID of the element to scroll to after reload (e.g. 'comments')
 */
export declare function URLReload(newParams?: Record<string, string>, anchor?: string): void;
export declare function flagEmojiToCountryCode(flag: string): string;
export declare const wait: (timeout?: number, callback?: VoidFunction) => Promise<void>;
export declare const dropdownOptionsFromStrings: (strings: string[]) => DropdownOption[];
/** Redact likely-sensitive data and normalize message */
export declare function sanitizeMessageSensitiveData(msg: string, maxLen?: number): string;
type ErrorInfo = {
    message: string;
    code?: string | number;
};
/**
 *
 * @param err The error to extract message and code from
 * @param sanitize Wether to sanitize the error message, removing potential sensitive data
 * @returns Error info in the format of { message, code}
 */
export declare function getErrorInfo(err: unknown, sanitize?: boolean): ErrorInfo;
/**
 * Serializes an arbitrary values into a deterministic, hash-friendly string.
 *
 * - Objects are serialized with sorted keys to ensure stable ordering.
 * - Arrays are serialized by preserving element order.
 * - Dates are converted to ISO strings.
 * - Files are represented by stable metadata (name, size, lastModified).
 *
 * @param value - The value or values to serialize.
 * @returns A deterministic string representation.
 */
export declare function serializeToString(value: unknown): string;
export declare function createHashInput(values: unknown[], separator?: string): string;
export declare function arrayIncludesString(arr: string[], needle: string, caseSensitive?: boolean): boolean;
export {};
