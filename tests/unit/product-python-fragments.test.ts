import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadProductPythonScript } from '../../scripts/runtime-box/product-script.mjs';
import { SCGPT_EMBEDDING_SCRIPT } from '../../frontend/src/lib/tools/ai/python-scripts/scgpt-embedding';
import { GENEFORMER_EMBEDDING_SCRIPT } from '../../frontend/src/lib/tools/ai/python-scripts/geneformer-embedding';

describe('Runtime Box validation uses the shipped Python source', () => {
  it.each([
    ['scgpt', 'SCGPT_EMBEDDING_SCRIPT', SCGPT_EMBEDDING_SCRIPT],
    ['geneformer', 'GENEFORMER_EMBEDDING_SCRIPT', GENEFORMER_EMBEDDING_SCRIPT],
  ])('resolves every shared fragment for %s', async (method, name, expected) => {
    const source = await loadProductPythonScript(resolve(`frontend/src/lib/tools/ai/python-scripts/${method}-embedding.ts`), name);
    expect(source.replaceAll('\r\n', '\n')).toBe(expected.replaceAll('\r\n', '\n'));
    expect(source).not.toContain('${SOURCE_COUNT_VALIDATION_SCRIPT}');
    expect(source).not.toContain('${SCGPT_CHECKPOINT_SCRIPT}');
  });
});
