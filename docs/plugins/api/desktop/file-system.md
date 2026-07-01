---
title: "File System Module"
description: "Comprehensive documentation for the File System module."
---


# File System Module

The File System (shortend Fs) module provides secure and isolated access to the file system. It enables applications to interact with files and directories within predefined scopes, ensuring data integrity and sandboxing from the global file system.

## Overview

The module is organized into several main scopes, each serving a specific purpose:

- **cache**: Temporary storage that should always be used for cached data that can be purged without loss of critical information.
- **data**: Persistent storage for application data and files.
- **trash**: A recycle bin area where deleted files are temporarily held before permanent removal.
- **diagnostics**: Access to diagnostic files and logs for troubleshooting and monitoring.

These scopes help maintain data organization, security, and lifecycle management within the Liatir environment and can't be changed.

## Methods

| Property      | Type          | Description                                            |
|---------------|---------------|--------------------------------------------------------|
| `cache`       | `FsScopeMethods` | Methods to interact with the cache scope.              |
| `data`        | `FsScopeMethods` | Methods to interact with the persistent data scope.    |
| `pluginFs`        | `(plugin: string) => FsPluginMethods` | Retruns an interface you can use to interact with the persistent storage of the specified plugin.    |
| `paths`       | `FsPaths`     | Provides base paths for all scopes.                     |
| `base`        | `string`      | The root base path for all file system operations.     |
| `trash`       | `FsTrashMethods` | Methods to manage files in the trash scope.             |
| `diagnostics` | `FsDiagnosticMethods` | Methods to access diagnostic files and logs.            |

### FsPaths

| Field       | Type    | Description                                  |
|-------------|---------|----------------------------------------------|
| `cache`     | string  | Base path for the cache scope.                |
| `data`      | string  | Base path for the data scope.                 |
| `trash`     | string  | Base path for the trash scope.                |
| `diagnostics`| string | Base path for the diagnostics scope.          |

### FsScopeMethods

| Method           | Signature                                    | Description                                         |
|------------------|----------------------------------------------|-----------------------------------------------------|
| `listContent`    | `(path: string) => Promise<FsEntry[]>`       | Lists files and directories within the specified path. |
| `newDirectory`   | `(path: string) => Promise<void>`             | Creates a new directory at the given path.          |
| `remove`         | `(path: string) => Promise<void>`             | Deletes a file or directory at the specified path.  |
| `stat`           | `(path: string) => Promise<FsEntry>`          | Retrieves metadata about a file or directory.       |
| `writeText`      | `(path: string, content: string) => Promise<void>` | Writes text content to a file at the specified path. |
| `readText`       | `(path: string) => Promise<string>`           | Reads text content from a file at the specified path. |
| `writeBytes`     | `(path: string, data: Uint8Array) => Promise<void>` | Writes binary data to a file at the specified path.  |
| `readBytes`      | `(path: string) => Promise<Uint8Array>`       | Reads binary data from a file at the specified path. |
| `exists`         | `(path: string) => Promise<boolean>`          | Checks if a file or directory exists at the given path. |
| `move`           | `(source: string, destination: string) => Promise<void>` | Moves a file or directory to a new location.          |
| `copy`           | `(source: string, destination: string) => Promise<void>` | Copies a file or directory to a new location.         |
| `clear`          | `() => Promise<void>`                          | Clears all contents within the scope.                 |
| `path`           | `(relativePath: string) => string`            | Resolves and returns an absolute path within the scope. |
| `base`           | `string`                                      | The base path of the current scope.                    |

### FsTrashMethods

| Method           | Signature                                    | Description                                         |
|------------------|----------------------------------------------|-----------------------------------------------------|
| `listContent`    | `(path: string) => Promise<FsEntry[]>`       | Lists files and directories within the specified path. |
| `recover`   | `(path: string) => Promise<void>`             | Recovers a file or directory at the specified path.          |
| `clear`         | `(path: string) => Promise<void>`             | Clears all contents within the trash scope.  |
| `stat`           | `(path: string) => Promise<FsEntry>`          | Retrieves metadata about a file or directory.       |
| `readText`       | `(path: string) => Promise<string>`           | Reads text content from a file at the specified path. |
| `readBytes`      | `(path: string) => Promise<Uint8Array>`       | Reads binary data from a file at the specified path. |
| `exists`         | `(path: string) => Promise<boolean>`          | Checks if a file or directory exists at the given path. |

