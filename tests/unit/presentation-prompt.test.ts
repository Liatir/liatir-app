import { expect, it } from 'vitest';
import { LIATIR_QUENTA_CONTEXT_TOKENS } from '@liatir/core';
import gallery from '../fixtures/stage-gallery.json';
import { OUTPUT_TOKENS, repairMessages, requestMessage, systemPrompt } from '../../frontend/src/lib/quenta/presentation-prompt';
import { BLOCK_TYPES } from '../../frontend/stage-kit/spec/page';
import { describeSources, sourceTables } from '../../frontend/stage-kit/spec/tables';

const tables = sourceTables(gallery.sources);

it('describes every element and leaves room in the context for data and the answer', () => {
  for (const prompt of [systemPrompt(tables), systemPrompt([])]) {
    for (const type of BLOCK_TYPES) expect(prompt).toContain(`- ${type}: `);
    // About three characters per token: the guide plus the answer must leave over a third of the context.
    expect(Math.ceil(prompt.length / 3) + OUTPUT_TOKENS).toBeLessThan(LIATIR_QUENTA_CONTEXT_TOKENS * 0.66);
  }
  expect(systemPrompt(tables)).toContain('Never retype them');
  expect(systemPrompt([])).toContain('"Illustrative" label');
});

it('asks for a new page, a free-topic page or a revision of the current version', () => {
  const data = describeSources(gallery.sources, tables);
  expect(requestMessage('Compare them', data, undefined)).toContain('DATA:\nResult "Docking of 6 ligands" (molecular-docking)\nT1 ');
  expect(requestMessage('Explain docking', '', undefined)).toContain('This page is not about any Result');
  const revision = requestMessage('Bigger chart', data, { page: { title: 'Old' } });
  expect(revision).toContain('CURRENT PAGE:\n{"title":"Old"}');
  expect(revision).toContain('REQUEST: Bigger chart');
  // A version from before Stage pages cannot be revised, so the request starts a new page.
  expect(requestMessage('Bigger chart', data, {})).not.toContain('CURRENT PAGE');
  // The model's answer is its own turn, and the problems come last, where the model reads them.
  const [answer, repair] = repairMessages(['Section 2, element 1 (pie-chart): a pie chart shows one series.', 'x'.repeat(5000)], 'previous answer');
  expect(answer).toEqual({ role: 'assistant', content: 'previous answer' });
  expect(repair.role).toBe('user');
  expect(repair.content).toContain('- Section 2, element 1 (pie-chart): a pie chart shows one series.');
  expect(repair.content).not.toContain('previous answer');
  expect(repair.content.length).toBeLessThan(1500);
});
