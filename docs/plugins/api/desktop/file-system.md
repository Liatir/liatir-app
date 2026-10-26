---
title: "File System API"
description: "Comprehensive documentation for the File System API area."
---


# `.desktop.fs`

The **File System API** reads and writes files inside Liatir-managed storage
scopes. Node, Python, R and Native can all use it. These scopes organize bridge
access; they do not sandbox the language's own operating-system APIs. WASM uses
its own sandbox mounts and has no access to this bridge.

## Overview

The API area is organized into several main scopes, each serving a specific purpose:

- **cache**: Temporary storage that should always be used for cached data that can be purged without loss of critical information.
- **data**: Persistent storage for application data and files.
- **pluginFs** / **plugin_fs**: Persistent storage of a specified plugin.

Use paths relative to the chosen scope. During `liatir dev`, storage is
redirected to the temporary session and workspace; it is removed at session end.

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
<Tab title="R">

```r
fs <- ctx$liatir$desktop$fs
data <- fs$data
cache <- fs$cache
storage <- fs$plugin_fs("my-plugin")
```

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
let fs = ctx.liatir.desktop().fs();
let data = fs.data();
let cache = fs.cache();
let storage = fs.plugin_fs("my-plugin")?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto roots = liatir::paths();
json data_scope = {{"permanent", true}};
json cache_scope = {{"permanent", false}};
json plugin_scope = {{"permanent", true}, {"pluginStoragePlugin", "my-plugin.wasm"}};
```

</Tab>
</Tabs>
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
| `writeBytes(path, base64, opts?)`         | `Promise<void>`      | Writes a base64-encoded string to a file.                       |
| `readBytes(path)`                       | `Promise<string>`| Reads a file as a base64 string.                      |
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
| `write_bytes(path, data_base64, create_dirs=None)`            | `None`       | Writes a base64-encoded string to a file.                       |
| `read_bytes(path)`                                            | `str`        | Reads binary data from a file (base64).             |
| `exists(path)`                                                | `bool`       | Checks if a file or directory exists.               |
| `move(src, dest, create_dirs=None, overwrite=None)`           | `None`       | Moves a file or directory to a new location.        |
| `copy(src, dest, recursive=None, create_dirs=None, overwrite=None)` | `None` | Copies a file or directory.                         |
| `clear()`                                                     | `None`       | Clears all contents within the scope.               |
| `path()`                                                      | `str`        | Returns the base path of the scope.                 |

</Tab>
<Tab title="R">

Call these on `ctx$liatir$desktop$fs$data`, `$cache`, or the object returned
by `$plugin_fs(name)`:

| Method | Result |
| --- | --- |
| `list_content(rel = "")` | List of file entries. |
| `new_directory(rel)` | Creates a directory. |
| `remove(rel, recursive = FALSE)` | Removes a file/directory. |
| `stat(rel = "")` | File entry as a named list. |
| `write_text(rel, contents, create_dirs = TRUE, append = FALSE)` | Writes text. |
| `read_text(rel)` | Text string. |
| `write_bytes(rel, data_base64, create_dirs = TRUE)` | Writes a base64 string. |
| `read_bytes(rel)` | Base64 string. |
| `exists(rel)` | Logical scalar. |
| `move(src, dest, create_dirs = TRUE, overwrite = FALSE)` | Moves a file/directory. |
| `copy(src, dest, recursive = FALSE, create_dirs = TRUE, overwrite = FALSE)` | Copies a file/directory. |
| `path()` | Absolute scope root. |
| `clear()` | Clears the data/cache scope; use `clear_storage()` for Plugin storage. |

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

Call these on `ctx.liatir.desktop().fs().data()`, `.cache()`, or the scope
returned by `.plugin_fs(name)?`. Each returns `Result<Value>`; string parameters
are `&str` and flags are `bool`. Flags are explicit, with no default arguments.

| Method | JSON result |
| --- | --- |
| `list_content(rel)` | Array of file entries. |
| `new_directory(rel)` | null on success. |
| `remove(rel, recursive)` | null on success. |
| `stat(rel)` | File entry object. |
| `write_text(rel, contents, create_dirs, append)` | null on success. |
| `read_text(rel)` | Text string. |
| `write_bytes(rel, data_base64, create_dirs)` | null on success. |
| `read_bytes(rel)` | Base64 string. |
| `exists(rel)` | Boolean. |
| `move_file(src, dest, create_dirs, overwrite)` | null on success. |
| `copy(src, dest, recursive, create_dirs, overwrite)` | null on success. |
| `path()` | Absolute scope root string. |
| `clear()` | Clears the data/cache scope; use `clear_storage()` for Plugin storage. |

Use `""` for the root directory. `move_file` corresponds to `move` in the other
languages because `move` is a Rust keyword.

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

Use `liatir::invoke(command, payload)` with `permanent: true` for data, or
`false` for cache. For Plugin storage, also set
`pluginStoragePlugin: "my-plugin.wasm"`. All paths are relative to that scope.

| Command | Payload fields, in addition to the scope |
| --- | --- |
| `lia_fs_list_dir` / `lia_fs_stat` / `lia_fs_exists` | `rel` (`""` means the scope root). |
| `lia_fs_mkdir` / `lia_fs_rm` | `rel`; removal also takes `recursive`. |
| `lia_fs_read_text` / `lia_fs_read_bytes` | `rel`; bytes return a base64 string. |
| `lia_fs_write_text` | `rel`, `contents`, `createDirs`, `append`. |
| `lia_fs_write_bytes` | `rel`, `dataBase64`, `createDirs`. |
| `lia_fs_move` | `src`, `dest`, `createDirs`, `overwrite`. |
| `lia_fs_copy` | `src`, `dest`, `recursive`, `createDirs`, `overwrite`. |

```cpp
auto entry = liatir::invoke("lia_fs_stat",
    {{"permanent", true}, {"pluginStoragePlugin", "my-plugin.wasm"}, {"rel", ""}});
