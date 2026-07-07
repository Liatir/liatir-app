---
title: Utilities
description: Liatir utility functions and low-level runtime helpers.
---

# Bridge Utilities

This page documents small utility APIs exposed by Liatir.

These functions are not tied to a single native API area, but they are useful when you need to interact with the Liatir runtime, open external URLs, or access the low-level Tauri proxy.

## openBrowser

`Liatir.openBrowser()` opens a URL in the user's default external browser.

Use it when you want to send users outside the desktop app, for example to open your website, documentation, support page, billing portal, customer dashboard, or any other external resource.

::: info You may not need openBrowser
In a Liatir app, `window.open()` and `<a target="_blank">` links already open in the user's default external browser by default — no extra API call needed.

Use `Liatir.openBrowser()` only when you need to open a URL from code that cannot rely on those standard web mechanisms, for example from a background handler, a native event callback, or any logic path where there is no user-triggered anchor or `window.open` call.
:::


### Example

```ts
if (!isLiatirAvailable()) {
  throw new Error('Liatir is not available in this environment.');
}

await Liatir.openBrowser('https://liatir.com');
```

If you want to open a URL inside a new native desktop window instead, use the [window API area](/plugins/api/desktop/window):

```ts
await Liatir.desktop.window.new({
  url: 'https://liatir.com'
});
```

### API

```ts
Liatir.openBrowser(url: string): Promise<void>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | The URL to open in the user's default external browser. |

**Returns:** `Promise<void>`

## onReady

`Liatir.onReady()` registers a callback that runs when the Liatir API is loaded and ready.

This is useful when your web app needs to run bridge-dependent logic as soon as the Liatir runtime becomes available.

### Example

```ts
if (!isLiatirAvailable()) {
  throw new Error('Liatir is not available in this environment.');
}

Liatir.onReady(() => {
  console.log('Liatir is ready!');
});
```

### API

```ts
Liatir.onReady(callback: Function): void
```

| Parameter | Type | Description |
| --- | --- | --- |
| `callback` | `Function` | Function executed when the Liatir API is ready. |

**Returns:** `void`

## Tauri proxy

```ts
Liatir.tauri
```

`Liatir.tauri` exposes a low-level proxy to selected Tauri APIs available inside the Liatir runtime.

Use `Liatir.tauri` only when you need direct access to lower-level Tauri primitives such as `core.invoke`, event handling, or the current Tauri window object.

::: warning
`Liatir.tauri` is a low-level advanced API.

Prefer the standard Liatir API areas whenever possible. Direct Tauri access may be more sensitive to internal runtime changes and should be used carefully.
:::

### Availability

`Liatir.tauri` may be `undefined` if the current environment does not expose the underlying Tauri proxy.

Always check that it exists before using it:

```ts
if (!isLiatirAvailable()) {
  throw new Error('Liatir is not available in this environment.');
}

if (!Liatir.tauri) {
  throw new Error('The Tauri proxy is not available in this environment.');
}

console.log(Liatir.tauri);
```

### Invoking a Tauri command

You can use `Liatir.tauri.core.invoke()` to call a Tauri command directly.

```ts
const result = await Liatir.desktop.tauri.core.invoke('some_command', {
  value: 'Hello from Liatir'
});

return result;
```

### Listening to Tauri events

You can listen to Tauri events through `Liatir.tauri.event.listen()`.

```ts
const unlisten = await Liatir.desktop.tauri.event.listen('some-event', (event) => {
  console.log('Received event:', event);
});

// Call this when you no longer need the listener.
unlisten();
```

### Emitting a Tauri event

You can emit a Tauri event through `Liatir.tauri.event.emit()`.

```ts
await Liatir.desktop.tauri.event.emit('some-event', {
  message: 'Hello from Liatir'
});
```

### Getting the current Tauri window

You can access the current Tauri window through `Liatir.tauri.window.getCurrent()`.

```ts
const currentWindow = Liatir.tauri.window.getCurrent();

console.log(currentWindow);
```

---

<div style="color: var(--vp-c-brand-1);">

### TypeScript Interface

</div>

<details>

<summary>The Tauri proxy exposed by Liatir follows this interface</summary>

```ts
interface EventCallback<T> {
  event: string;
  windowLabel: string;
  id: number;
  payload: T;
}

type TauriCore = {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
};

type TauriGlobal = TauriCore | { core: TauriCore };

type TauriArgs = Record<string, unknown>;

type UnlistenFn = () => void;

type TauriCoreExtended = {
  /**
   * Sends a message to the Rust backend.
   *
   * The command must be registered as a Tauri command.
   */
  invoke<T = unknown>(cmd: string, args?: TauriArgs): Promise<T>;

  /**
   * Converts a local file path into an asset URL that can be used inside the WebView.
   */
  convertFileSrc(filePath: string, protocol?: string): string;
};

type TauriEvent = {
  /**
   * Listens to an event emitted by the backend or another window.
   */
  listen<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;

  /**
   * Listens to an event only once.
   */
  once<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;

  /**
   * Emits an event to the backend and other Tauri windows.
   */
  emit(event: string, payload?: unknown): Promise<void>;
};

type TauriWindow = {
  /**
   * Returns the current Tauri window object.
   */
  getCurrent(): any;

  /**
   * Returns all available Tauri window objects.
   */
  getAll(): any[];
};

type TauriMock = {
  /**
   * Mocks IPC calls during tests, when available.
   */
  mockIPC(handler: (cmd: string, args: TauriArgs) => any): void;
};

interface WindowTauri {
  /**
   * Tauri core APIs.
   *
   * In Tauri v2, invoke is exposed under `core`.
   */
  core: TauriCoreExtended;

  /**
   * Tauri event APIs.
   */
  event: TauriEvent;

  /**
   * Tauri window APIs.
   */
  window: TauriWindow;

  /**
   * Optional testing utilities.
   */
  mocks?: TauriMock;

  /**
   * Additional runtime-specific APIs may be exposed here.
   */
  [key: string]: any;
}
```
</details>

---

:::tip Notes
`Liatir.tauri` is intentionally low-level. For most use cases, use the Liatir API areas instead of calling Tauri APIs directly.

Direct Tauri access is useful when you need advanced behavior that is not yet wrapped by a dedicated Liatir API area.
:::
