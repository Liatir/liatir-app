
// ===== Generice sensitive data =====
export const RE_WS = /\s+/g;
export const RE_QUERY_SENSITIVE = /([?&])(token|api[_-]?key|key|signature|password|pass|pwd|code|secret|client[_-]?secret|access[_-]?token)=([^&#\s]+)/gi;
export const RE_AUTH = /\b(authorization|bearer|basic)\b[: ]+\S+/gi;
export const RE_AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
export const RE_SECRET40 = /\b[A-Za-z0-9/+]{40}\b/g; // may overmatch harmless 40-char base64
export const RE_LONG_DIGITS = /\b(?:\d[ -]?){13,19}\b/g; // potential cards/accounts
export const RE_IPV4_NOLB = /(^|[^0-9])((?:\d{1,3}\.){3}\d{1,3})(?!\d)/g; // no lookbehind
export const RE_PATH_SECRET = /\/(token|key|secret|signature|passwd|password|code)\/[^\/?#\s]+/gi;
export const RE_PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;

// ===== Text / tokens =====
export const RE_WHITESPACE = /\s+/g;
export const RE_NON_WORD = /\W+/g;
export const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RE_USERNAME_SIMPLE = /^[A-Z0-9_]{3,20}$/i;
export const RE_HASHTAG = /(^|\s)#([A-Z0-9_]{1,30})/gi;
export const RE_MENTION = /(^|[^@\w])@([A-Z0-9_]{1,30})/gi;

// ===== Numbers / formats =====
export const RE_INT = /^[+-]?\d+$/;
export const RE_FLOAT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
export const RE_NUMBER_THOUSANDS = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?$/;
export const RE_HEX_PREFIXED = /^0x[0-9A-F]+$/i;

// ===== Colors (CSS) =====
export const RE_HEX_COLOR = /^#(?:[0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i;
export const RE_RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
export const RE_RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;
export const RE_HSL = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/i;
export const RE_HSLA = /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

// ===== Web / networking =====
export const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
export const RE_DOMAIN = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i;
export const RE_URL_HTTP = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;
export const RE_URL_SIMPLE = /^(https?:\/\/)?(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?:\/[^\s]*)?$/i;
export const RE_IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const RE_IPV6_SIMPLE = /^([A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i; // no '::' compression
export const RE_MAC = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;
export const RE_HOSTPORT = /^(?:\[(?:[A-F0-9:]+)\]|(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Z0-9-]+\.)+[A-Z]{2,})(?::\d{1,5})?$/i;
export const RE_E164_PHONE = /^\+?[1-9]\d{1,14}$/;

// ===== Dates / times =====
export const RE_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
export const RE_TIME_24H = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
export const RE_TIME_12H = /^(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s?(?:AM|PM)$/i;
export const RE_DATETIME_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export const RE_DATE_DDMMYYYY = /^(0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-]\d{4}$/;
export const RE_DATE_MMDDYYYY = /^(0?[1-9]|1[0-2])[\/.-](0?[1-9]|[12]\d|3[01])[\/.-]\d{4}$/;
export const RE_TZ_OFFSET = /^[+-](?:0\d|1[0-4]):[0-5]\d$/; // ±HH:MM (up to 14)

// ===== Identifiers / encodings =====
export const RE_UUID_ANY = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
export const RE_UUID_V4 = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
export const RE_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export const RE_BASE64 = /^(?:[A-Z0-9+\/]{4})*(?:[A-Z0-9+\/]{2}==|[A-Z0-9+\/]{3}=)?$/i;
export const RE_JWT = /\b([A-Za-z0-9-_]{10,})\.([A-Za-z0-9-_]{10,})(?:\.([A-Za-z0-9-_]{5,}))?\b/g;
export const RE_SHA1 = /^[A-F0-9]{40}$/i;
export const RE_SHA256 = /^[A-F0-9]{64}$/i;
export const RE_GIT_COMMIT = /^[0-9A-F]{7,40}$/i;
export const RE_IBAN_GENERIC = /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/;

// ===== Payment-like (approximate) =====
export const RE_CREDITCARD_GENERIC = /^(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|3(?:0[0-5]|[68]\d)\d{11}|6(?:011|5\d{2})\d{12})$/;
export const RE_VISA = /^4\d{12}(\d{3})?$/;
export const RE_MASTERCARD = /^(5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d{2}|7(?:[01]\d|20))\d{12})$/;

// ===== Currency / amounts =====
export const RE_CURRENCY_GENERIC = /^(?:[A-Z]{3}|[$€£])\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?$/;
export const RE_PERCENT = /^(?:100(?:\.0+)?|(?:\d{1,2})(?:\.\d+)?)%$/;

// ===== Postal codes (examples) =====
export const RE_ZIP_US = /^\d{5}(?:-\d{4})?$/;
export const RE_CAP_IT = /^\d{5}$/;
export const RE_POSTCODE_UK_APPROX = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

// ===== File paths / names =====
export const RE_FILENAME_SAFE = /^[A-Z0-9._-]+$/i;
export const RE_UNIX_PATH = /^(\/[^/\0]+)+\/?$/;
export const RE_WINDOWS_PATH = /^(?:[A-Z]:\\|\\\\)[^\s<>:"|?*]+$/i;
export const RE_EXTENSION = /^[^.]+\.[A-Z0-9]+$/i;
export const RE_MIME_TYPE = /^[a-z]+\/[a-z0-9+.-]+$/i;

// ===== Coordinates =====
export const RE_LAT = /^-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)$/;
export const RE_LON = /^-?(?:1[0-7]\d(?:\.\d+)?|[1-9]?\d(?:\.\d+)?|180(?:\.0+)?)$/;
export const RE_LATLON_PAIR = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/;

// ===== Case styles =====
export const RE_CAMEL_CASE = /^(?:[a-z]+(?:[A-Z][a-z0-9]+)*)$/;
export const RE_PASCAL_CASE = /^(?:[A-Z][a-z0-9]+)+$/;
export const RE_SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
export const RE_KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

// ===== HTML / CSV =====
export const RE_HTML_TAG = /<[^>]+>/;
export const RE_CSV_LINE = /^(?:"[^"]*"|[^",]*)(?:,(?:"[^"]*"|[^",]*))*$/;

