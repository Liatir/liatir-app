/**
 * Launching Quenta from elsewhere in the app, via URL parameters.
 *
 * A failed run shows an "Explain this failure" button; pressing it opens Quenta already focused on
 * that run, with the right intent, ready to ask. That handoff is carried in the URL — which makes it
 * work uniformly for an in-app navigation, a link, and a separate Quenta window.
 *
 * The parameters are **one-shot**: they describe an action to take on arrival, not a state to stay
 * in. Once consumed they are stripped from the URL, so a page reload does not re-fire the same
 * question, and the back button does not resend it.
 */
import type { LiatirQuentaFocus, LiatirQuentaIntent } from '@liatir/core';

export interface QuentaLaunchRequest {
  intent: LiatirQuentaIntent;
  focus: LiatirQuentaFocus;
  /** Whether to send immediately, or just prefill and let the user press send. */
  autoSend: boolean;
}

/** Removed from the URL once acted upon — see the note about one-shot parameters above. */
const ONE_SHOT_QUENTA_PARAMS = ['intent', 'mode', 'run', 'job', 'auto'] as const;

/** Anything unrecognised falls back to plain chat, so a stale or hand-edited link still works. */
function intentFromParam(value: string | null): LiatirQuentaIntent {
  if (value === 'explain-result' || value === 'explain-failure') return value;
  return 'chat';
}

/**
 * Reads a launch request out of a URL, or `null` if there is nothing to act on.
 *
 * A focus is required: without a run or job to talk *about*, there is no handoff — just a normal
 * visit to the Quenta page.
 */
export function quentaLaunchRequest(url: URL): QuentaLaunchRequest | null {
  const runId = url.searchParams.get('run');
  const jobId = url.searchParams.get('job');
  const focus = runId
    ? { kind: 'result' as const, entityId: runId }
    : jobId
      ? { kind: 'job' as const, entityId: jobId }
      : null;
  if (!focus) return null;
  return {
    // `mode` is accepted as an alias for `intent`, so older links keep working.
    intent: intentFromParam(url.searchParams.get('intent') ?? url.searchParams.get('mode')),
    focus,
    autoSend: url.searchParams.get('auto') === '1',
  };
}

/**
 * The same URL with the one-shot parameters removed. Replacing the history entry with this after
 * handling a launch is what stops a reload from re-asking the question.
 *
 * Note `window` is deliberately *not* in the stripped list: it describes the window itself, not a
 * one-off action, and must survive.
 */
export function consumedQuentaUrl(url: URL): string {
  const consumed = new URL(url);
  for (const parameter of ONE_SHOT_QUENTA_PARAMS) consumed.searchParams.delete(parameter);
  return `${consumed.pathname}${consumed.search}${consumed.hash}`;
}

/**
 * Prepares a route for opening Quenta in its own OS window.
 *
 * The route is asserted rather than trusted: this value ends up as a window's URL, so it must not be
 * possible to open an arbitrary page of the app (or anything else) through this function. The base
 * is a placeholder needed only to parse a relative path.
 */
export function standaloneQuentaUrl(route: string): string {
  const url = new URL(route, 'tauri://localhost');
  if (url.pathname !== '/quenta') throw new Error('Quenta windows must open the Quenta route');
  url.searchParams.set('window', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Builds the link that "Ask Quenta about this" buttons point at.
 *
 * The focus kind decides the parameter name (`run` vs `job`) — the same mapping `quentaLaunchRequest`
 * reads back. Note there is no `auto` here: the user lands with the question prepared but unsent, so
 * they can adjust it before committing.
 */
export function quentaDraftUrl(
  intent: LiatirQuentaIntent,
  focus: LiatirQuentaFocus,
  options: { standalone?: boolean } = {},
): string {
  const params = new URLSearchParams({ intent });
  params.set(focus.kind === 'result' ? 'run' : 'job', focus.entityId);
  if (options.standalone) params.set('window', '1');
  return `/quenta?${params.toString()}`;
}
