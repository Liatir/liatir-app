---
title: Window API
description: The Window API area of the Liatir API provides methods to manage native app windows, including opening, closing, resizing, fullscreen, and developer tools management.
---


# Window API

The `window` API area provides methods to manage the native app windows. It allows you to open new windows, close or minimize existing ones, toggle fullscreen mode, and control developer tools. This API area is essential for applications that require multiple windows or advanced window management features.

## Overview

Common use cases for the `window` API area include:

- Opening additional windows.
- Managing fullscreen, minimized and maximized modes.
- Closing specific windows by their unique labels.

## API Reference

| Method                         | Description                                                                                   |
|-------------------------------|-----------------------------------------------------------------------------------------------|
| `new(options?)`                | Opens a new window with **optional** parameters: `label` (*string*), `url` (*string*), and `fullscreen` (*boolean*).          |
| `close(label)`                 | Closes a specific window by its unique label.                                                 |
| `minimize()`                  | Minimizes the active window.                                                                   |
| `maximizeToggle()`            | Toggles between maximizing and restoring the active window.                                   |
| `fullscreen(enable)`          | Enables or disables fullscreen mode for the active window.                                   |

### Method Details

- `new(options?: { label?: string; url?: string; fullscreen?: boolean }): Promise<void>`  
  Opens a new window. You can specify a unique `label` for the window, a `url` to load, and whether the window should start in `fullscreen` mode.

- `close(label: string): Promise<void>`  
  Closes the window identified by the given `label`.

- `minimize(): Promise<void>`  
  Minimizes the currently active window.

- `maximizeToggle(): Promise<void>`  
  Toggles the currently active window between maximized and restored states.

- `fullscreen(enable: boolean): Promise<void>`  
  Enables (`true`) or disables (`false`) fullscreen mode for the active window.

## Notes

:::tip
Each window has a unique `label` that is used as a reference by the bridge. This label is essential for targeting specific windows when calling methods. The label for the main window is `main`.
:::

:::warning
Some operations might not behave the same on every platform, always test any implementation.
:::
