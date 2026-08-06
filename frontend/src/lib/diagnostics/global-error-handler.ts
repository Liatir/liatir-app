import { liatir } from '$lib/api';

/**
 * Global capture of uncaught JS errors and unhandled promise rejections.
 *
 * The native diagnostics store already gates persistence on the user's
 * `crash_reports_enabled` privacy setting (see bridge/diagnostics.rs), and
 * writes locally only — nothing leaves the machine. This handler simply makes
 * sure errors that would otherwise vanish into the console are recorded, so a
 * beta tester's crash can be diagnosed from the exported diagnostics zip.
 */

let installed = false;

// Cap the payload so a pathological error (e.g. huge serialized object in a
// stack) can never bloat the on-disk record.
const MAX_STACK_CHARS = 8_000;
const MAX_MESSAGE_CHARS = 2_000;

// De-duplicate identical errors within a short window. A render loop throwing
// the same error every frame must not flood the log.
const DEDUPE_WINDOW_MS = 5_000;
const recentErrors = new Map<string, number>();

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
}

function shouldReport(signature: string): boolean {
  const now = Date.now();
  // Opportunistically drop stale entries so the map cannot grow unbounded.
  for (const [key, ts] of recentErrors) {
    if (now - ts > DEDUPE_WINDOW_MS) recentErrors.delete(key);
  }
  const last = recentErrors.get(signature);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recentErrors.set(signature, now);
  return true;
}

type JsErrorPayload = {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
};

function report(payload: JsErrorPayload): void {
  const signature = `${payload.message}::${payload.stack ?? ''}`;
  if (!shouldReport(signature)) return;

  const api = liatir();
  const record = api?.desktop?.diagnostics?.newError?.js;
  if (!record) return;

  // Recording is fire-and-forget and must never throw back into the handler —
  // an error thrown here would re-enter the very listeners we installed.
  try {
    void Promise.resolve(
      record({
        message: truncate(payload.message, MAX_MESSAGE_CHARS),
        filename: payload.filename,
        lineno: payload.lineno as never,
        colno: payload.colno as never,
        stack: payload.stack ? truncate(payload.stack, MAX_STACK_CHARS) : undefined,
      }),
    ).catch(() => {});
  } catch {
    // Swallow — diagnostics must never destabilize the app.
  }
}

function describeRejectionReason(reason: unknown): JsErrorPayload {
  if (reason instanceof Error) {
    return { message: `Unhandled rejection: ${reason.message}`, stack: reason.stack };
  }
  let text: string;
  try {
    text = typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    text = String(reason);
  }
  return { message: `Unhandled rejection: ${text ?? 'unknown'}` };
}

/**
 * Install the global error listeners once. Safe to call on every mount; only
 * the first call wires the listeners. Returns a disposer for symmetry, though
 * the handlers are intended to live for the whole app session.
 */
export function installGlobalErrorHandler(): () => void {
  if (typeof window === 'undefined' || installed) return () => {};
  installed = true;

  const onError = (event: ErrorEvent) => {
    report({
      message: event.message || event.error?.message || 'Uncaught error',
      filename: event.filename || undefined,
      lineno: event.lineno || undefined,
      colno: event.colno || undefined,
      stack: event.error?.stack,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    report(describeRejectionReason(event.reason));
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}
