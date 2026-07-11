const MAX_VISIBLE_REASONING_CHARS = 12_000;
const MAX_REASONING_LINE_CHARS = 800;

/** Keeps local-model reasoning useful while hiding paths and oversized raw context. */
export function sanitizeQuentaReasoning(value: string): string {
  const sanitized = value
    .replace(/<retrieved_context>[\s\S]*?<\/retrieved_context>/gi, '[Retrieved workspace context omitted]')
    .replace(/<source\b[^>]*>[\s\S]*?<\/source>/gi, '[Source details omitted]')
    .replace(/(?:\/Users|\/home|\/private|\/var\/folders|\/Volumes)(?:\/[\w.@+%~-]+)+/g, '[local path]')
    .replace(/\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g, '[local path]')
    .replace(/\n{4,}/g, '\n\n')
    .split('\n')
    .map((line) => line.length > MAX_REASONING_LINE_CHARS
      ? `${line.slice(0, MAX_REASONING_LINE_CHARS)}…`
      : line)
    .join('\n')
    .trim();
  if (sanitized.length <= MAX_VISIBLE_REASONING_CHARS) return sanitized;
  return `[Earlier reasoning omitted for readability]\n\n${sanitized.slice(-MAX_VISIBLE_REASONING_CHARS)}`;
}
