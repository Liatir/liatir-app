/**
 * App-wide constants: external URLs and fixed layout values.
 *
 * Centralised so a domain change or a header resize is a one-line edit rather than a search across
 * the codebase.
 */


/** Key under which the companion URL is published as a global variable, readable by plugins. */
export const COMPANION_URL_GLOBAL_VAR_KEY = "companionUrl";

export const LIATIR_WEBSITE = "https://liatir.com"!;
// Derived from the website constant, so the two can never point at different domains.
export const LIATIR_DOCS_URL = `${LIATIR_WEBSITE}/introduction/overview`;
export const LIATIR_SUPPORT_URL = `${LIATIR_WEBSITE}/getting-started/support`;
export const LIATIR_CLI_NPM_PACKAGE_URL = "https://www.npmjs.com/package/@liatir/cli"!;
export const LIATIR_API_NPM_PACKAGE_URL = "https://www.npmjs.com/package/@liatir/api"!;

/** Shared by the layout and by anything that has to size itself against the header. */
export const HEADER_HEIGHT = 70;
