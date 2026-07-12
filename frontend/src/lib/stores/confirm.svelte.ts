/**
 * A single app-wide confirmation dialog, exposed as a promise.
 *
 * Callers `await confirm({...})` and get a boolean, so a destructive action reads as ordinary
 * sequential code instead of being split across callbacks.
 *
 * The dialog auto-dismisses after a timeout, and it always resolves to **false** when it does.
 * That is the safe default: an unattended prompt must never be taken as approval to delete
 * something.
 */
const TIMEOUT_SECONDS = 30;

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

function createConfirmStore() {
  let open = $state(false);
  let title = $state('Confirm');
  let message = $state('Are you sure?');
  let confirmLabel = $state('Confirm');
  let cancelLabel = $state('Cancel');
  /** Counted down for display, so the user can see the dialog is about to dismiss itself. */
  let secondsLeft = $state(TIMEOUT_SECONDS);

  // The pending promise's resolver, and the countdown timer. Not $state: nothing renders them.
  let resolveFn: ((v: boolean) => void) | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  /** The single exit path — clears the timer, settles the promise, and hides the dialog. */
  function close(result: boolean) {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    resolveFn?.(result);
    // Nulled so a second close() cannot resolve an already-settled promise.
    resolveFn = null;
    open = false;
  }

  return {
    get open() { return open; },
    get title() { return title; },
    get message() { return message; },
    get confirmLabel() { return confirmLabel; },
    get cancelLabel() { return cancelLabel; },
    get secondsLeft() { return secondsLeft; },

    /** Opens the dialog and resolves with the user's answer (or `false` if it times out). */
    show(opts: ConfirmOptions = {}): Promise<boolean> {
      // Clear any previous countdown, so re-opening the dialog does not leave two timers racing to
      // dismiss it.
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }

      title = opts.title ?? 'Confirm';
      message = opts.message ?? 'Are you sure?';
      confirmLabel = opts.confirmLabel ?? 'Confirm';
      cancelLabel = opts.cancelLabel ?? 'Cancel';
      secondsLeft = TIMEOUT_SECONDS;
      open = true;

      const promise = new Promise<boolean>((resolve) => { resolveFn = resolve; });

      // Auto-cancel on timeout — never auto-confirm.
      intervalId = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) close(false);
      }, 1000);

      return promise;
    },

    accept() { close(true); },
    cancel() { close(false); },
  };
}

export const confirmStore = createConfirmStore();

export function confirm(opts?: ConfirmOptions): Promise<boolean> {
  return confirmStore.show(opts);
}
