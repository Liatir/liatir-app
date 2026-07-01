---
title: Shortcuts Module
description: Manage global and local keyboard shortcuts.
---


# Shortcuts Module

The **Shortcuts** module allows you to manage keyboard shortcuts for the desktop application. This enables your app to respond to specific key combinations ([accelerators](#accelerators)), improving user experience by providing quick access to common actions.

## Overview

With the Shortcuts Module, you can:

- Register hotkeys to trigger specific actions quickly.
- Listen to keyboard shortcut press and release events.
- Unregister shortcuts when they are no longer needed.
- Check if a shortcut is currently registered.

Typical use cases include implementing keyboard shortcuts for opening dialogs, toggling features, or performing quick commands without navigating menus.

## Methods

| Method            | Parameters                                | Return Type | Description                                         |
|-------------------|------------------------------------------|-------------|-----------------------------------------------------|
| `register()`      | `accelerator: string`, `callback: Function`, `options: ShortcutOptions (optional)`     | `Promise<void>` | Registers a keyboard shortcut with a callback. |
| `unregister()`    | `accelerator: string`                             | `Promise<void>` | Unregisters the shortcut associated with the given [accelerator](#accelerators). |
| `unregisterAll()` | -                                        | `Promise<void>` | Unregisters all registered shortcuts.               |
| `isRegistered()`  | `accelerator: string`                             | `boolean`    | Checks if a shortcut with the given [accelerator](#accelerators) is currently registered. |

### ShortcutOptions

| Field         | Type      | Description                                                        |
|---------------|-----------|--------------------------------------------------------------------|
| `emitEvent (optional)` | `boolean`  | Whether the shortcut should emit an event or not when triggered. |

## Shortcut Event Payload

When a shortcut event is triggered, the event payload contains the following fields:

| Field         | Type      | Description                                                        |
|---------------|-----------|--------------------------------------------------------------------|
| `accelerator` | `string`  | The [accelerator](#accelerators) string representing the shortcut (e.g., `Ctrl+Shift+X`). |
| `shortcut`    | `string`  | The shortcut string triggered (may be the same as `accelerator`). |
| `id`          | `string`  | The unique identifier of the registered shortcut.                 |
| `state`       | `string`  | The state of the shortcut event, typically `"pressed"` or `"released"`. |
| `[key: string]` | `any`    | Additional properties depending on the event context.             |

## Accelerators

*Accelerators* are strings that represent key combinations used to activate shortcuts. They specify one or more keys pressed together or in sequence to trigger an action within the application.

Examples of valid accelerators include:

- `Ctrl+Shift+X`
- `Alt+Enter`
- `Cmd+Option+S`
- `Ctrl+K Ctrl+C`

Note that accelerators reserved by the operating system should not be used, such as `Ctrl+C`, `Cmd+Q`, `Alt+Tab`, and similar combinations, to avoid conflicts and ensure consistent behavior.

| Key     | Description                  |
|---------|------------------------------|
| Ctrl    | Control key (Windows/Linux)  |
| Alt     | Alternate key                |
| Shift   | Shift key                   |
| Cmd     | Command key (macOS)          |
| Option  | Option key (macOS)           |

## Example

```js
// Register a global shortcut for Ctrl+Shift+X
Liatir.globalShortcut.register(
    'Ctrl+Shift+X', // accelerator
    () => {console.log('Ctrl+Shift+X Shortcut triggered!')}, // callback
    {emitEvent: true} // options
);

// Listen for shortcut events
Liatir.events.onShortcut((payload) => {
  if (payload.accelerator === 'Ctrl+Shift+X' && payload.state === 'pressed') {
    // Perform an action
  }
});

// Unregister the shortcut when no longer needed
Liatir.globalShortcut.unregister('Ctrl+Shift+X').then(() => {
  console.log('Shortcut unregistered!');
});
```

## Official OS Shortcut References

For detailed lists of system-reserved keyboard shortcuts, refer to the official OS documentation below.

- **Windows:** [Microsoft Keyboard Shortcuts](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec)
- **macOS:** [Apple Keyboard Shortcuts](https://support.apple.com/en-us/HT201236)
- **GNOME (Linux):** [GNOME Keyboard Shortcuts](https://help.gnome.org/users/gnome-help/stable/keyboard-shortcuts.html)
- **KDE Plasma (Linux):** [KDE Global Shortcuts](https://userbase.kde.org/Keyboard_Shortcuts)

Always verify which key combinations are reserved on each OS before registering global shortcuts in your application.

## Notes

:::tip
To avoid conflicts, always make sure that you haven't registered the same accelerator multiple times, and system predefined accelerators (like Ctrl+C) should not be used.
:::

:::warning
Shortcut behavior may differ across operating systems. Some key combinations are reserved by the OS and cannot be overridden. Test your shortcuts on all target platforms to ensure consistent behavior.
:::
