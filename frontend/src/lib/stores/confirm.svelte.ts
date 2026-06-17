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
  let secondsLeft = $state(TIMEOUT_SECONDS);

  let resolveFn: ((v: boolean) => void) | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function close(result: boolean) {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    resolveFn?.(result);
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

    show(opts: ConfirmOptions = {}): Promise<boolean> {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }

      title = opts.title ?? 'Confirm';
      message = opts.message ?? 'Are you sure?';
      confirmLabel = opts.confirmLabel ?? 'Confirm';
      cancelLabel = opts.cancelLabel ?? 'Cancel';
      secondsLeft = TIMEOUT_SECONDS;
      open = true;

      const promise = new Promise<boolean>((resolve) => { resolveFn = resolve; });

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
