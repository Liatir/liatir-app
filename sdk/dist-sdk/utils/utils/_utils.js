"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dropdownOptionsFromStrings = exports.wait = exports.componentCallbackDispatcher = exports.toggleHiddenStatus = exports.setHiddenStatus = exports.removeWWW = exports.redirectOrReload = exports.getSubdomain = exports.isDev = exports.isWindowAvailable = exports.isBrowser = void 0;
exports.stringStartsWith = stringStartsWith;
exports.validateFile = validateFile;
exports.imageExistsAtURL = imageExistsAtURL;
exports.clearUrl = clearUrl;
exports.checkPasswordStrength = checkPasswordStrength;
exports.capitalize = capitalize;
exports.formSubmit = formSubmit;
exports.capitalizeEachWord = capitalizeEachWord;
exports.parseCookie = parseCookie;
exports.isLocalhost = isLocalhost;
exports.getUrlParam = getUrlParam;
exports.sleep = sleep;
exports.mapToObject = mapToObject;
exports.getRandomNumber = getRandomNumber;
exports.getRandomString = getRandomString;
exports.arrrayGetLast = arrrayGetLast;
exports.getPathList = getPathList;
exports.getCurrentPath = getCurrentPath;
exports.buildPath = buildPath;
exports.detectAnalysisFileType = detectAnalysisFileType;
exports.scrollToElement = scrollToElement;
exports.clickOutside = clickOutside;
exports.toHtmlId = toHtmlId;
exports.toggleArrayItem = toggleArrayItem;
exports.updateUniqueArray = updateUniqueArray;
exports.updateArrayByKey = updateArrayByKey;
exports.toCamelCase = toCamelCase;
exports.toSnakeCase = toSnakeCase;
exports.portal = portal;
exports.isValidTimeStr = isValidTimeStr;
exports.isValidDate = isValidDate;
exports.formatDateForInput = formatDateForInput;
exports.addMinutesToTime = addMinutesToTime;
exports.setTimeForDate = setTimeForDate;
exports.addMinutesToDate = addMinutesToDate;
exports.parseDate = parseDate;
exports.dateToTime24h = dateToTime24h;
exports.dateToTime12h = dateToTime12h;
exports.URLGetParam = URLGetParam;
exports.isSameMonth = isSameMonth;
exports.isSameYear = isSameYear;
exports.getMidpointDate = getMidpointDate;
exports.getYearBounds = getYearBounds;
exports.callerName = callerName;
exports.arrayGetByKey = arrayGetByKey;
exports.checkFileSize = checkFileSize;
exports.getMatchScore = getMatchScore;
exports.objectsDiffer = objectsDiffer;
exports.removeNullish = removeNullish;
exports.flattenObject = flattenObject;
exports.getTimeBounds = getTimeBounds;
exports.listMonthsInRange = listMonthsInRange;
exports.getMonthBoundsByYearMonthString = getMonthBoundsByYearMonthString;
exports.getYearMonthStringFromDate = getYearMonthStringFromDate;
exports.getMonthBounds = getMonthBounds;
exports.mergeByKey = mergeByKey;
exports.removeFromArrayByKey = removeFromArrayByKey;
exports.hexToRgb = hexToRgb;
exports.copyToClipboard = copyToClipboard;
exports.URLReload = URLReload;
exports.flagEmojiToCountryCode = flagEmojiToCountryCode;
exports.sanitizeMessageSensitiveData = sanitizeMessageSensitiveData;
exports.getErrorInfo = getErrorInfo;
exports.serializeToString = serializeToString;
exports.createHashInput = createHashInput;
exports.arrayIncludesString = arrayIncludesString;
const _logger_1 = require("./_logger");
const _regexPatterns_1 = require("./_regexPatterns");
const _typesValidation_1 = require("./_typesValidation");
const isBrowser = () => {
    return typeof window !== "undefined" && typeof document !== "undefined";
};
exports.isBrowser = isBrowser;
const isWindowAvailable = () => {
    return typeof window !== "undefined";
};
exports.isWindowAvailable = isWindowAvailable;
const isDev = () => {
    const isLocalhost = typeof window !== "undefined" &&
        ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const nodeEnv = process?.env?.NODE_ENV;
    return nodeEnv !== "production" || isLocalhost;
};
exports.isDev = isDev;
function stringStartsWith(input, prefix, caseSensitive = false) {
    if (!caseSensitive) {
        return input.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return input.startsWith(prefix);
}
/**
 * Validates a file by checking its MIME type and maximum size.
 * @param file - The file to validate (can be null or undefined).
 * @param maxSizeMB - Maximum allowed size in MB (default: 2).
 * @param allowedTypes - Allowed MIME types (default: empty = all types allowed).
 * @returns Validation result object.
 */
function validateFile(file, maxSizeMB = 2, allowedTypes = []) {
    if (!file) {
        return { valid: false, error: "No file provided." };
    }
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    // MIME type check (only if allowedTypes is not empty)
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
        return {
            valid: false,
            error: `Invalid file type. Allowed types: ${allowedTypes.join(", ")}.`
        };
    }
    // File size check
    if (file.size > maxSizeBytes) {
        return { valid: false, error: `File is too large. Max ${maxSizeMB} MB allowed.` };
    }
    return { valid: true };
}
function imageExistsAtURL(url, bustCache = true) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.referrerPolicy = "no-referrer";
        img.src = bustCache
            ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`
            : url;
    });
}
function clearUrl(input, domainOnly = false) {
    if (!_typesValidation_1.validate.nonEmptyString(input)) {
        console.error(`[invalid url string] ${input}`);
        return null;
    }
    // Rimuove spazi iniziali/finali
    let url = input.trim();
    if (stringStartsWith(url, "http://"))
        url = url?.replace("http://", "https://");
    // Se manca lo schema, aggiunge "https://"
    if (!stringStartsWith(url, "https://"))
        url = "https://" + url;
    try {
        _logger_1.logger.log(`[url to clear] ${url}`);
        const parsed = new URL(url);
        // Facoltativo: normalizza schema e host in lowercase
        parsed.protocol = parsed.protocol.toLowerCase();
        parsed.hostname = parsed.hostname.toLowerCase();
        // Rimuove slash finale superfluo
        if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        const urlParsed = parsed.toString();
        if (!domainOnly)
            return urlParsed;
        else
            return urlParsed?.replace("https://", "");
    }
    catch {
        console.error(`[invalid url] ${input}`);
        return null; // URL non valido
    }
}
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
const getSubdomain = (url) => {
    const hostname = url ? new URL(url).hostname : window.location.hostname;
    const parts = hostname.split(".");
    // Gestisce casi tipo: "builder.bubbledesk.app"
    // Evita problemi su "localhost" o "bubbledesk.app"
    if (parts.length >= 3)
        return parts[0];
    return null;
};
exports.getSubdomain = getSubdomain;
/**
 *
 * @param options.reload If true, redirect url and related logic will be ignored
 */
const redirectOrReload = (options) => {
    if (options?.reload)
        window.location.reload();
    if (!options?.reload && _typesValidation_1.validate.nonEmptyString(options?.redirectUrl)) {
        const redirectUrl = new URL(options?.redirectUrl);
        if (redirectUrl?.href) {
            switch (options?.redirectReplace) {
                case true:
                    window.location.replace(redirectUrl?.href);
                    break;
                default:
                    window.location.href = redirectUrl?.href;
                    break;
            }
        }
    }
};
exports.redirectOrReload = redirectOrReload;
function checkPasswordStrength(password) {
    if (password.length < 8)
        return { text: "very weak", score: 0 };
    let score = 0;
    if (/[a-z]/.test(password))
        score++; // lettere minuscole
    if (/[A-Z]/.test(password))
        score++; // lettere maiuscole
    if (/\d/.test(password))
        score++; // numeri
    if (/[^A-Za-z0-9]/.test(password))
        score++; // simboli
    if (password.length >= 12)
        score++; // lunghezza
    switch (score) {
        case 0:
        case 1:
            return { text: "weak", score: 1 };
        case 2:
            return { text: "medium", score: 2 };
        case 3:
            return { text: "strong", score: 3 };
        case 4:
        case 5:
            return { text: "very strong", score: 4 };
        default:
            return { text: "very weak", score: 0 };
    }
}
function capitalize(str) {
    if (!str)
        return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function formSubmit(callback) {
    return async (event) => {
        event.preventDefault();
        await callback();
    };
}
function capitalizeEachWord(input) {
    return input
        .toLowerCase()
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
function parseCookie(header) {
    return Object.fromEntries(header.split("; ").map((c) => c.split("=")));
}
function isLocalhost() {
    if (typeof window === "undefined")
        return false;
    return window.location.hostname.startsWith("localhost");
}
function getUrlParam(param) {
    if (typeof window === "undefined")
        return null;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}
function sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
const removeWWW = (host) => {
    if (host && typeof host == "string")
        return host.replace(/^www\./, "");
    else
        return null;
};
exports.removeWWW = removeWWW;
function mapToObject(value) {
    try {
        if (value instanceof Map) {
            const obj = {};
            for (const [key, val] of value.entries()) {
                obj[key] = mapToObject(val);
            }
            return obj;
        }
        else if (Array.isArray(value)) {
            return value.map(mapToObject);
        }
        else if (typeof value === "object" && value !== null) {
            const obj = {};
            for (const key in value) {
                obj[key] = mapToObject(value[key]);
            }
            return obj;
        }
        else {
            return value;
        }
    }
    catch (error) {
        _logger_1.logger.error(error);
        return value;
    }
}
function getRandomNumber(min = 0, max = 10000, integer = true) {
    const rand = Math.random() * (max - min) + min;
    return integer ? Math.floor(rand) : rand;
}
function getRandomString(options) {
    const length = options?.length || 6;
    const includeUppercase = options?.includeUppercase || true;
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const upper = includeUppercase ? lower.toUpperCase() : "";
    const chars = lower + digits + upper;
    let result = "";
    for (let i = 0; i < length; i++) {
        const randIndex = Math.floor(Math.random() * chars.length);
        result += chars[randIndex];
    }
    if (options?.prefix)
        return `${options?.prefix}${result}`;
    else
        return result;
}
function arrrayGetLast(arr) {
    return arr.length > 0 ? arr[arr.length - 1] : undefined;
}
function getPathList(path) {
    try {
        if (path)
            return path.split("/");
        return window.location.pathname.split("/");
    }
    catch (error) {
        _logger_1.logger.error(error);
        return null;
    }
}
function getCurrentPath(path) {
    try {
        let pathList = getPathList(path);
        if (pathList)
            return arrrayGetLast(pathList);
        else
            return null;
    }
    catch (error) {
        _logger_1.logger.error(error);
        return null;
    }
}
function buildPath(parts, endIndex) {
    const sliced = endIndex !== undefined ? parts.slice(0, endIndex + 1) : parts;
    return "/" + sliced.filter(Boolean).join("/");
}
function detectAnalysisFileType(filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "vcf":
        case "fasta":
        case "fa":
        case "fastq":
        case "fq":
        case "gtf":
        case "gff":
        case "bed":
        case "csv":
        case "tsv":
            return ext;
        default:
            return "unknown";
    }
}
function scrollToElement(target, offset = 0, scrollBehavior = "auto") {
    let element = null;
    if (typeof target == "string") {
        const normalizedId = target.startsWith("#") ? target.slice(1) : target;
        element = document.getElementById(normalizedId);
    }
    else if (target instanceof HTMLElement) {
        element = target;
    }
    if (!element)
        return;
    const y = element.getBoundingClientRect().top + window.pageYOffset + offset;
    window.scrollTo({
        top: y,
        behavior: scrollBehavior,
    });
}
function clickOutside(node, callback) {
    const handleClick = (event) => {
        if (!node.contains(event.target)) {
            callback();
        }
    };
    document.addEventListener("click", handleClick, true);
    return {
        destroy() {
            document.removeEventListener("click", handleClick, true);
        },
    };
}
const setHiddenStatus = (element, hidden) => {
    let el;
    if (typeof element === "string") {
        el = document.getElementById(element);
    }
    else {
        el = element;
    }
    if (!el) {
        _logger_1.logger.error("Element is null running setHiddenStatus()");
        return;
    }
    if (hidden) {
        el?.classList.add("hidden");
    }
    else {
        el?.classList.remove("hidden");
        setTimeout(() => {
            if (!el)
                return;
            el.focus();
        }, 100);
    }
};
exports.setHiddenStatus = setHiddenStatus;
const toggleHiddenStatus = (element) => {
    let el;
    if (typeof element === "string") {
        el = document.getElementById(element);
    }
    else {
        el = element;
    }
    if (!el) {
        _logger_1.logger.error("Element is null running toggleHiddenStatus()");
        return;
    }
    const hasHidden = el?.classList.contains("hidden");
    if (!hasHidden) {
        el?.classList.add("hidden");
    }
    else {
        el?.classList.remove("hidden");
        setTimeout(() => {
            if (!el)
                return;
            el.focus();
        }, 100);
    }
};
exports.toggleHiddenStatus = toggleHiddenStatus;
function toHtmlId(str) {
    return str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-") // replace spaces with hyphens
        .replace(/[^a-z0-9\-_]/g, "") // remove invalid characters
        .replace(/^-+|-+$/g, ""); // remove leading/trailing hyphens
}
function toggleArrayItem(array, item) {
    return array.includes(item)
        ? array.filter((i) => i !== item) // remove if exists
        : [...array, item]; // add if not present
}
function updateUniqueArray(array, item, action) {
    if (action === "add") {
        return array.includes(item) ? array : [...array, item];
    }
    else {
        return array.filter((i) => i !== item);
    }
}
function updateArrayByKey(array, item, action, key) {
    const referenceKey = (key || "id");
    const index = array.findIndex((el) => el[referenceKey] === item[referenceKey]);
    if (action === "add") {
        if (index === -1) {
            return [...array, item];
        }
        return array;
    }
    if (action === "remove") {
        if (index > -1) {
            return [...array.slice(0, index), ...array.slice(index + 1)];
        }
        return array;
    }
    throw new Error(`Unknown action: ${action}`);
}
function toCamelCase(input) {
    // Normalize separators to space
    const normalized = input.replace(/[_\-\s]+/g, " ").trim();
    // Split by space first
    const roughWords = normalized.split(" ");
    const words = [];
    for (const segment of roughWords) {
        // Split segment by camel case and acronym boundaries
        const parts = segment.match(/([A-Z]+(?=[A-Z][a-z]))|([A-Z]?[a-z]+)|([A-Z]+)|(\d+)/g);
        if (parts)
            words.push(...parts);
    }
    // Rebuild into camelCase
    return words
        .map((word, i) => i === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
}
function toSnakeCase(input) {
    // Normalize separators to space
    const normalized = input.replace(/[_\-\s]+/g, " ").trim();
    // Split by space
    const roughWords = normalized.split(" ");
    const words = [];
    for (const segment of roughWords) {
        // Split segment by camelCase / PascalCase / acronym transitions
        const parts = segment.match(/([A-Z]+(?=[A-Z][a-z]))|([A-Z]?[a-z]+)|([A-Z]+)|(\d+)/g);
        if (parts)
            words.push(...parts);
    }
    return words.map((w) => w.toLowerCase()).join("_");
}
function portal(node, target = document.body) {
    target.appendChild(node);
    return {
        destroy() {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        },
    };
}
function isValidTimeStr(timeStr) {
    if (timeStr.trim() == "")
        return false;
    if (typeof timeStr !== "string")
        return false;
    const parts = timeStr.trim().split(":");
    if (parts.length !== 2)
        return false;
    const [hStr, mStr] = parts;
    if (!/^\d+$/.test(hStr) || !/^\d+$/.test(mStr))
        return false;
    const hours = Number(hStr);
    const minutes = Number(mStr);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
function isValidDate(date) {
    return date && date instanceof Date && !isNaN(date.getTime());
}
function formatDateForInput(date) {
    if (!isValidDate(date)) {
        _logger_1.logger.warn("Invalid 'date' in function 'formatDateForInput(date: Date)'");
        return;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // mesi 0-indexed
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function addMinutesToTime(timeStr, minutesToAdd) {
    if (!isValidTimeStr(timeStr)) {
        _logger_1.logger.error("Invalid 'timeStr' at ddMinutesToTime(timeStr: string, minutesToAdd: number).");
        return;
    }
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0); // set to today, with given time
    date.setMinutes(date.getMinutes() + minutesToAdd); // add minutes
    const newHours = String(date.getHours()).padStart(2, "0");
    const newMinutes = String(date.getMinutes()).padStart(2, "0");
    return `${newHours}:${newMinutes}`;
}
function setTimeForDate(date, timeStr) {
    /*if(!isValidDate(date)) {
          logger.error("Invalid 'date' at setTimeForDate(date: Date, timeStr: string).")
          return;
      };*/
    if (!isValidTimeStr(timeStr)) {
        _logger_1.logger.error("Invalid 'timeStr' at setTimeForDate(date: Date, timeStr: string).");
        return date;
    }
    const [hours, minutes] = timeStr.split(":").map(Number);
    const newDate = new Date(date); // clone to avoid mutating original
    newDate.setHours(hours, minutes, 0, 0);
    newDate.setMinutes(newDate.getMinutes());
    return newDate;
}
function addMinutesToDate(date, minutesToAdd, dateTimeStr) {
    if (!isValidDate(date)) {
        _logger_1.logger.error("Invalid 'date' at addMinutesToDate(date: Date, minutesToAdd: number, dateTimeStr?: string).");
        return;
    }
    let newDate = new Date(date); // clone to avoid mutating original
    if (dateTimeStr && isValidTimeStr(dateTimeStr))
        newDate = setTimeForDate(newDate, dateTimeStr);
    newDate.setMinutes(newDate.getMinutes() + minutesToAdd);
    return newDate;
}
function parseDate(dateStr, fallbackToToday) {
    try {
        if (typeof dateStr !== "string")
            return null;
        // ISO 8601 (safe and recommended)
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(dateStr)) {
            const isoDate = new Date(dateStr);
            return isNaN(isoDate.getTime()) ? null : isoDate;
        }
        // US format MM/DD/YYYY
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
            const [month, day, year] = dateStr.split("/").map(Number);
            const date = new Date(year, month - 1, day);
            return isNaN(date.getTime()) ? null : date;
        }
        // Optional: support DD/MM/YYYY format
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
            const [day, month, year] = dateStr.split("-").map(Number);
            const date = new Date(year, month - 1, day);
            return isNaN(date.getTime()) ? null : date;
        }
    }
    catch (error) {
        _logger_1.logger.devError(error);
    }
    finally {
        if (fallbackToToday) {
            return new Date();
        }
        else {
            // Fallback attempt (not recommended in general)
            return new Date(dateStr);
        }
    }
}
function dateToTime24h(date) {
    if (!_typesValidation_1.validate.date(date))
        return null;
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}
function dateToTime12h(date) {
    if (!(date instanceof Date) || isNaN(date.getTime()))
        return null;
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours === 0 ? 12 : hours; // 0 => 12
    return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}
function URLGetParam(paramName, url = window.location.href) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.searchParams.get(paramName);
    }
    catch (e) {
        return null; // URL malformato
    }
}
function isSameMonth(date1, date2) {
    if (!_typesValidation_1.validate.date(date1) || !_typesValidation_1.validate.date(date2)) {
        _logger_1.logger.devError("One or more dates are invalid at isSameMonth(date1: Date, date2: Date)");
        return false;
    }
    return (date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth());
}
function isSameYear(date1, date2) {
    if (!(date1 instanceof Date) || isNaN(date1.getTime()))
        return false;
    if (!(date2 instanceof Date) || isNaN(date2.getTime()))
        return false;
    return date1.getFullYear() === date2.getFullYear();
}
function getMidpointDate(date1, date2) {
    if (!(date1 instanceof Date) ||
        isNaN(date1.getTime()) ||
        !(date2 instanceof Date) ||
        isNaN(date2.getTime())) {
        throw new Error("Invalid date");
    }
    const time1 = date1.getTime();
    const time2 = date2.getTime();
    const midpoint = (time1 + time2) / 2;
    return new Date(midpoint);
}
function getYearBounds(date) {
    const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const year = d.getFullYear();
    const start = new Date(year, 0, 1, 0, 0, 0, 0); // 1 gennaio alle 00:00
    const end = new Date(year, 11, 31, 23, 59, 59, 999); // 31 dicembre alle 23:59:59.999
    return { start, end };
}
function callerName(level = 2) {
    const err = new Error();
    const stack = err.stack?.split("\n");
    if (stack && stack.length > level) {
        const match = stack[level].trim().match(/^at\s+([^\s(]+)/);
        return match?.[1] || "<anonymous>";
    }
    return "<unknown>";
}
function arrayGetByKey(array, value, key = "id") {
    if (!value)
        return [];
    if (!key)
        return [];
    if (!array)
        return [];
    return array.filter((item) => item[key] === value);
}
function checkFileSize(files, maxSizeMB) {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    let iterable = Array.from(files);
    for (const file of iterable) {
        if (file.size > maxSizeBytes) {
            return {
                valid: false,
                message: `Il file "${file.name}" supera la dimensione massima di ${maxSizeMB} MB.`,
            };
        }
    }
    return { valid: true };
}
function getMatchScore(text, term) {
    if (text === term)
        return 100;
    if (text.startsWith(term))
        return 80;
    if (text.includes(` ${term}`))
        return 60;
    if (text.includes(term))
        return 40;
    return 0;
}
const componentCallbackDispatcher = (callback, data) => {
    if (callback)
        callback(data);
};
exports.componentCallbackDispatcher = componentCallbackDispatcher;
function objectsDiffer(a, b, strict = false) {
    const clean = (obj) => {
        // Rimuove Proxy, getter, reactive wrapper ecc.
        try {
            return structuredClone(obj);
        }
        catch {
            return JSON.parse(JSON.stringify(obj));
        }
    };
    const cleanA = clean(a);
    const cleanB = clean(b);
    return deepCompare(cleanA, cleanB, strict);
}
function deepCompare(a, b, strict) {
    if (a === b)
        return false;
    if (typeof a !== "object" ||
        a === null ||
        typeof b !== "object" ||
        b === null) {
        return a !== b;
    }
    const keys = strict
        ? new Set([...Object.keys(a), ...Object.keys(b)])
        : new Set([...Object.keys(a)].filter((key) => key in b));
    for (const key of keys) {
        const valA = a[key];
        const valB = b[key];
        const bothObjects = typeof valA === "object" &&
            valA !== null &&
            typeof valB === "object" &&
            valB !== null;
        if (bothObjects) {
            if (deepCompare(valA, valB, strict))
                return true;
        }
        else if (valA !== valB) {
            return true;
        }
    }
    return false;
}
function removeNullish(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([_, value]) => value != null));
}
function flattenObject(obj, options = {}) {
    return _flattenObject(obj, options, "", {}, new Set());
}
function _flattenObject(obj, options, _parentKey, _result, _seen) {
    const { useDotNotation = false } = options;
    if (_seen.has(obj)) {
        _result[_parentKey || "[Circular]"] = "[Circular]";
        return _result;
    }
    _seen.add(obj);
    for (const [key, value] of Object.entries(obj)) {
        const isPlainObject = value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !(value instanceof Date);
        const fullKey = useDotNotation && _parentKey ? `${_parentKey}.${key}` : key;
        if (isPlainObject) {
            _flattenObject(value, options, fullKey, _result, _seen);
        }
        else {
            if (useDotNotation) {
                _result[fullKey] = value;
            }
            else {
                _result[key] = value;
            }
        }
    }
    _seen.delete(obj);
    return _result;
}
/**
 * @param normalizeMonthly If true and units is months or years, it will normalize the start and end date to the first and last day of the first and last month.
 */
function getTimeBounds(midpoint, before, after, unit, normalizeMonthly) {
    const center = new Date(midpoint);
    const start = new Date(center);
    const end = new Date(center);
    switch (unit) {
        case "minutes":
            start.setMinutes(start.getMinutes() - before);
            end.setMinutes(end.getMinutes() + after);
            break;
        case "days":
            start.setDate(start.getDate() - before);
            end.setDate(end.getDate() + after);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            break;
        case "months":
            if (normalizeMonthly)
                start.setDate(1); // sicurezza (primo del mese)
            start.setMonth(start.getMonth() - before);
            end.setMonth(end.getMonth() + after);
            if (normalizeMonthly) {
                start.setDate(1);
                end.setMonth(end.getMonth() + 1, 0); // ultimo giorno del mese
            }
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            break;
        case "years":
            if (normalizeMonthly)
                start.setMonth(0, 1); // sicurezza (1 gennaio)
            start.setFullYear(start.getFullYear() - before);
            end.setFullYear(end.getFullYear() + after);
            if (normalizeMonthly) {
                start.setMonth(0, 1); // 1 gennaio
                end.setMonth(12, 0); // 31 dicembre
            }
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            break;
        default:
            throw new Error(`Unsupported unit: ${unit}`);
    }
    return { start, end };
}
function listMonthsInRange(start, end, format = "YYYY-MM", options) {
    const { locale = "en-US", excludeStart = false, excludeEnd = false, descending = false, } = options || {};
    let startDate = new Date(start);
    let endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error("Invalid start or end date");
    }
    // Normalizza inizio e fine al primo giorno del mese
    startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    endDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const months = [];
    let current = new Date(startDate);
    while (current <= endDate) {
        const isStart = current.getTime() === startDate.getTime();
        const isEnd = current.getTime() === endDate.getTime();
        if ((excludeStart && isStart) || (excludeEnd && isEnd)) {
            // salta questo mese
        }
        else {
            const year = current.getFullYear();
            const month = current.getMonth();
            let formatted;
            switch (format) {
                case "YYYY-MM":
                    formatted = `${year}-${String(month + 1).padStart(2, "0")}`;
                    break;
                case "YYYY-MMM":
                    formatted = `${year}-${current.toLocaleString(locale, {
                        month: "short",
                    })}`;
                    break;
                case "YYYY-MMMM":
                    formatted = `${year}-${current.toLocaleString(locale, {
                        month: "long",
                    })}`;
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }
            months.push(formatted);
        }
        current.setMonth(current.getMonth() + 1);
    }
    return descending ? months.reverse() : months;
}
/**
 * @param monthKey (deve essere in formato YYYY-MM)
 * @returns Restituisce un oggetto contente start e end
 */
function getMonthBoundsByYearMonthString(monthKey) {
    const [year, month] = monthKey.split("-").map(Number); // es. 2025, 6
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)); // primo giorno del mese
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)); // ultimo giorno del mese
    return { start, end };
}
/**
 * @returns The month of the passed date as string in the format YYYY-MM (eg. 2025-05), in UTC
 */
function getYearMonthStringFromDate(date) {
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month}`;
}
/**
 * @returns Restituisce un oggetto contente start e end
 */
