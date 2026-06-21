type ToastKind = 'success' | 'error' | 'info' | 'warn';
interface ToastItem { id: string; message: string; kind: ToastKind; }

function createToastStore() {
  let items = $state<ToastItem[]>([]);

  function remove(id: string) { items = items.filter(t => t.id !== id); }

  function add(message: string, kind: ToastKind = 'info') {
    const id = crypto.randomUUID();
    items = [...items, { id, message, kind }];
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
