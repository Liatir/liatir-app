"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RE_CREDITCARD_GENERIC = exports.RE_IBAN_GENERIC = exports.RE_GIT_COMMIT = exports.RE_SHA256 = exports.RE_SHA1 = exports.RE_JWT = exports.RE_BASE64 = exports.RE_ULID = exports.RE_UUID_V4 = exports.RE_UUID_ANY = exports.RE_TZ_OFFSET = exports.RE_DATE_MMDDYYYY = exports.RE_DATE_DDMMYYYY = exports.RE_DATETIME_ISO = exports.RE_TIME_12H = exports.RE_TIME_24H = exports.RE_DATE_ISO = exports.RE_E164_PHONE = exports.RE_HOSTPORT = exports.RE_MAC = exports.RE_IPV6_SIMPLE = exports.RE_IPV4 = exports.RE_URL_SIMPLE = exports.RE_URL_HTTP = exports.RE_DOMAIN = exports.RE_EMAIL = exports.RE_HSLA = exports.RE_HSL = exports.RE_RGBA = exports.RE_RGB = exports.RE_HEX_COLOR = exports.RE_HEX_PREFIXED = exports.RE_NUMBER_THOUSANDS = exports.RE_FLOAT = exports.RE_INT = exports.RE_MENTION = exports.RE_HASHTAG = exports.RE_USERNAME_SIMPLE = exports.RE_SLUG = exports.RE_NON_WORD = exports.RE_WHITESPACE = exports.RE_PEM_BLOCK = exports.RE_PATH_SECRET = exports.RE_IPV4_NOLB = exports.RE_LONG_DIGITS = exports.RE_SECRET40 = exports.RE_AWS_ACCESS_KEY = exports.RE_AUTH = exports.RE_QUERY_SENSITIVE = exports.RE_WS = void 0;
exports.RE_VAT_PT = exports.RE_VAT_PL = exports.RE_VAT_NL = exports.RE_VAT_MT = exports.RE_VAT_LU = exports.RE_VAT_LT = exports.RE_VAT_LV = exports.RE_VAT_IT = exports.RE_VAT_IE = exports.RE_VAT_HU = exports.RE_VAT_EL = exports.RE_VAT_DE = exports.RE_VAT_FR = exports.RE_VAT_FI = exports.RE_VAT_EE = exports.RE_VAT_DK = exports.RE_VAT_CZ = exports.RE_VAT_CY = exports.RE_VAT_HR = exports.RE_VAT_BG = exports.RE_VAT_BE = exports.RE_VAT_AT = exports.RE_PEC_GENERIC = exports.RE_PEC_IT_STRICT = exports.RE_PIVA_IT = exports.RE_CF_IT_OMOCODIA = exports.RE_CF_IT_STRICT = exports.RE_IPV6 = exports.RE_PASSWORD_STRONG = exports.RE_CSV_LINE = exports.RE_HTML_TAG = exports.RE_KEBAB_CASE = exports.RE_SNAKE_CASE = exports.RE_PASCAL_CASE = exports.RE_CAMEL_CASE = exports.RE_LATLON_PAIR = exports.RE_LON = exports.RE_LAT = exports.RE_MIME_TYPE = exports.RE_EXTENSION = exports.RE_WINDOWS_PATH = exports.RE_UNIX_PATH = exports.RE_FILENAME_SAFE = exports.RE_POSTCODE_UK_APPROX = exports.RE_CAP_IT = exports.RE_ZIP_US = exports.RE_PERCENT = exports.RE_CURRENCY_GENERIC = exports.RE_MASTERCARD = exports.RE_VISA = void 0;
exports.RE_SEMVER_RANGE_COMPARATORS = exports.RE_SEMVER_RANGE_SIMPLE = exports.RE_SEMVER = exports.RE_R2_S3_COMPAT_URL = exports.RE_R2_PUBLIC_URL = exports.RE_S3_PATH_URL = exports.RE_S3_VHOST_URL = exports.RE_S3_URI = exports.RE_VAT_SE = exports.RE_VAT_ES = exports.RE_VAT_SI = exports.RE_VAT_SK = exports.RE_VAT_RO = void 0;
// ===== Generice sensitive data =====
exports.RE_WS = /\s+/g;
exports.RE_QUERY_SENSITIVE = /([?&])(token|api[_-]?key|key|signature|password|pass|pwd|code|secret|client[_-]?secret|access[_-]?token)=([^&#\s]+)/gi;
exports.RE_AUTH = /\b(authorization|bearer|basic)\b[: ]+\S+/gi;
exports.RE_AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
exports.RE_SECRET40 = /\b[A-Za-z0-9/+]{40}\b/g; // may overmatch harmless 40-char base64
exports.RE_LONG_DIGITS = /\b(?:\d[ -]?){13,19}\b/g; // potential cards/accounts
exports.RE_IPV4_NOLB = /(^|[^0-9])((?:\d{1,3}\.){3}\d{1,3})(?!\d)/g; // no lookbehind
exports.RE_PATH_SECRET = /\/(token|key|secret|signature|passwd|password|code)\/[^\/?#\s]+/gi;
exports.RE_PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
// ===== Text / tokens =====
exports.RE_WHITESPACE = /\s+/g;
exports.RE_NON_WORD = /\W+/g;
exports.RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
exports.RE_USERNAME_SIMPLE = /^[A-Z0-9_]{3,20}$/i;
exports.RE_HASHTAG = /(^|\s)#([A-Z0-9_]{1,30})/gi;
exports.RE_MENTION = /(^|[^@\w])@([A-Z0-9_]{1,30})/gi;
// ===== Numbers / formats =====
exports.RE_INT = /^[+-]?\d+$/;
exports.RE_FLOAT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
exports.RE_NUMBER_THOUSANDS = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?$/;
exports.RE_HEX_PREFIXED = /^0x[0-9A-F]+$/i;
// ===== Colors (CSS) =====
exports.RE_HEX_COLOR = /^#(?:[0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i;
exports.RE_RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
exports.RE_RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;
exports.RE_HSL = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/i;
exports.RE_HSLA = /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*(0|1|0?\.\d+)\s*\)$/i;
// ===== Web / networking =====
exports.RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
exports.RE_DOMAIN = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i;
exports.RE_URL_HTTP = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;
exports.RE_URL_SIMPLE = /^(https?:\/\/)?(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?:\/[^\s]*)?$/i;
exports.RE_IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
exports.RE_IPV6_SIMPLE = /^([A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i; // no '::' compression
exports.RE_MAC = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;
exports.RE_HOSTPORT = /^(?:\[(?:[A-F0-9:]+)\]|(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Z0-9-]+\.)+[A-Z]{2,})(?::\d{1,5})?$/i;
exports.RE_E164_PHONE = /^\+?[1-9]\d{1,14}$/;
// ===== Dates / times =====
exports.RE_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
exports.RE_TIME_24H = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
exports.RE_TIME_12H = /^(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s?(?:AM|PM)$/i;
exports.RE_DATETIME_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
exports.RE_DATE_DDMMYYYY = /^(0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-]\d{4}$/;
exports.RE_DATE_MMDDYYYY = /^(0?[1-9]|1[0-2])[\/.-](0?[1-9]|[12]\d|3[01])[\/.-]\d{4}$/;
exports.RE_TZ_OFFSET = /^[+-](?:0\d|1[0-4]):[0-5]\d$/; // ±HH:MM (up to 14)
// ===== Identifiers / encodings =====
exports.RE_UUID_ANY = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
exports.RE_UUID_V4 = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
exports.RE_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
exports.RE_BASE64 = /^(?:[A-Z0-9+\/]{4})*(?:[A-Z0-9+\/]{2}==|[A-Z0-9+\/]{3}=)?$/i;
exports.RE_JWT = /\b([A-Za-z0-9-_]{10,})\.([A-Za-z0-9-_]{10,})(?:\.([A-Za-z0-9-_]{5,}))?\b/g;
exports.RE_SHA1 = /^[A-F0-9]{40}$/i;
exports.RE_SHA256 = /^[A-F0-9]{64}$/i;
exports.RE_GIT_COMMIT = /^[0-9A-F]{7,40}$/i;
exports.RE_IBAN_GENERIC = /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/;
// ===== Payment-like (approximate) =====
exports.RE_CREDITCARD_GENERIC = /^(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|3(?:0[0-5]|[68]\d)\d{11}|6(?:011|5\d{2})\d{12})$/;
exports.RE_VISA = /^4\d{12}(\d{3})?$/;
exports.RE_MASTERCARD = /^(5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d{2}|7(?:[01]\d|20))\d{12})$/;
// ===== Currency / amounts =====
exports.RE_CURRENCY_GENERIC = /^(?:[A-Z]{3}|[$€£])\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?$/;
exports.RE_PERCENT = /^(?:100(?:\.0+)?|(?:\d{1,2})(?:\.\d+)?)%$/;
// ===== Postal codes (examples) =====
exports.RE_ZIP_US = /^\d{5}(?:-\d{4})?$/;
exports.RE_CAP_IT = /^\d{5}$/;
exports.RE_POSTCODE_UK_APPROX = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
// ===== File paths / names =====
exports.RE_FILENAME_SAFE = /^[A-Z0-9._-]+$/i;
exports.RE_UNIX_PATH = /^(\/[^/\0]+)+\/?$/;
exports.RE_WINDOWS_PATH = /^(?:[A-Z]:\\|\\\\)[^\s<>:"|?*]+$/i;
exports.RE_EXTENSION = /^[^.]+\.[A-Z0-9]+$/i;
exports.RE_MIME_TYPE = /^[a-z]+\/[a-z0-9+.-]+$/i;
// ===== Coordinates =====
exports.RE_LAT = /^-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)$/;
exports.RE_LON = /^-?(?:1[0-7]\d(?:\.\d+)?|[1-9]?\d(?:\.\d+)?|180(?:\.0+)?)$/;
exports.RE_LATLON_PAIR = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/;
// ===== Case styles =====
exports.RE_CAMEL_CASE = /^(?:[a-z]+(?:[A-Z][a-z0-9]+)*)$/;
exports.RE_PASCAL_CASE = /^(?:[A-Z][a-z0-9]+)+$/;
exports.RE_SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
exports.RE_KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
// ===== HTML / CSV =====
exports.RE_HTML_TAG = /<[^>]+>/;
exports.RE_CSV_LINE = /^(?:"[^"]*"|[^",]*)(?:,(?:"[^"]*"|[^",]*))*$/;
// ===== Password policy (example) =====
exports.RE_PASSWORD_STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
// ===== IP addresses =====
exports.RE_IPV6 = /^((?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:){1,7}:|(?:[A-F0-9]{1,4}:){1,6}:[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:){1,5}(?::[A-F0-9]{1,4}){1,2}|(?:[A-F0-9]{1,4}:){1,4}(?::[A-F0-9]{1,4}){1,3}|(?:[A-F0-9]{1,4}:){1,3}(?::[A-F0-9]{1,4}){1,4}|(?:[A-F0-9]{1,4}:){1,2}(?::[A-F0-9]{1,4}){1,5}|[A-F0-9]{1,4}:(?::[A-F0-9]{1,4}){1,6}|:(?::[A-F0-9]{1,4}){1,7})(?:%\w+)?$/i; // compressed + zone id
// ===== Italy: Codice Fiscale & Partita IVA =====
// Strict (no "omocodia" substitutions)
exports.RE_CF_IT_STRICT = /^[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/;
// Omocodia allowed (L,M,N,P,Q,R,S,T,U,V standing in for digits)
exports.RE_CF_IT_OMOCODIA = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
// Partita IVA (11 digits), with optional "IT" prefix
exports.RE_PIVA_IT = /^(?:IT\s*)?\d{11}$/i;
// ===== PEC (Posta Elettronica Certificata) =====
exports.RE_PEC_IT_STRICT = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.PEC\.IT$/i; // ends with .pec.it
exports.RE_PEC_GENERIC = /^[A-Z0-9._%+-]+@[A-Z0-9.-]*\.PEC\.[A-Z]{2,}$/i; // any TLD with ".pec."
// ===== EU VAT (per country; pragmatic patterns) =====
exports.RE_VAT_AT = /^ATU\d{8}$/; // Austria
exports.RE_VAT_BE = /^BE0?\d{9}$/; // Belgium
exports.RE_VAT_BG = /^BG\d{9,10}$/; // Bulgaria
exports.RE_VAT_HR = /^HR\d{11}$/; // Croatia
exports.RE_VAT_CY = /^CY\d{8}[A-Z]$/i; // Cyprus
exports.RE_VAT_CZ = /^CZ\d{8,10}$/; // Czechia
exports.RE_VAT_DK = /^DK\d{8}$/; // Denmark
exports.RE_VAT_EE = /^EE\d{9}$/; // Estonia
exports.RE_VAT_FI = /^FI\d{8}$/; // Finland
exports.RE_VAT_FR = /^FR[0-9A-Z]{2}\d{9}$/i; // France (2-char key + 9 digits)
exports.RE_VAT_DE = /^DE\d{9}$/; // Germany
exports.RE_VAT_EL = /^EL\d{9}$/; // Greece (EL)
exports.RE_VAT_HU = /^HU\d{8}$/; // Hungary
exports.RE_VAT_IE = /^IE\d{7}[A-W][A-I]?$/i; // Ireland (approx)
exports.RE_VAT_IT = /^IT\d{11}$/; // Italy
exports.RE_VAT_LV = /^LV\d{11}$/; // Latvia
exports.RE_VAT_LT = /^LT(\d{9}|\d{12})$/; // Lithuania
exports.RE_VAT_LU = /^LU\d{8}$/; // Luxembourg
exports.RE_VAT_MT = /^MT\d{8}$/; // Malta
exports.RE_VAT_NL = /^NL\d{9}B\d{2}$/; // Netherlands
exports.RE_VAT_PL = /^PL\d{10}$/; // Poland
exports.RE_VAT_PT = /^PT\d{9}$/; // Portugal
exports.RE_VAT_RO = /^RO\d{2,10}$/; // Romania
exports.RE_VAT_SK = /^SK\d{10}$/; // Slovakia
exports.RE_VAT_SI = /^SI\d{8}$/; // Slovenia
exports.RE_VAT_ES = /^ES[A-Z0-9]\d{7}[A-Z0-9]$/i; // Spain
exports.RE_VAT_SE = /^SE\d{12}$/; // Sweden
// ===== S3 / R2 object URLs & URIs =====
// S3 URI like: s3://bucket/key
exports.RE_S3_URI = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+$/;
// S3 virtual-hosted–style: https://bucket.s3.amazonaws.com/key (any region suffix acceptable)
exports.RE_S3_VHOST_URL = /^https?:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3[.-][a-z0-9-]+\.amazonaws\.com\/.+$/i;
// S3 path-style: https://s3.region.amazonaws.com/bucket/key
exports.RE_S3_PATH_URL = /^https?:\/\/s3[.-][a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+$/i;
// R2 public (account endpoint): https://<accountid>.r2.cloudflarestorage.com/bucket/key
exports.RE_R2_PUBLIC_URL = /^https?:\/\/[a-z0-9]{32}\.r2\.cloudflarestorage\.com\/[A-Za-z0-9._-]{3,63}\/.+$/;
// R2 S3-compatible (custom endpoint host): https?:\/\/<host>/bucket/key  — keep broad
exports.RE_R2_S3_COMPAT_URL = /^https?:\/\/[A-Z0-9.-]+\/[A-Za-z0-9._-]{3,63}\/.+$/i;
// ===== SemVer (versions & ranges) =====
// Exact SemVer (same as before, strict)
exports.RE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?$/i;
// Simple ranges with ^ or ~ and OR (pragmatic)
exports.RE_SEMVER_RANGE_SIMPLE = /^(?:[~^]?\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?)(?:\s*\|\|\s*[~^]?\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?)*$/i;
// Comparators like >=1.2.3 <2.0.0 (basic)
exports.RE_SEMVER_RANGE_COMPARATORS = /^(?:[<>]=?\s*\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?\s*)+(?:\|\|\s*(?:[<>]=?\s*\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?\s*)+)*$/i;
