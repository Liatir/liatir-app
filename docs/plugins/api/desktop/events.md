---
title: Events Module
description: Comprehensive guide to the Events Module for managing and listening to internal and external events.
---

# Events Module

The **Events Module** lets you emit and listen to events across windows and bridge components. All listener methods return a `Promise` that resolves to an **unlisten function** — call it when the listener is no longer needed to avoid memory leaks.

## Methods

### Emitting

| Method | Description |
|--------|-------------|
| `emit(event, payload?)` | Emits an event to the **current window** only. |
| `emitToAll(event, payload?)` | Emits an event to **all open windows**. |
| `emitTo(windowLabel, event, payload?)` | Emits an event to the window identified by `windowLabel`. |

### Listening

| Method | Handler signature | Return type |
|--------|------------------|-------------|
| `on(event, handler)` | `(payload) => void` | `Promise<() => void>` |
| `once(event)` | <hr> | `Promise<any>` |
| `onMany(events[], handler)` | `(eventName, payload) => void` | `Promise<() => void>` |
| `onNetworkStatus(handler)` | `(payload) => void` | `Promise<() => void>` |
| `onDeeplink(handler)` | `(payload) => void` | `Promise<() => void>` |
| `onShortcut(handler)` | `(payload) => void` | `Promise<() => void>` |
| `onDragDrop(handler, options?)` | `(eventName, payload) => void` | `Promise<() => void>` |
| `onMenuEvent(handler)` | `(payload) => void` | `Promise<() => void>` |
| `onTrayIconEvent(handler)` | `(payload) => void` | `Promise<() => void>` |

## Unsubscribing

Every listener method returns a `Promise` that resolves to an unlisten function. **Always `await` the call** — without `await`, you hold a `Promise` object, not the unlisten function.

```js
// ✅ Correct
const unlisten = await Liatir.desktop.events.on('data:refresh', (payload) => {
  console.log(payload);
});

// Later, when the component unmounts or the listener is no longer needed:
unlisten();
```

```js
// ❌ Wrong — you need 'await' otherwise 'unlisten' is a Promise, not a function
const unlisten = Liatir.events.on('data:refresh', handler);
unlisten(); // TypeError
```

## Examples

### `on` — persistent listener

```js
const unlisten = await Liatir.desktop.events.on('order:updated', (payload) => {
  console.log('Order updated:', payload);
});

// Remove the listener when done
unlisten();
```

### `once` — wait for a single event

`once` returns a Promise that resolves with the event payload the first time the event fires. It automatically unsubscribes after the first occurrence — no unlisten needed.

```js
const payload = await Liatir.desktop.events.once('auth:token-ready');
console.log('Token received:', payload);
```

### `onMany` — one handler for multiple events

The handler receives the event name as its first argument, so you can branch on it.

```js
const unlisten = await Liatir.desktop.events.onMany(
  ['cart:add', 'cart:remove', 'cart:clear'],
  (eventName, payload) => {
    if (eventName === 'cart:clear') resetCart();
    else updateCart(eventName, payload);
  }
);
```

### `onNetworkStatus` — online/offline

```js
const unlisten = await Liatir.desktop.events.onNetworkStatus(({ online, reason, latency_ms }) => {
  console.log(online ? `Online (${latency_ms}ms)` : `Offline — ${reason}`);
});
```

### `onDeeplink` — deep link navigation

```js
const unlisten = await Liatir.desktop.events.onDeeplink(({ scheme, segments, query, raw }) => {
  // e.g. myapp://reset-password?token=abc
  console.log(scheme, segments.list, query);
});
```

### `onShortcut` — global keyboard shortcuts

Fires when a shortcut registered via `Liatir.globalShortcut.register()` is triggered.

```js
const unlisten = await Liatir.desktop.events.onShortcut(({ accelerator, state }) => {
  if (state === 'Pressed') handleShortcut(accelerator);
});
```

### `onDragDrop` — file drag and drop

By default listens to `dragdrop:enter`, `dragdrop:drop`, and `dragdrop:cancel`. Pass `{ includeHover: true }` to also receive dragdrop:hover events while files are being dragged over the window.

```js
const unlisten = await Liatir.desktop.events.onDragDrop(
  (eventName, { kind, paths, position }) => {
    if (kind === 'drop') {
      console.log('Files dropped:', paths);
    }
  },
  { includeHover: true }
);

unlisten();
```

### `onMenuEvent` / `onTrayIconEvent`

```js
const unlistenMenu = await Liatir.desktop.events.onMenuEvent((payload) => {
  console.log('Menu action:', payload);
});

const unlistenTray = await Liatir.desktop.events.onTrayIconEvent((payload) => {
  console.log('Tray interaction:', payload);
});
```

## Payload types

| Event source | Relevant fields |
|-|-|
| onNetworkStatus | online: `boolean`, reason: `"ok"  \|  "dns"  \|  "timeout"  \|  "unknown"`, latency_ms?: `number` |
| onDeeplink | scheme: `string`, segments: `{ first, last, list }`, query: `Record<string, string>`, raw: `string` |
| onShortcut | accelerator: `string`, shortcut: `string`, id: `number`, state: `"Pressed"  \|  "Released"` |
| onDragDrop | kind: `"enter"  \|  "hover"  \|  "drop"  \|  "cancel"`, paths: `string[]`, position?: `{ x, y }` |

## Notes

:::tip Cleanup pattern in components
If you are using a framework, store unlisten functions and call them on component teardown:

```js
// Svelte
import { onDestroy } from 'svelte';

const unlisten = await Liatir.desktop.events.on('my:event', handler);
onDestroy(unlisten);

// React
useEffect(() => {
  let unlisten;
  Liatir.events.on('my:event', handler).then(fn => { unlisten = fn; });
  return () => unlisten?.();
}, []);

```
:::

:::warning Forgetting to unlisten
Each call to on registers a new listener. If your component re-renders or re-mounts without cleaning up, the same event will be handled multiple times. Always pair each on call with a corresponding unlisten().
:::
