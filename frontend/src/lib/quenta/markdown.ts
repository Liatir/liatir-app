import { Marked } from 'marked';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://liatir.local');
    if (url.protocol === 'http:' || url.protocol === 'https:') return value;
  } catch {
    // Invalid links are rendered as text below.
  }
  return null;
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return label;
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener"${titleAttribute}>${label}</a>`;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderQuentaMarkdown(source: string): string {
  return markdown.parse(source) as string;
}