// ===== Password policy (example) =====
export const RE_PASSWORD_STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// ===== IP addresses =====
export const RE_IPV6 = /^((?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:){1,7}:|(?:[A-F0-9]{1,4}:){1,6}:[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:){1,5}(?::[A-F0-9]{1,4}){1,2}|(?:[A-F0-9]{1,4}:){1,4}(?::[A-F0-9]{1,4}){1,3}|(?:[A-F0-9]{1,4}:){1,3}(?::[A-F0-9]{1,4}){1,4}|(?:[A-F0-9]{1,4}:){1,2}(?::[A-F0-9]{1,4}){1,5}|[A-F0-9]{1,4}:(?::[A-F0-9]{1,4}){1,6}|:(?::[A-F0-9]{1,4}){1,7})(?:%\w+)?$/i; // compressed + zone id

// ===== Italy: Codice Fiscale & Partita IVA =====
// Strict (no "omocodia" substitutions)
export const RE_CF_IT_STRICT = /^[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/;
// Omocodia allowed (L,M,N,P,Q,R,S,T,U,V standing in for digits)
export const RE_CF_IT_OMOCODIA = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
// Partita IVA (11 digits), with optional "IT" prefix
export const RE_PIVA_IT = /^(?:IT\s*)?\d{11}$/i;

// ===== PEC (Posta Elettronica Certificata) =====
export const RE_PEC_IT_STRICT = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.PEC\.IT$/i;     // ends with .pec.it
export const RE_PEC_GENERIC = /^[A-Z0-9._%+-]+@[A-Z0-9.-]*\.PEC\.[A-Z]{2,}$/i; // any TLD with ".pec."

// ===== EU VAT (per country; pragmatic patterns) =====
export const RE_VAT_AT = /^ATU\d{8}$/;                    // Austria
export const RE_VAT_BE = /^BE0?\d{9}$/;                   // Belgium
export const RE_VAT_BG = /^BG\d{9,10}$/;                  // Bulgaria
export const RE_VAT_HR = /^HR\d{11}$/;                    // Croatia
export const RE_VAT_CY = /^CY\d{8}[A-Z]$/i;              // Cyprus
export const RE_VAT_CZ = /^CZ\d{8,10}$/;                  // Czechia
export const RE_VAT_DK = /^DK\d{8}$/;                     // Denmark
export const RE_VAT_EE = /^EE\d{9}$/;                     // Estonia
export const RE_VAT_FI = /^FI\d{8}$/;                     // Finland
export const RE_VAT_FR = /^FR[0-9A-Z]{2}\d{9}$/i;         // France (2-char key + 9 digits)
export const RE_VAT_DE = /^DE\d{9}$/;                     // Germany
export const RE_VAT_EL = /^EL\d{9}$/;                     // Greece (EL)
export const RE_VAT_HU = /^HU\d{8}$/;                     // Hungary
export const RE_VAT_IE = /^IE\d{7}[A-W][A-I]?$/i;         // Ireland (approx)
export const RE_VAT_IT = /^IT\d{11}$/;                    // Italy
export const RE_VAT_LV = /^LV\d{11}$/;                    // Latvia
export const RE_VAT_LT = /^LT(\d{9}|\d{12})$/;            // Lithuania
export const RE_VAT_LU = /^LU\d{8}$/;                     // Luxembourg
export const RE_VAT_MT = /^MT\d{8}$/;                     // Malta
export const RE_VAT_NL = /^NL\d{9}B\d{2}$/;               // Netherlands
export const RE_VAT_PL = /^PL\d{10}$/;                    // Poland
export const RE_VAT_PT = /^PT\d{9}$/;                     // Portugal
export const RE_VAT_RO = /^RO\d{2,10}$/;                  // Romania
export const RE_VAT_SK = /^SK\d{10}$/;                    // Slovakia
export const RE_VAT_SI = /^SI\d{8}$/;                     // Slovenia
export const RE_VAT_ES = /^ES[A-Z0-9]\d{7}[A-Z0-9]$/i;    // Spain
export const RE_VAT_SE = /^SE\d{12}$/;                    // Sweden

// ===== S3 / R2 object URLs & URIs =====
// S3 URI like: s3://bucket/key
export const RE_S3_URI = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+$/;
// S3 virtual-hosted–style: https://bucket.s3.amazonaws.com/key (any region suffix acceptable)
export const RE_S3_VHOST_URL = /^https?:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3[.-][a-z0-9-]+\.amazonaws\.com\/.+$/i;
// S3 path-style: https://s3.region.amazonaws.com/bucket/key
export const RE_S3_PATH_URL = /^https?:\/\/s3[.-][a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+$/i;
// R2 public (account endpoint): https://<accountid>.r2.cloudflarestorage.com/bucket/key
export const RE_R2_PUBLIC_URL = /^https?:\/\/[a-z0-9]{32}\.r2\.cloudflarestorage\.com\/[A-Za-z0-9._-]{3,63}\/.+$/;
// R2 S3-compatible (custom endpoint host): https?:\/\/<host>/bucket/key  — keep broad
export const RE_R2_S3_COMPAT_URL = /^https?:\/\/[A-Z0-9.-]+\/[A-Za-z0-9._-]{3,63}\/.+$/i;

// ===== SemVer (versions & ranges) =====
// Exact SemVer (same as before, strict)
export const RE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?$/i;
// Simple ranges with ^ or ~ and OR (pragmatic)
export const RE_SEMVER_RANGE_SIMPLE = /^(?:[~^]?\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?)(?:\s*\|\|\s*[~^]?\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?)*$/i;
// Comparators like >=1.2.3 <2.0.0 (basic)
export const RE_SEMVER_RANGE_COMPARATORS = /^(?:[<>]=?\s*\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?\s*)+(?:\|\|\s*(?:[<>]=?\s*\d+\.\d+\.\d+(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?\s*)+)*$/i;
