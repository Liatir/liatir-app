import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { presentationHtml } from '../../frontend/src/lib/quenta/presentation-document';
import type { LiatirQuentaPresentation } from '@liatir/core';

it('preserves literal code/data during offline HTML assembly and hashes the exact embedded scripts', async () => {
  const presentation: LiatirQuentaPresentation = {
    id: 'test', schemaVersion: 1, workspaceId: 'a', title: 'Literal $& and </script>', model: 'fixture', createdAt: 1,
    sources: [{ resultId: 'source', label: '$& $` $\' </script>', tool: 'fixture', endedAt: 1, output: { value: 7 } }],
    runtimeSource: 'window.runtime = "$& $` $\'";',
    javascript: 'const value = "$& $` $\'"; document.getElementById("root").textContent = value;', css: '',
  };
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
  expect(code).toContain(presentation.javascript);
  expect(() => new vm.Script(code)).not.toThrow();
});
