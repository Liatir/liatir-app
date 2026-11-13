import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { presentationHtml } from '../../frontend/src/lib/quenta/presentation-document';
import type { LiatirQuentaPresentation } from '@liatir/core';

type Embedded = LiatirQuentaPresentation & { runtimeSource: string };
const base = {
  id: 'test', schemaVersion: 1 as const, workspaceId: 'a', title: 'Literal $& and </script>', model: 'fixture', createdAt: 1,
  sources: [{ resultId: 'source', label: '$& $` $\' </script>', tool: 'fixture', endedAt: 1, output: { value: 7 } }],
  runtimeSource: 'window.runtime = "$& $` $\'";',
};

/** Runs the standalone page's two scripts as a browser would, up to the code its frame would execute. */
async function assemble(presentation: Embedded) {
  const html = await presentationHtml(presentation);
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).toContain("frame-src blob:");
  const outer = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  expect(html).toContain(createHash('sha256').update(outer).digest('base64'));
  let inner = '';
  class FakeBlob { content: string; constructor(values: string[]) { this.content = values[0]; } }
  vm.runInNewContext(outer, { document: { querySelector: () => ({}) }, Blob: FakeBlob,
    URL: { createObjectURL: (blob: FakeBlob) => { inner = blob.content; return 'blob:test'; } } });
  const bootstrap = inner.match(/<script>([\s\S]*?)<\/script>/)![1];
  expect(inner).toContain(createHash('sha256').update(bootstrap).digest('base64'));
  let code = '';
  const window: Record<string, unknown> = { addEventListener() {} };
  vm.runInNewContext(bootstrap, { window, parent: { postMessage() {} }, Blob: FakeBlob,
    document: { createElement: () => ({}), head: { append() {} }, body: { append() {} } },
    URL: { createObjectURL: (blob: FakeBlob) => { code = blob.content; return 'blob:code'; } } });
  expect(JSON.parse(JSON.stringify(window.LIATIR_RESULTS))).toEqual(presentation.sources);
  expect(code).toContain(presentation.runtimeSource);
  expect(() => new vm.Script(code)).not.toThrow();
  return { code, window };
}

it('preserves literal text and data during offline HTML assembly, hashes the exact embedded scripts and draws the page', async () => {
  const page = { title: 'Literal $& and </script>', sections: [] };
  const { code, window } = await assemble({ ...base, page });
  expect(JSON.parse(JSON.stringify(window.LIATIR_PAGE))).toEqual(page);
  // The frame runs the runtime and one fixed call; nothing the model wrote is executed.
  expect(code.slice(base.runtimeSource.length)).toMatch(/^\n;try \{\nLiatirStage\.showPage\(LIATIR_PAGE, LIATIR_RESULTS\);\n;setTimeout/);
});

it('still runs the page code of a presentation made before Stage pages', async () => {
  const javascript = 'const value = "$& $` $\'"; document.getElementById("root").textContent = value;';
  const { code } = await assemble({ ...base, javascript, css: '' });
  expect(code).toContain(javascript);
  expect(code).not.toContain('showPage');
});

it('allows exactly the in-app presentation host script it ships', () => {
  // The host page's policy names its own script by hash; an edit that forgets the hash blocks every presentation.
  const page = readFileSync('frontend/static/presentation-sandbox.html', 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
  expect(page).toContain(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`);
});