### FsScopeMethods

| Method           | Signature                                    | Description                                         |
|------------------|----------------------------------------------|-----------------------------------------------------|
| `listContent`    | `(path: string) => Promise<FsEntry[]>`       | Lists files and directories within the specified path. |
| `remove`         | `(path: string) => Promise<void>`             | Deletes a file or directory at the specified path.  |
| `clear`         | `(path: string) => Promise<void>`             | Clears all contents within the trash scope.  |
| `stat`           | `(path: string) => Promise<FsEntry>`          | Retrieves metadata about a file or directory.       |
| `readText`       | `(path: string) => Promise<string>`           | Reads text content from a file at the specified path. |
| `readBytes`      | `(path: string) => Promise<Uint8Array>`       | Reads binary data from a file at the specified path. |
| `exists`         | `(path: string) => Promise<boolean>`          | Checks if a file or directory exists at the given path. |

### FsEntry

| Field       | Type    | Description                                 |
|-------------|---------|---------------------------------------------|
| `name`      | string  | The name of the file or directory.           |
| `path`      | string  | The full path to the entry within the scope.|
| `isFile`    | boolean | Indicates if the entry is a file.             |
| `isDirectory`| boolean| Indicates if the entry is a directory.        |
| `size`      | number  | Size of the file in bytes (0 for directories).|
| `lastModified`| Date   | Timestamp of the last modification.           |


### FsPluginMethods

> All the following methods only apply within the specified plugin storage scope.

| Method           | Signature                                    | Description                                         |
|------------------|----------------------------------------------|-----------------------------------------------------|
| `listContent`    | `(path: string) => Promise<FsEntry[]>`       | Lists files and directories within the specified path. |
| `newDirectory`   | `(path: string) => Promise<void>`             | Creates a new directory at the given path.          |
| `remove`         | `(path: string) => Promise<void>`             | Deletes a file or directory at the specified path.  |
| `stat`           | `(path: string) => Promise<FsEntry>`          | Retrieves metadata about a file or directory.       |
| `writeText`      | `(path: string, content: string) => Promise<void>` | Writes text content to a file at the specified path. |
| `readText`       | `(path: string) => Promise<string>`           | Reads text content from a file at the specified path. |
| `writeBytes`     | `(path: string, data: Uint8Array) => Promise<void>` | Writes binary data to a file at the specified path.  |
| `readBytes`      | `(path: string) => Promise<Uint8Array>`       | Reads binary data from a file at the specified path. |
| `exists`         | `(path: string) => Promise<boolean>`          | Checks if a file or directory exists at the given path. |
| `move`           | `(source: string, destination: string) => Promise<void>` | Moves a file or directory to a new location.          |
| `copy`           | `(source: string, destination: string) => Promise<void>` | Copies a file or directory to a new location.         |
| `clearStorage`           | `() => Promise<void>` | Clears all contents within the current plugin storage scope.         |


## Example Usage

```ts
// Writing a text file to the data (persistent) scope
await Liatir.desktop.fs.data.writeText('notes/todo.txt', 'Remember to review the documentation.');

// Reading the text file back
const content = await Liatir.desktop.fs.data.readText('notes/todo.txt');
console.log(content); // Output: Remember to review the documentation.
```

## Notes

:::tip
The `cache` namespace is intended for temporary files that can be cleared without affecting user data, while the `data` namespace is for persistent files that should be preserved across sessions and backups.
:::

:::warning
Access through the File System module is strictly limited to the Liatir isolated environment. It does not provide access to the global file system of the host machine, ensuring security and sandboxing.
:::
