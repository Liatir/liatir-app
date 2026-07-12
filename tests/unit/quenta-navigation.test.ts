/**
 * Tests the URL handoff that opens Quenta focused on a specific run or job.
 *
 * The `without auto-send` in the first case is deliberate: landing with a prepared but *unsent* question lets the
 * user adjust it. The tests also cover that the one-shot parameters are consumed, so a reload does not silently
 * re-ask the same question.
 */
import { describe, expect, it } from 'vitest';
import {
  consumedQuentaUrl,
  quentaDraftUrl,
  quentaLaunchRequest,
  standaloneQuentaUrl,
} from '../../frontend/src/lib/quenta/navigation';

describe('Quenta navigation', () => {
  it('builds a result explanation draft without auto-send', () => {
    const url = quentaDraftUrl('explain-result', { kind: 'result', entityId: 'run 42' });

    expect(url).toBe('/quenta?intent=explain-result&run=run+42');
    expect(url).not.toContain('auto=1');
  });

  it('can target a standalone report window', () => {
    expect(quentaDraftUrl('report', { kind: 'result', entityId: 'result-1' }, { standalone: true }))
      .toBe('/quenta?intent=report&run=result-1&window=1');
  });

  it('consumes focused launch parameters so reload cannot create another chat', () => {
    const url = new URL('tauri://localhost/quenta?intent=report&run=result-1&auto=1&window=1');

    expect(quentaLaunchRequest(url)).toEqual({
      intent: 'report',
      focus: { kind: 'result', entityId: 'result-1' },
      autoSend: true,
    });
    expect(consumedQuentaUrl(url)).toBe('/quenta?window=1');
    expect(quentaLaunchRequest(new URL(`tauri://localhost${consumedQuentaUrl(url)}`))).toBeNull();
  });

  it('preserves a standalone conversation selection while consuming one-shot context', () => {
    const url = new URL('tauri://localhost/quenta?conversation=chat-1&job=job-1&mode=explain-failure&window=1');

    expect(consumedQuentaUrl(url)).toBe('/quenta?conversation=chat-1&window=1');
  });

  it('opens report drafts as internal standalone Quenta routes without losing the mode', () => {
    expect(standaloneQuentaUrl('/quenta?intent=report&run=result-1'))
      .toBe('/quenta?intent=report&run=result-1&window=1');
    expect(() => standaloneQuentaUrl('/results')).toThrow(/Quenta route/);
  });
});
