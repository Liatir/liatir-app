// Liatir is a desktop app, not a website: there is no server to render on, and every page depends on the
// local machine (the filesystem, installed models, running jobs) — none of which exists at build time. So
// server-side rendering and prerendering are both off, app-wide.
export const prerender = false;
export const ssr = false;
