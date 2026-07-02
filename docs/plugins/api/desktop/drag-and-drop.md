---
title: Drag & Drop API
description: Documentation for the Drag & Drop API area. Learn how to handle file and folder drag-and-drop events within your desktop app.
---


# Drag & Drop API

The **Drag & Drop API** of the Liatir API enables your desktop application to handle drag-and-drop events. This API area integrates with the bridge event system via the `onDragDrop` event, allowing you to respond to drag-and-drop actions performed within the app window.

## Overview

The drag-and-drop event flow is composed of several states, each representing a different phase in the user's interaction:

- **enter**: Emitted when files or folders are first dragged into the application window.
- **hover**: Emitted continuously as the user moves the cursor (with dragged items) within the drop area.
- **drop**: Emitted when the user releases the mouse button, completing the drop action.
- **cancel**: Emitted if the drag operation is aborted (e.g., the user moves the cursor outside the window or presses escape).

Each event provides a payload describing the current state and details about the dragged items.

## Payload Structure

The payload for drag-and-drop events is defined by the `DragDropPayload` type:

```js
DragDropPayload {
  kind: 'enter' | 'hover' | 'drop' | 'cancel';
  paths: string[]; // Array of file or folder paths
  position: { x: number; y: number }; // Cursor position relative to the window
  [k: string]: any; // Additional fields may be present
}
```

| Field      | Type                                   | Description                                                                                   |
|------------|----------------------------------------|-----------------------------------------------------------------------------------------------|
| `kind`     | `'enter'` &#124; `'hover'` &#124; `'drop'` &#124; `'cancel'` | The current state of the drag-and-drop flow.                                                  |
| `paths`    | `string[]`                            | Array of file and/or folder paths involved in the drag operation.                             |
| `position` | `{ x: number; y: number }`            | The cursor position (in pixels) relative to the app window at the time of the event.          |
| `[k: string]: any` | any                           | (Optional) Additional fields, depending on platform or implementation.                        |

## Usage Example

Below is a practical example showing how to listen for and handle drag-and-drop events using the bridge API:

```js
Liatir.events.onDragDrop((payload) => {
  switch (payload.kind) {
    case 'enter':
      console.log('Drag started:', payload.paths, payload.position);
      break;
    case 'hover':
      // Optionally update UI feedback
      break;
    case 'drop':
      console.log('Dropped files/folders:', payload.paths);
      // Handle dropped items here
      break;
    case 'cancel':
      console.log('Drag cancelled');
      break;
  }
});
```
## Notes

:::tip
You can distinguish between the various drag-and-drop event types by checking the `payload.kind` property. This allows you to provide custom UI feedback or handle each stage of the interaction differently.
:::

:::warning
Drag & drop support may vary depending on the operating system.
:::