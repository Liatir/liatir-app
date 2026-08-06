/**
 * Renders app data as bounded plain text for the assistant's prompt.
 *
 * Everything here exists to solve one problem: a real tool result can be enormous (a table with a
 * million rows, a plot with a hundred thousand points), and the prompt has a fixed budget. So each
 * helper produces a *description* of the data rather than the data itself, and always within a cap.
 */
import type { ToolOutput } from '$lib/types/tool-output';

/**
 * Truncates to a character budget, and says so.
 *
 * The explicit "[truncated N chars]" marker matters: silently cutting text would leave the model
 * to reason over a fragment it believes is complete, and confidently answer from half a log.
 */
export function compact(value: string, maxChars = 4_000): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n...[truncated ${normalized.length - maxChars} chars]`;
}

/** JSON, pretty-printed and capped. Falls back to `String(value)` for anything cyclic or unserialisable. */
export function jsonSummary(value: unknown, maxChars = 4_000): string {
  try {
    return compact(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return compact(String(value), maxChars);
  }
}

/**
 * Describes a structured tool result section by section.
 *
 * Each section type is summarised by what is actually *informative* about it, not by dumping its
 * payload: a table becomes its headers plus a dozen sample rows; a plot becomes its title and type,
 * since the coordinates of its points would be both huge and meaningless to the model; a viewer
 * becomes what it is showing. The result is a description the assistant can reason about, at a size
 * that fits.
 */
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
      // Headers plus a sample of rows: enough to see the shape and the kind of values, without
      // pouring a whole result table into the prompt.
      case 'table':
        return `${prefix}: ${section.label}\nheaders=${section.headers.join(', ')}\nrows=${jsonSummary(section.rows.slice(0, 12), 1_800)}`;
      // A plot is described, never serialised — its raw traces are large and tell the model nothing
      // its title and type do not.
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
