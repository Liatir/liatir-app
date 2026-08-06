/**
 * Transient notifications.
 *
 * The interesting part is not the queue but `compactToastMessage`. Errors here originate from
 * Python, from command-line tools, from the OS — so a raw error message is frequently a multi-line
 * traceback full of absolute paths. Dropped into a toast unedited it is unreadable, wrecks the
 * layout, and tells a non-technical user nothing. So a message that looks like machine output is
 * reduced to one readable line, with the full text kept as `detail` for whoever wants it.
 */
type ToastKind = 'success' | 'error' | 'info' | 'warn';
interface ToastItem { id: string; message: string; detail?: string; kind: ToastKind; }

const MAX_TOAST_CHARS = 180;

/** Collapses newlines and runs of whitespace, so a multi-line message can sit on one toast line. */
function normalizeToastMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

/**
 * Reduces a message to something a toast can actually show, keeping the original as `detail`.
 *
 * The heuristics detect *machine* output rather than length alone: a traceback, a `site-packages`
 * path or a `/Users/...` path are all signs the text was written for a developer, not for the user.
 */
function compactToastMessage(message: string, kind: ToastKind): { message: string; detail?: string } {
  const normalized = normalizeToastMessage(message);
  // An error with no message at all still has to say *something*.
  if (!normalized) return { message: kind === 'error' ? 'Operation failed.' : '' };

  const shouldCompact =
    normalized.length > MAX_TOAST_CHARS ||
    message.includes('\n') ||
    /traceback|stack trace|site-packages|\/Users\//i.test(message);

  if (!shouldCompact) return { message: normalized };

  if (kind === 'error') {
    // Look for the first line that is *not* stack-trace noise — in a Python traceback the useful
    // sentence ("FileNotFoundError: ...") is at the end, while the top is framing. Anything longer
    // than ~90 chars is likely still machine output, so fall back to a plain, honest message.
    const firstLine = message
      .split(/\r?\n/)
      .map((line) => normalizeToastMessage(line))
      .find((line) => line && !/traceback|site-packages|\/Users\//i.test(line));
    const prefix = firstLine && firstLine.length <= 90 ? firstLine : 'Operation failed.';
    // Always point the user at where the full story lives, rather than silently hiding it.
    return { message: `${prefix} See logs for details.`, detail: normalized };
  }

  // Non-errors are simply truncated; the full text stays available as detail.
  return {
    message: `${normalized.slice(0, MAX_TOAST_CHARS - 3)}...`,
    detail: normalized,
  };
}

function createToastStore() {
  let items = $state<ToastItem[]>([]);

  function remove(id: string) { items = items.filter(t => t.id !== id); }

  function add(message: string, kind: ToastKind = 'info') {
    // A unique ID rather than an index: toasts expire on their own timers and out of order, so an
    // index-based key would remove the wrong one.
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
