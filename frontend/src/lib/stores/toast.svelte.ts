type ToastKind = 'success' | 'error' | 'info' | 'warn';
interface ToastItem { id: string; message: string; detail?: string; kind: ToastKind; }

const MAX_TOAST_CHARS = 180;

function normalizeToastMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function compactToastMessage(message: string, kind: ToastKind): { message: string; detail?: string } {
  const normalized = normalizeToastMessage(message);
  if (!normalized) return { message: kind === 'error' ? 'Operation failed.' : '' };

  const shouldCompact =
    normalized.length > MAX_TOAST_CHARS ||
    message.includes('\n') ||
    /traceback|stack trace|site-packages|\/Users\//i.test(message);

  if (!shouldCompact) return { message: normalized };

  if (kind === 'error') {
    const firstLine = message
      .split(/\r?\n/)
      .map((line) => normalizeToastMessage(line))
      .find((line) => line && !/traceback|site-packages|\/Users\//i.test(line));
    const prefix = firstLine && firstLine.length <= 90 ? firstLine : 'Operation failed.';
    return { message: `${prefix} See logs for details.`, detail: normalized };
  }

  return {
    message: `${normalized.slice(0, MAX_TOAST_CHARS - 3)}...`,
    detail: normalized,
  };
}

function createToastStore() {
  let items = $state<ToastItem[]>([]);

  function remove(id: string) { items = items.filter(t => t.id !== id); }

  function add(message: string, kind: ToastKind = 'info') {
    const id = crypto.randomUUID();
    const compact = compactToastMessage(message, kind);
    items = [...items, { id, ...compact, kind }];
    setTimeout(() => remove(id), 3500);
  }

  return {
    get items() { return items; },
    success: (msg: string) => add(msg, 'success'),
    error:   (msg: string) => add(msg, 'error'),
    warn:    (msg: string) => add(msg, 'warn'),
    info:    (msg: string) => add(msg, 'info'),
    remove,
  };
}

export const toast = createToastStore();
