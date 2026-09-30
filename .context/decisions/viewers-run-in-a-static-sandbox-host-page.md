# Sandboxed viewers run in a static host page, not a blob: document

Taken 2026-09-29, after the 3D Structure Viewer showed an empty white box in the released 0.1.0
macOS app while working under `npm run dev`.

## Decision

The three viewers that run a third-party library in a sandboxed iframe (3D structure, molecular
trajectory, JBrowse genome) load one shipped page, `frontend/static/viewer-sandbox.html`, into an
`allow-scripts` iframe and hand it their document by postMessage
(`frontend/src/lib/viewers/sandbox-frame.ts`). The page's only script is inline. It runs each of the
document's scripts as a `blob:` script that the frame creates itself. The production policy allows
exactly that: `script-src 'self' blob:`. If the viewer sends no message within 15 seconds, the
caller shows its fallback or a message instead of the blank frame.

## Why

Measured in WKWebView with the production policy (`conf-templates/tauri.conf.template.prod.json`):

- the old frames were `blob:` documents, and `default-src` has no `blob:`, so the frame was refused
  outright and nothing reported it;
- allowing `frame-src blob:` is not enough: a `blob:` document inherits the app's policy, so its
  inline scripts are refused, and Tauri puts nonces and hashes in `script-src`, which disables
  `'unsafe-inline'`;
- a `blob:` script created by the parent does not load in the frame, whose origin is opaque;
- a `'self'` script does not load in the frame either, for the same reason;
- an inline script in a page that Tauri serves does run: Tauri hashes each HTML file's inline
  scripts into the policy it serves with that file. From there, `blob:` scripts the frame creates
  itself run, and the real 3Dmol.js renders.

The end-to-end binary is built without a policy (`localdevconf`), which is why no test saw this.
`tests/unit/viewer-sandbox.test.ts` now holds the facts above against the production template.

## Rejected

- **`'unsafe-inline'` or `'unsafe-eval'` in `script-src`**: this weakens the whole app, and Tauri's
  nonces cancel `'unsafe-inline'` anyway.
- **Loading the libraries in the main document**: it gives third-party code access to the Tauri
  bridge, which the sandbox exists to prevent.
- **Listing the app origins (`tauri://localhost`, `http://tauri.localhost`) in `script-src`** so
  the host page can load an external script: it works, but depends on each platform's origin,
  while the hash is added by Tauri on every platform.

## What the opaque origin takes away, and how the host page gives it back

The frame's origin is opaque, and JBrowse 2 needs two things such an origin does not have. The host
page supplies both before any viewer script runs, because libraries capture them while loading.

- **Web Storage.** WebKit throws `SecurityError` on the first touch of `localStorage` or
  `sessionStorage`, and JBrowse probes `sessionStorage` while loading, so it never started. The host
  page replaces both with stores in memory that last as long as the frame.
- **Local files.** The asset protocol answers the app's origin only, so JBrowse could not read the
  FASTA, the tracks or their indexes. A `fetch` of a file URL
  (`https://sandbox-file.liatir.invalid/<token>`) is posted to the parent instead. The parent reads
  the bytes natively through `lia_file_read_range` (byte ranges included, which is how JBrowse reads a
  BAM or a tabix VCF) and answers as an HTTP server would. The frame names a token, never a path, so
  it reads only the files it was handed.

Measured in WKWebView with the production policy, and then in the real app
(`tests/e2e/specs/genome-viewer.e2e.mjs`): the real JBrowse reads the yeast chromosome, a GFF3 and a
BAM through its index, and draws them. JBrowse also reports to the app when every track has drawn or
failed, and the app shows each failure by track name instead of leaving it inside the frame.