function getMonthBounds(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-based
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)); // primo giorno del mese
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)); // ultimo giorno del mese
    return { start, end };
}
/**
 * Unisce l'array originale con nuovi oggetti, sovrascrivendo quelli con la stessa chiave.
 * @param original Array originale
 * @param updates Nuovi oggetti da aggiungere o aggiornare
 * @param key Chiave identificativa (default: "id")
 * @returns Nuovo array aggiornato
 */
function mergeByKey(original, updates, key = "id") {
    const map = new Map();
    for (const item of original) {
        map.set(item[key], item);
    }
    for (const item of updates) {
        map.set(item[key], item);
    }
    return Array.from(map.values());
}
/**
 * Rimuove un elemento da un array di oggetti confrontando un campo chiave.
 *
 * @param array - L'array di oggetti da cui rimuovere l'elemento
 * @param value - Il valore da confrontare per la rimozione
 * @param key - Il campo su cui fare il confronto (default: "id")
 * @returns Un nuovo array senza l'elemento corrispondente
 */
function removeFromArrayByKey(array, value, key = "id") {
    if (!_typesValidation_1.validate.array(array))
        throw new Error("Invalid array");
    return array.filter((item) => item[key] !== value);
}
function hexToRgb(hexString) {
    const hex = hexString || "#000000";
    const cleaned = hex.replace(/^#/, "");
    if (![3, 6].includes(cleaned.length))
        return "(0,0,0)";
    const fullHex = cleaned.length === 3
        ? cleaned
            .split("")
            .map((c) => c + c)
            .join("")
        : cleaned;
    const num = parseInt(fullHex, 16);
    return `(${(num >> 16) & 255 || 0},${(num >> 8) & 255 || 0},${num & 255 || 0})`;
}
async function copyToClipboard(text, callback) {
    try {
        await navigator.clipboard.writeText(text);
        _logger_1.logger.log("Text copied to clipboard");
        if (callback)
            callback();
    }
    catch (err) {
        _logger_1.logger.error("Failed to copy text: ", err);
    }
}
/**
 * Reloads the page with the given query parameters if they are not already present or different.
 * Prevents infinite loops by comparing current parameters with target ones.
 * Optionally appends a hash anchor (e.g., #section) for native browser scrolling.
 *
 * @param newParams An object containing key-value pairs to be added to the URL.
 * @param anchor Optional ID of the element to scroll to after reload (e.g. 'comments')
 */
function URLReload(newParams, anchor) {
    const current = new URLSearchParams(window.location.search);
    let changed = false;
    if (!_typesValidation_1.validate.object(newParams)) {
        const hash = anchor ? `#${anchor}` : "";
        location.replace(`${window.location.pathname}${window.location.search}${hash}`);
        return location.reload();
    }
    for (const [key, value] of Object.entries(newParams)) {
        if (current.get(key) !== value) {
            current.set(key, value);
            changed = true;
        }
    }
    const hash = anchor ? `#${anchor}` : "";
    const query = current.toString();
    const newUrl = `${window.location.pathname}?${query}${hash}`;
    window.location.replace(newUrl);
    return location.reload();
}
function flagEmojiToCountryCode(flag) {
    const countryCode = [...flag]
        .map((char) => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 0x61))
        .join("");
    return countryCode.trim().toLowerCase();
}
const wait = (timeout = 100, callback) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            callback?.();
            resolve();
        }, timeout);
    });
};
exports.wait = wait;
const dropdownOptionsFromStrings = (strings) => {
    const options = [];
    const optionsIds = [];
    for (const str of strings) {
        if (!str.trim() || !_typesValidation_1.validate.nonEmptyString(str))
            continue;
        const sluggifiedStr = str
            .trim()
            ?.replaceAll(" ", "_")
            .toLowerCase();
        if (optionsIds?.includes(sluggifiedStr))
            continue;
        optionsIds.push(sluggifiedStr);
        const option = {
            label: str,
            value: sluggifiedStr,
            id: sluggifiedStr,
        };
        options.push(option);
    }
    return options || [];
};
exports.dropdownOptionsFromStrings = dropdownOptionsFromStrings;
/** Redact likely-sensitive data and normalize message */
function sanitizeMessageSensitiveData(msg, maxLen = 300) {
    let s = typeof msg === "string" ? msg : String(msg);
    // Normalize whitespace (flattens multi-line content)
    s = s.replace(_regexPatterns_1.RE_WS, " ").trim();
    // Redactions
    s = s.replace(_regexPatterns_1.RE_EMAIL, "[EMAIL]");
    s = s.replace(_regexPatterns_1.RE_QUERY_SENSITIVE, (_m, sep, k) => `${sep}${k}=[REDACTED]`);
    s = s.replace(_regexPatterns_1.RE_AUTH, (_m, k) => `${k} [REDACTED]`);
    s = s.replace(_regexPatterns_1.RE_AWS_ACCESS_KEY, "[AWS_ACCESS_KEY]");
    s = s.replace(_regexPatterns_1.RE_SECRET40, "[SECRET_40]");
    s = s.replace(_regexPatterns_1.RE_JWT, "[JWT]");
    s = s.replace(_regexPatterns_1.RE_LONG_DIGITS, "[NUMBER]");
    s = s.replace(_regexPatterns_1.RE_PEM_BLOCK, "[PEM]");
    // IPv4 without lookbehind: keep the prefix char (group 1) intact
    s = s.replace(_regexPatterns_1.RE_IPV4_NOLB, (_m, pre) => `${pre}[IP]`);
    // Secrets in URL path segments
    s = s.replace(_regexPatterns_1.RE_PATH_SECRET, (m) => {
        const i = m.lastIndexOf("/");
        return m.slice(0, i + 1) + "[REDACTED]";
    });
    // Truncate
    if (s.length > maxLen)
        s = s.slice(0, maxLen) + "… (truncated)";
    return s;
}
/**
 *
 * @param err The error to extract message and code from
 * @param sanitize Wether to sanitize the error message, removing potential sensitive data
 * @returns Error info in the format of { message, code}
 */
