import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportToHtml } from '../../frontend/src/lib/utils/export-result';

const run = { tool: 'example', label: 'Saved result', inputs: [], startedAt: 1000, endedAt: 2000 };

describe('standalone result HTML', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a chart-free report independent of the chart asset', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const html = await exportToHtml(run as Parameters<typeof exportToHtml>[0], {
      sections: [{ type: 'table', label: 'Measurements', headers: ['Value'], rows: [[42]] }],
    });
    expect(request).not.toHaveBeenCalled();
    expect(html).toContain('<td>42</td>');
    expect(html).not.toContain('Plotly.newPlot');
  });

  it('embeds and escapes the local runtime so charts work without external scripts', async () => {
    const runtime = 'window.Plotly={newPlot(){}};/* </script> */';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(runtime)));
    const html = await exportToHtml(run as Parameters<typeof exportToHtml>[0], {
      sections: [{ type: 'plotly', data: [{ x: [1], y: [2], type: 'scatter' }], layout: {} }],
    });
    expect(html).toContain('window.Plotly={newPlot(){}};/* <\\/script> */');
    expect(html).toContain("Plotly.newPlot('chart0'");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('rejects a missing chart asset instead of exporting blank charts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(exportToHtml(run as Parameters<typeof exportToHtml>[0], {
      sections: [{ type: 'plotly', data: [], layout: {} }],
    })).rejects.toThrow('could not load for export');
  });
});
