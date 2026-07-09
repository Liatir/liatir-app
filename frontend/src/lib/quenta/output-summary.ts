import type { ToolOutput } from '$lib/types/tool-output';

export function compact(value: string, maxChars = 4_000): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n...[truncated ${normalized.length - maxChars} chars]`;
}

export function jsonSummary(value: unknown, maxChars = 4_000): string {
  try {
    return compact(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return compact(String(value), maxChars);
  }
}

export function summarizeToolOutput(output: ToolOutput | null, maxChars = 8_000): string {
  if (!output?.sections?.length) return 'No structured output sections recorded.';
  const sections = output.sections.map((section, index) => {
    const prefix = `Section ${index + 1} (${section.type})`;
    switch (section.type) {
      case 'stats':
        return `${prefix}: ${(section.items ?? [])
          .map((item) => `${item.label}=${item.value}${item.description ? ` (${item.description})` : ''}`)
          .join('; ')}`;
      case 'number':
        return `${prefix}: ${section.label}=${section.value}${section.unit ? ` ${section.unit}` : ''}${section.description ? `; ${section.description}` : ''}`;
      case 'text':
        return `${prefix}: ${section.label}\n${compact(section.content, 1_500)}`;
      case 'table':
        return `${prefix}: ${section.label}\nheaders=${section.headers.join(', ')}\nrows=${jsonSummary(section.rows.slice(0, 12), 1_800)}`;
      case 'plotly':
        return `${prefix}: ${section.title ?? section.plotlyType}${section.subtitle ? ` · ${section.subtitle}` : ''}${section.description ? `\n${section.description}` : ''}`;
      case 'structure-viewer':
        return `${prefix}: ${section.label}; format=${section.format}; path=${section.path ?? 'inline content'}${section.description ? `; ${section.description}` : ''}`;
      case 'genome-viewer':
        return `${prefix}: ${section.label}; assembly=${section.assembly.name}; tracks=${section.tracks.map((track) => `${track.name}:${track.kind}`).join(', ')}`;
      case 'single-cell-viewer':
        return `${prefix}: ${section.label}; config=${jsonSummary(section.config, 1_000)}`;
      default:
        return `${prefix}: ${jsonSummary(section)}`;
    }
  });
  return compact(sections.join('\n\n'), maxChars);
}
