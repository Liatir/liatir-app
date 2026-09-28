import type { AppUpdateCheckResult } from '../../../../src-ts/modules/rs/app/_types';
import { liatir } from '$lib/api';
import { settingsStore } from '$lib/stores/settings.svelte';

export type AppUpdateState = 'idle' | 'checking' | 'available' | 'up-to-date' | 'installing' | 'ready' | 'error';

/**
 * Whether the startup notice should open for an update the automatic check found: only when the
 * user has not asked to stop seeing that exact version. A newer one opens it again.
 */
export function shouldOpenUpdateNotice(update: AppUpdateCheckResult, skippedVersion: string | null): boolean {
  return update.available && Boolean(update.version) && update.version !== skippedVersion;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The operation could not be completed.';
}

/**
 * The one application update operation, shared by the startup notice and Settings.
 *
 * The native side keeps the update a check found and installs only that one, so both surfaces must
 * drive the same state rather than each running its own check.
 */
function createAppUpdateStore() {
  let state = $state<AppUpdateState>('idle');
  let update = $state<AppUpdateCheckResult | null>(null);
  let message = $state<string | null>(null);
  let progress = $state<number | null>(null);
  let noticeOpen = $state(false);
  let startupCheckDone = false;
  let progressSubscribed = false;
  let inflight: Promise<void> | null = null;

  async function subscribeToProgress() {
    const api = liatir();
    if (!api || progressSubscribed) return;
    progressSubscribed = true;
    await api.desktop.events.on('app:update-progress', (payload: {
      phase?: string;
      downloadedBytes?: number;
      totalBytes?: number | null;
    }) => {
      if (state !== 'installing') return;
      if (payload.phase === 'downloading') {
        message = 'Downloading the signed update…';
        progress = payload.totalBytes
          ? Math.min(100, Math.round(((payload.downloadedBytes ?? 0) / payload.totalBytes) * 100))
          : null;
      } else if (payload.phase === 'verifying') {
        message = 'Verifying the update signature…';
        progress = null;
      } else if (payload.phase === 'installing') {
        message = 'Installing the verified update…';
        progress = null;
      }
    });
  }

  /**
   * Asks the release feed for a newer version. An automatic check stays silent unless it finds
   * one: being offline, or on a build that updates through a store, is not something to report
   * to a user who asked for nothing.
   */
  async function check({ automatic = false } = {}) {
    // A click during the startup check waits for it rather than being dropped: the native side runs
    // one update operation at a time.
    if (inflight) {
      if (automatic) return;
      await inflight;
    }
    inflight = runCheck(automatic);
    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  async function runCheck(automatic: boolean) {
    const api = liatir();
    if (!api || state === 'installing') return;
    const previous = { state, message };
    state = 'checking';
    message = automatic ? previous.message : 'Contacting the signed release feed…';
    progress = null;
    try {
      const result = await api.desktop.app.updates.check();
      update = result;
      if (result.available) {
        state = 'available';
        message = `Liatir ${result.version} is ready to install.`;
        if (automatic) noticeOpen = shouldOpenUpdateNotice(result, settingsStore.skippedUpdateVersion);
      } else if (automatic) {
        ({ state, message } = previous);
      } else {
        state = 'up-to-date';
        message = `Liatir ${result.currentVersion} is up to date.`;
      }
    } catch (error) {
      if (automatic) {
        ({ state, message } = previous);
      } else {
        state = 'error';
        message = readableError(error);
      }
    }
  }

  /** Runs the automatic check once per launch, when the user has not turned it off. */
  async function checkAtStartup() {
    if (startupCheckDone) return;
    startupCheckDone = true;
    await settingsStore.init();
    if (settingsStore.checkUpdatesAtStartup) await check({ automatic: true });
  }

  async function install() {
    const api = liatir();
    if (!api || state !== 'available') return;
    await subscribeToProgress();
    state = 'installing';
    message = 'Preparing the signed update…';
    progress = null;
    try {
      const result = await api.desktop.app.updates.install();
      state = 'ready';
      message = `Liatir ${result.version} is installed. Restart when you are ready.`;
    } catch (error) {
      state = 'error';
      message = readableError(error);
    }
  }

  async function restart() {
    const api = liatir();
    if (!api) return;
    try {
      await api.desktop.app.updates.restart();
    } catch (error) {
      state = 'error';
      message = readableError(error);
    }
  }

  function closeNotice() {
    noticeOpen = false;
  }

  /** Hides the notice for this version on every future launch; a newer version shows it again. */
  async function skipNoticedVersion() {
    noticeOpen = false;
    if (update?.version) await settingsStore.skipUpdateVersion(update.version);
  }

  return {
    get state() { return state; },
    get update() { return update; },
    get message() { return message; },
    get progress() { return progress; },
    get noticeOpen() { return noticeOpen; },
    check,
    checkAtStartup,
    install,
    restart,
    closeNotice,
    skipNoticedVersion,
  };
}

export const appUpdate = createAppUpdateStore();