auto root = entry.at("path").get<std::string>();
```

</Tab>
</Tabs>
</Tab>
</Tabs>

### FsEntry

| Field          | Type    | Description                                  |
|----------------|---------|----------------------------------------------|
| `name`         | string  | The name of the file or directory.           |
| `path`         | string  | The full path to the entry within the scope. |
| `is_dir` | boolean | Whether the entry is a directory. |
| `size` | number or null | File size in bytes; null for directories. |

::: warning IMPORTANT
`FsEntry` uses `name`, `path`, `is_dir` and `size` in every language.
The SDK preserves the backend JSON response without renaming fields.
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
<Tab title="R">

`storage$clear_storage()` clears the selected Plugin storage.

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

`storage.clear_storage()?` clears the selected Plugin storage.

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
liatir::invoke("lia_plugin_storage_clear", {{"plugin", "my-plugin.wasm"}});
```

</Tab>
</Tabs>
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
<Tab title="R">

```r
storage <- ctx$liatir$desktop$fs$plugin_fs("my-plugin")
storage$write_text("notes/todo.txt", "Review the documentation")
content <- storage$read_text("notes/todo.txt")
cat(content, "\n")
report_path <- storage$stat("notes/todo.txt")$path
# A declared file output can return list(report = list(path = report_path)).
```

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
let storage = ctx.liatir.desktop().fs().plugin_fs("my-plugin")?;
storage.write_text("notes/todo.txt", "Review the documentation", true, false)?;
let content = storage.read_text("notes/todo.txt")?;
println!("{}", content.as_str().ok_or("Invalid text response")?);
let entry = storage.stat("notes/todo.txt")?;
let report_path = entry["path"].as_str().ok_or("Missing report path")?;
// A declared file output can return Ok(json!({ "report": { "path": report_path } })).
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
json scope = {{"permanent", true}, {"pluginStoragePlugin", "my-plugin.wasm"}};
auto write = scope;
write.update({{"rel", "notes/todo.txt"}, {"contents", "Review the documentation"},
              {"createDirs", true}, {"append", false}});
liatir::invoke("lia_fs_write_text", write);
auto read = scope;
read["rel"] = "notes/todo.txt";
auto content = liatir::invoke("lia_fs_read_text", read).get<std::string>();
std::cout << content << "\n";
auto report_path = liatir::invoke("lia_fs_stat", read).at("path").get<std::string>();
// A declared file output can return json{{"report", {{"path", report_path}}}}.
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Notes

:::tip
The `cache` namespace is intended for temporary files that will be cleared, while `data` and `pluginFs` / `plugin_fs` namespaces are meant for persistent files that should be preserved across sessions.
:::

Paths passed to this API stay within their managed scope. Node, Python, R and
Native programs can separately use their language's filesystem APIs; this
bridge is not an operating-system sandbox.

R and Native remove their temporary Job directory at termination. If returning
a file path, write it to managed storage first and return that absolute path,
or return [inline content](/plugins/field#file-output-values). Use unique paths
per run to avoid overwriting another concurrent run's output.
