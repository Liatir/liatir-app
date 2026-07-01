---
title: Notifications Module
description: Send and manage native desktop notifications from your web app using the Liatir API API.
---

# Notifications Module

The `Notifications` module exposes a minimal interface for reading the current notification permission state, requesting permission from the user, and showing a notification.

:::tip Notifications on macOS
On macOS, a granted notification permission does not always mean notifications will appear as visible banners. Notifications may still be delivered silently and placed only in Notification Center, depending on the app’s notification settings in System Settings and the selected alert style. If notifications seem to “not work,” first check whether they are being collected in Notification Center and review the app’s macOS notification preferences.
:::

## API Reference

| Method                                     | Description                                                        |
|-----------------------------------------------|--------------------------------------------------------------------|
| `state()`                                | Returns the current notification permission state.   |
| `request()`                     | Requests permission to send notifications.   |
| `show(title, body)`    | Displays a notification with a title and body text.                        |

### Module Interface

```ts
interface NotificationsInterface = {
  state: () => Promise<NotificationPermission>;
  request: () => Promise<Exclude<NotificationPermission, "default"> | string>;
  show: (title: string, body: string) => Promise<void>;
}
```

## Methods

### `state()`

Returns the current notification permission state.

**Signature**

```ts
state: () => Promise<NotificationPermission>;
```

**Returns**

- `"granted"`: notifications are allowed.
- `"denied"`: notifications have been denied.
- `"default"`: the user has not made a choice yet.
- `string`: any additional value returned by the implementation.

**Example**

```ts
import { Liatir, isLiatirAvailable } from "liatir";

const permission = await Liatir.desktop.notifications.state();

if (permission === "granted") {
  console.log("Notifications enabled");
}
```

---

### `request()`

Requests permission to send notifications.

**Signature**

```ts
request: () => Promise<Exclude<NotificationPermission, "default"> | string>;
```

**Returns**

- `"granted"`: permission was granted.
- `"denied"`: permission was denied.
- `string`: any additional value returned by the implementation.

> `request()` does not return `"default"` in its declared type.

**Example**

```ts
import { Liatir, isLiatirAvailable } from "liatir";

const permission = await Liatir.desktop.notifications.request();

if (permission !== "granted") {
  return;
}
```

---

### `show(title, body)`

Displays a notification with a title and body text.

**Signature**

```ts
show: (title: string, body: string) => Promise<void>;
```

**Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `title` | `string` | Notification title. |
| `body` | `string` | Notification body text. |

**Returns**

- `Promise<void>`

**Example**

```ts
import { Liatir, isLiatirAvailable } from "liatir";

await Liatir.desktop.notifications.show("Build completed", "Your desktop app is ready.");
```

## Recommended flow

In most cases, the recommended flow is:

1. Read the current state with `state()`.
2. If needed, request permission with `request()`.
3. Call `show()` only when permission is available.

```ts
import { Liatir, isLiatirAvailable } from "liatir";

const currentState = await Liatir.desktop.notifications.state();

if (currentState !== "granted") {
  const requested = await Liatir.desktop.notifications.request();

  if (requested !== "granted") {
    return;
  }
}

await Liatir.desktop.notifications.show("Operation completed", "The process finished successfully.");
```

## Types

| Name | Type | Description |
| --- | --- | --- |
| **NotificationPermission** | `"granted" \| "denied" \| "default" \| string` | Represents the permission value returned by the module methods. |


## Notes

- `state()` can return `"default"` when the permission has not been decided yet.
- `request()` is typed to return a value other than `"default"`.
- `show()` only accepts two arguments: `title` and `body`.
- The interface does not expose additional options such as icon, tag, duration, or callbacks.
