---
title: Files Module
description: Documentation for the Files module of Liatir API, providing native file open and save dialogs with byte-level file content access.
---


# Files Module

The `files` module provides an interface to open and save files through native system dialogs. It supports reading file contents not only as paths but also directly as bytes, enabling more flexible and advanced file handling in your applications.

## Overview

The main use cases of the `files` module are:

- **open**: Open files using a native dialog, returning file paths and metadata.
- **openWithBytes**: Similar to `open`, but also returns the raw bytes of the selected files.
- **save**: Open a native save dialog to save files with a default file name.

The key difference between `open` and `openWithBytes` is that `openWithBytes` provides the file contents as bytes, which is useful when you need to process or upload files without relying on file system paths.

## Methods

| Method             | Description                                                                                       | Parameters                                                                                   |
|--------------------|-------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| `open(options)`     | Opens a native file open dialog. Returns file paths and metadata.                               | `options` (object):<br>- `multi` (boolean): Allows selecting multiple files.<br>- `allowed` (string[]): Array of allowed file extensions.<br>- `maxBytes` (number): Maximum allowed file size in bytes. |
| `openWithBytes(options)` | Opens a native file open dialog and returns file contents as bytes along with metadata.        | Same as `open(options)`.                                                                     |
| `save(defaultName)` | Opens a native save dialog with a default file name. Returns the selected save path.            | `defaultName` (string): Suggested default file name for saving.                              |

## Types

### OpenResult

Represents the result of the `open` method.

| Field    | Type           | Description                          |
|----------|----------------|------------------------------------|
| `files`  | string[]       | Array of selected file paths.       |

### OpenResultWithBytes

Represents the result of the `openWithBytes` method.

| Field    | Type             | Description                          |
|----------|------------------|------------------------------------|
| `files`  | [FileWithBytes](#filewithbytes)[]   | Array of selected files with bytes. |

### FileWithBytes

Represents a file with its content as bytes.

| Field    | Type     | Description                   |
|----------|----------|-------------------------------|
| `name`   | string   | The name of the file.          |
| `path`   | string   | The full path to the file.     |
| `bytes`  | Uint8Array | The raw file content in bytes. |

## Example

```js
// 1. Open one or more files (paths only)
const result = await Liatir.desktop.files.open({
  multi: true,
  allowed: ['.txt', '.md'],
  maxBytes: 5 * 1024 * 1024, // 5 MB max
});
console.log('Selected file paths:', result.files);

// 2. Open files and read their bytes
const resultWithBytes = await Liatir.desktop.files.openWithBytes({
  multi: false,
  allowed: ['.png', '.jpg'],
});
resultWithBytes.files.forEach(file => {
  console.log(`File name: ${file.name}, size: ${file.bytes.length} bytes`);
  // Process the file.bytes as needed
});

// 3. Save a file with a default name
const savePath = await Liatir.desktop.files.save('document.txt');
console.log('File will be saved to:', savePath);
```

## Notes

:::tip
Use `openWithBytes` when you need direct access to the file contents as bytes, for example, when uploading files to a server or processing file data in memory. Use `open` if you only need file paths and will handle file reading separately.
:::

:::warning
The maximum file size allowed (`maxBytes`) depends on the operating system and available system resources. Be mindful of these limits to avoid errors when opening large files.
:::
