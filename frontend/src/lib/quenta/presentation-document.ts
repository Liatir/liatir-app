import type { LiatirQuentaPresentation } from '@liatir/core';
import sandboxHtml from '../../../static/presentation-sandbox.html?raw';

/** Export remains fully offline, with its own restrictive policy and embedded runtime. */
export async function presentationHtml(presentation: LiatirQuentaPresentation & { runtimeSource: string }): Promise<string> {
  const encoded = JSON.stringify(presentation).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = sandboxHtml.replace('const initial = null;', () => `const initial = ${encoded};`);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Presentation host is missing.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const inner = html.replace(/script-src 'sha256-[^']+'/, `script-src 'sha256-${hash}'`);
  // A standalone export needs a parent policy too: a document's own CSP cannot
  // reliably prevent its script from navigating itself to an external URL.
  const bootstrap = `const frame=document.querySelector('iframe');frame.src=URL.createObjectURL(new Blob([${JSON.stringify(inner).replace(/</g, '\\u003c')}],{type:'text/html'}));`;
  const outerDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bootstrap));
  const outerHash = btoa(String.fromCharCode(...new Uint8Array(outerDigest)));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${outerHash}' 'sha256-${hash}' blob:; frame-src blob:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Offline Liatir presentation</title></head><body style="margin:0"><iframe sandbox="allow-scripts" title="Liatir presentation" style="width:100%;height:100vh;border:0"></iframe><script>${bootstrap}</script></body></html>`;

}