function getErrorInfo(err, sanitize = true) {
    let message;
    let code;
    const pull = (e, depth = 0) => {
        if (!e || depth > 3)
            return;
        // Message from common spots (never use String(e) here)
        if (!message && typeof e.message === "string")
            message = e.message;
        // Common code fields across runtimes/libs
        if (code == null) {
            code =
                e.code ??
                    e.status ??
                    e.statusCode ??
                    e.errorCode ??
                    e.response?.status ??
                    e.body?.status;
        }
        // HTTP/API payload shapes
        if (!message) {
            const m = e.response?.data?.message ??
                e.response?.data?.error?.message ??
                e.data?.message ??
                e.error?.message ??
                e.body?.message;
            if (typeof m === "string")
                message = m;
        }
        // Aggregate/cause chains
        if (!message && Array.isArray(e.errors) && e.errors.length)
            pull(e.errors[0], depth + 1);
        if (!message && e.cause)
            pull(e.cause, depth + 1);
    };
    if (err instanceof Error || (typeof err === "object" && err !== null)) {
        pull(err);
    }
    else if (typeof err === "string") {
        // Only case where we accept String(err): it's already a string.
        message = err;
    }
    // Final fallback: never fabricate by stringifying (could include stack).
    if (!message)
        message = "Unknown error";
    let finalMessage = "";
    if (sanitize)
        finalMessage = sanitizeMessageSensitiveData(message);
    else
        finalMessage = message;
    return code != null ? { message: finalMessage, code } : { message: finalMessage };
}
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
function serializeToString(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof File) {
        // Represent File by stable metadata only, not by its binary content
        return `file:${value.name}:${value.size}:${value.lastModified}`;
    }
    if (Array.isArray(value)) {
        // Serialize each element and preserve order
        return `[${value.map(serializeToString).join(',')}]`;
    }
    if (typeof value === 'object') {
        // Ensure deterministic key order for object properties
        const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
        return `{${entries
            .map(([k, v]) => `${k}:${serializeToString(v)}`)
            .join(',')}}`;
    }
    // Fallback for other types
    return String(value);
}
// Build a deterministic string from an array of values
function createHashInput(values, separator = '|') {
    return values.map(serializeToString).join(separator);
}
function arrayIncludesString(arr, needle, caseSensitive = false) {
    if (!Array.isArray(arr) || typeof needle !== "string")
        return false;
    if (caseSensitive)
        return arr.includes(needle);
    const n = needle.toLowerCase();
    return arr.some((s) => typeof s === "string" && s.toLowerCase() === n);
}
