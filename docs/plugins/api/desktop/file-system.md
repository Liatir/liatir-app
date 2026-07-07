---
title: "File System API"
description: "Comprehensive documentation for the File System API area."
---


# .desktop.fs

The **File System API** area provides secure and isolated access to the file system. It enables applications to interact with files and directories within predefined scopes, ensuring data integrity and sandboxing from the global file system.

## Overview

The API area is organized into several main scopes, each serving a specific purpose:

- **cache**: Temporary storage that should always be used for cached data that can be purged without loss of critical information.
- **data**: Persistent storage for application data and files.
- **pluginFs** / **plugin_fs**: Persistent storage of a specified plugin.

These scopes help maintain data organization, security, and lifecycle management within the Liatir environment and can't be changed.

## Scopes

<Tabs>
<Tab title="Node">

| Property       | Type               | Description                                            |
|----------------|--------------------|--------------------------------------------------------|
| `cache`        | `FsScopeMethods`   | Methods to interact with the cache scope.              |
| `data`         | `FsScopeMethods`   | Methods to interact with the persistent data scope.    |
| `pluginFs(name)` | `FsPluginMethods` | Returns an interface for the specified plugin storage. |

</Tab>
<Tab title="Python">

| Property         | Type               | Description                                            |
|------------------|--------------------|--------------------------------------------------------|
| `cache`          | `FsScopeMethods`   | Methods to interact with the cache scope.              |
| `data`           | `FsScopeMethods`   | Methods to interact with the persistent data scope.    |
| `plugin_fs(name)` | `FsPluginMethods` | Returns an interface for the specified plugin storage. |

</Tab>
</Tabs>

### FsPaths

| Field   | Type   | Description                   |
|---------|--------|-------------------------------|
| `cache` | string | Base path for the cache scope.|
| `data`  | string | Base path for the data scope. |

### FsScopeMethods

Methods available on `data`, `cache`, and `pluginFs` / `plugin_fs` scopes.

<Tabs>
<Tab title="Node">

| Method                                  | Returns              | Description                                         |
|-----------------------------------------|----------------------|-----------------------------------------------------|
| `listContent(path)`                     | `Promise<FsEntry[]>` | Lists files and directories within the specified path. |
| `newDirectory(path)`                    | `Promise<void>`      | Creates a new directory at the given path.          |
| `remove(path, recursive?)`              | `Promise<void>`      | Deletes a file or directory at the specified path.  |
| `stat(path)`                            | `Promise<FsEntry>`   | Retrieves metadata about a file or directory.       |
| `writeText(path, content, opts?)`       | `Promise<void>`      | Writes text content to a file.                      |
| `readText(path)`                        | `Promise<string>`    | Reads text content from a file.                     |
| `writeBytes(path, data, opts?)`         | `Promise<void>`      | Writes binary data to a file.                       |
| `readBytes(path)`                       | `Promise<Uint8Array>`| Reads binary data from a file.                      |
| `exists(path)`                          | `Promise<boolean>`   | Checks if a file or directory exists.               |
| `move(source, destination, opts?)`      | `Promise<void>`      | Moves a file or directory to a new location.        |
| `copy(source, destination, opts?)`      | `Promise<void>`      | Copies a file or directory.                         |
| `clear()`                               | `Promise<void>`      | Clears all contents within the scope.               |
| `path()`                                | `Promise<string>`    | Returns the base path of the scope.                 |

</Tab>
<Tab title="Python">

| Method                                                        | Returns      | Description                                         |
|---------------------------------------------------------------|--------------|-----------------------------------------------------|
| `list_content(path="")`                                       | `list[dict]` | Lists files and directories within the specified path. |
| `new_directory(path)`                                         | `None`       | Creates a new directory at the given path.          |
| `remove(path, recursive=False)`                               | `None`       | Deletes a file or directory at the specified path.  |
| `stat(path="")`                                               | `dict`       | Retrieves metadata about a file or directory.       |
| `write_text(path, contents, create_dirs=None, append=None)`   | `None`       | Writes text content to a file.                      |
| `read_text(path)`                                             | `str`        | Reads text content from a file.                     |
| `write_bytes(path, data_base64, create_dirs=None)`            | `None`       | Writes binary data to a file.                       |
| `read_bytes(path)`                                            | `str`        | Reads binary data from a file (base64).             |
| `exists(path)`                                                | `bool`       | Checks if a file or directory exists.               |
| `move(src, dest, create_dirs=None, overwrite=None)`           | `None`       | Moves a file or directory to a new location.        |
| `copy(src, dest, recursive=None, create_dirs=None, overwrite=None)` | `None` | Copies a file or directory.                         |
| `clear()`                                                     | `None`       | Clears all contents within the scope.               |
| `path()`                                                      | `str`        | Returns the base path of the scope.                 |

</Tab>
</Tabs>

### FsEntry

| Field          | Type    | Description                                  |
|----------------|---------|----------------------------------------------|
| `name`         | string  | The name of the file or directory.           |
| `path`         | string  | The full path to the entry within the scope. |
| `isFile`       | boolean | Indicates if the entry is a file.            |
| `isDirectory`  | boolean | Indicates if the entry is a directory.       |
| `size`         | number  | Size of the file in bytes (0 for directories).|
| `lastModified` | Date    | Timestamp of the last modification.          |

::: warning NOTE
`FsEntry` fields are always camelCase in both Node and Python, because they
come from the JSON response of the Liatir bridge.
:::

### FsPluginMethods

> All the following methods only apply within the specified plugin storage scope.
> They are identical to `FsScopeMethods` with one addition:

<Tabs>
<Tab title="Node">

| Method          | Returns         | Description                                         |
|-----------------|-----------------|-----------------------------------------------------|
| `clearStorage()`| `Promise<void>` | Clears all contents within the plugin storage scope.|

</Tab>
<Tab title="Python">

| Method           | Returns | Description                                         |
|------------------|---------|-----------------------------------------------------|
| `clear_storage()`| `None`  | Clears all contents within the plugin storage scope.|

</Tab>
</Tabs>


## Example Usage

<Tabs>
<Tab title="Node">

```ts
// Writing a text file to the data (persistent) scope
await Liatir.desktop.fs.data.writeText('notes/todo.txt', 'Remember to review the documentation.');

// Reading the text file back
const content = await Liatir.desktop.fs.data.readText('notes/todo.txt');
console.log(content);

// Using plugin-specific storage
const pluginFs = Liatir.desktop.fs.pluginFs('my-plugin');
await pluginFs.writeText('config.json', JSON.stringify({ theme: 'dark' }));
```

</Tab>
<Tab title="Python">

```python
# Writing a text file to the data (persistent) scope
ctx.liatir.desktop.fs.data.write_text('notes/todo.txt', 'Remember to review the documentation.')

# Reading the text file back
content = ctx.liatir.desktop.fs.data.read_text('notes/todo.txt')
print(content)

# Using plugin-specific storage
plugin_fs = ctx.liatir.desktop.fs.plugin_fs('my-plugin')
plugin_fs.write_text('config.json', json.dumps({'theme': 'dark'}))
```

</Tab>
</Tabs>

## Notes

:::tip
The `cache` namespace is intended for temporary files that will be cleared, while `data` and `pluginFs` / `plugin_fs` namespaces are meant for persistent files that should be preserved across sessions.
:::

:::warning
Access through the File System API area is strictly limited to the Liatir isolated environment. It does not provide access to the global file system of the local machine, ensuring security and sandboxing.
:::