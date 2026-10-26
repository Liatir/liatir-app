import { liatirPluginPipelineInputs } from '@liatir/core';
import { afterEach, expect, it, vi } from 'vitest';
import { runLiatirPlugin } from '../../frontend/src/lib/utils/plugin-run';

afterEach(() => vi.unstubAllGlobals());

it.each(['r', 'native'] as const)('%s rejects success without a structured result marker', async runtime => {
  const invoke = vi.fn(async command => {
    if (command === 'lia_liatir_run') return { jobId: 'job' };
    if (command === 'lia_jobs_status') return { status: { type: 'done', exitCode: 0 } };
    return { stdout: [], stderr: [], stdoutTotal: 0, stderrTotal: 0 };
  });
  vi.stubGlobal('window', { Liatir: { invoke } });
  await expect(runLiatirPlugin({ path: 'plugin.lia', runtime }, {})).rejects.toThrow('valid result');
});

it.each(['r', 'native', 'node', 'python', 'wasm'] as const)('%s accepts the shared result marker', async runtime => {
  const invoke = vi.fn(async command => {
    if (command === 'lia_liatir_run') return { jobId: 'job' };
    if (command === 'lia_jobs_status') return { status: { type: 'done', exitCode: 0 } };
    return { stdout: ['__LIATIR_RESULT__{"file":{"content":"ok","fileName":"x.txt"}}'], stderr: [], stdoutTotal: 1, stderrTotal: 0 };
  });
  vi.stubGlobal('window', { Liatir: { invoke } });
  expect((await runLiatirPlugin({ path: 'plugin.lia', runtime }, {})).result).toEqual({ file: { content: 'ok', fileName: 'x.txt' } });
});

it('converts pipeline text to contract types without losing false or zero', () => {
  const schema = { count: { type: 'number' as const }, enabled: { type: 'boolean' as const }, file: { type: 'file' as const } };
  expect(liatirPluginPipelineInputs(schema, { count: '0', enabled: 'false', file: '/input.txt' }))
    .toEqual({ count: 0, enabled: false, file: '/input.txt' });
  expect(liatirPluginPipelineInputs(schema, { count: '', enabled: '' })).toEqual({});
  expect(() => liatirPluginPipelineInputs(schema, { count: 'bad' })).toThrow('finite number');
  expect(() => liatirPluginPipelineInputs(schema, { enabled: 'yes' })).toThrow('true or false');
});
