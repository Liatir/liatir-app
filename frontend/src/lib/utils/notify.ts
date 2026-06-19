import { liatir } from '$lib/api';

let permChecked = false;
let permGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (permChecked) return permGranted;
  const api = liatir();
  if (!api) return false;
  try {
    const state = await api.desktop.notifications.state();
    if (state === 'granted') {
      permGranted = true; permChecked = true; return true;
    }
    if (state === 'denied') {
      permChecked = true; return false;
    }
    const result = await api.desktop.notifications.request();
    permGranted = result === 'granted';
    permChecked = true;
    return permGranted;
  } catch { return false; }
}

/**
 * Show a native desktop notification.
 * If `durationMs` is provided, only notifies when >= MIN_MS (skip fast runs).
 * Errors (no durationMs) always notify.
 */
const MIN_MS = 10_000;

export async function notify(title: string, body: string, durationMs?: number): Promise<void> {
  if (durationMs !== undefined && durationMs < MIN_MS) return;
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    await liatir()?.desktop.notifications.show(title, body);
  } catch { /* notification suppressed */ }
}
