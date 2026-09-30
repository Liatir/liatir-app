/**
 * The sandboxed viewers against the production Content Security Policy.
 *
 * The end-to-end binary is built without a policy, so a viewer the policy blocks still passes there
 * and ships blank. These checks hold the facts the viewers rely on in production.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const csp: string = JSON.parse(readFileSync(join(root, 'conf-templates/tauri.conf.template.prod.json'), 'utf8')).app.security.csp;
const directive = (name: string) => csp.split(';').map((part) => part.trim().split(/\s+/)).find(([key]) => key === name)?.slice(1);
const host = readFileSync(join(root, 'frontend/static/viewer-sandbox.html'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(svelte|ts)$/.test(entry.name) ? [path] : [];
  });
}

describe('sandboxed viewers under the production policy', () => {
  it('lets the host page be framed and run the blob scripts it creates, and nothing looser', () => {
    // The host page is an app file, framed from the app's own origin.
    expect(directive('frame-src') ?? directive('child-src') ?? directive('default-src')).toContain("'self'");
    expect(directive('script-src')).toEqual(["'self'", 'blob:']);
  });

  it('keeps the host page to one inline script, the only kind Tauri hashes into the policy', () => {
    // The frame's origin is opaque, so a 'self' script would not load there, and Tauri hashes inline
    // scripts but not inline styles.
    expect(host.match(/<script\b/g)).toHaveLength(1);
    expect(host).not.toMatch(/<script[^>]*\ssrc=/);
    expect(host).not.toMatch(/<style\b|\sstyle=/);
  });

  it('gives the frame Web Storage and file reads before any viewer script runs', () => {
    // JBrowse touches sessionStorage while loading, which throws in an opaque origin, and cannot read
    // local files itself. Both are replaced before the posted document is rendered.
    const script = host.slice(host.indexOf('<script>'));
    const firstUse = script.indexOf('function render(');
    expect(script.indexOf("['localStorage', 'sessionStorage']")).toBeGreaterThan(-1);
    expect(script.indexOf("['localStorage', 'sessionStorage']")).toBeLessThan(firstUse);
    expect(script.indexOf('window.fetch = function')).toBeLessThan(firstUse);
    expect(host).toContain(readFileSync(join(root, 'frontend/src/lib/viewers/sandbox-frame.ts'), 'utf8')
      .match(/const FILE_URL_PREFIX = '([^']+)'/)![1]);
  });

  it('never frames a blob: document, which inherits the policy and has its inline scripts refused', () => {
    const offenders = sources(join(root, 'frontend/src')).filter((path) =>
      /new Blob\([^)]*text\/html/s.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
