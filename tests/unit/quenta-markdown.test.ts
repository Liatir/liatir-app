/**
 * Tests the Markdown renderer used for Quenta's answers.
 *
 * This renderer is what makes it safe to put *model-generated* text into the app's DOM: it escapes raw HTML,
 * restricts links to http/https, and neutralises images. The tests cover both that ordinary Markdown renders,
 * and that those guards hold — the second is the one that must never regress.
 */
import { describe, expect, it } from 'vitest';
import { renderQuentaMarkdown } from '../../frontend/src/lib/quenta/markdown';

describe('Quenta Markdown', () => {
  it('renders common Markdown structures', () => {
    const html = renderQuentaMarkdown('## Finding\n\n- **Observed** value\n- `sample.vcf`');

    expect(html).toContain('<h2>Finding</h2>');
    expect(html).toContain('<strong>Observed</strong>');
    expect(html).toContain('<code>sample.vcf</code>');
  });

  it('does not render model-provided HTML or unsafe links', () => {
    const html = renderQuentaMarkdown('<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
  });
});
