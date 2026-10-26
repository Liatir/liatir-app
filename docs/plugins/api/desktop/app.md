---
title: App API
description: Interface for retrieving system information from Node, Python, R and Native Plugins.
---


# `.desktop.app`

The `app` API area of the Liatir API provides methods to retrieve system-level information. Use this API area when you need to access details about the app environment and OS.

## Methods

<Tabs>
<Tab title="Node">

| Method   | Description                                                        | Return Type       |
|----------|--------------------------------------------------------------------|-------------------|
| `info()` | Retrieves detailed information about the Liatir app instance, including version, platform, and environment. | `Promise<AppInfo>` |

</Tab>
<Tab title="Python">

| Method   | Description                                                        | Return Type |
|----------|--------------------------------------------------------------------|-------------|
| `info()` | Retrieves detailed information about the Liatir app instance, including version, platform, and environment. | `dict`      |

</Tab>
<Tab title="R">

| Method | Returns |
| --- | --- |
| `ctx$liatir$desktop$app$info()` | Named list of app information. |

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

| Method | Returns |
| --- | --- |
| `ctx.liatir.desktop().app().info()` | `Result<Value>` with app information. |

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto info = liatir::invoke("lia_app_info");
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## AppInfo structure

The `AppInfo` object returned by `info()` contains the following fields:

| Field             | Type               | Description                                                                                      |
|-------------------|--------------------|------------------------------------------------------------------------------------------------|
| `arch`            | string             | The system architecture (e.g., `x86_64`, `aarch64`).                                                |
| `current_dir`     | string             | The current working directory of the app process.                                              |
| `exec_dir`        | string             | The directory where the app executable is located.                                             |
| `exec_path`       | string             | The full path to the app executable file.                                                      |
| `has_main_window` | boolean            | Indicates whether the app currently has a main window open.                                    |
| `is_debug`        | boolean            | Indicates if the app is running in debug mode.                                                 |
| `name`            | string             | The display name of the application.                                                           |
| `now_unix_ms`     | number             | The current timestamp in milliseconds since Unix epoch.                                        |
| `os`              | string             | The operating system platform (e.g., `windows`, `macos`, `linux`).                                       |
| `pid`             | number             | The process ID of the running app instance.                                                    |
| `primary_screen`  | `AppScreenInfo`    | Information about the primary display screen.                                                  |
| `screens`         | `AppScreenInfo[]`  | Array of information objects for all connected display screens.                                |
| `temp_dir`        | string             | The path to the temporary directory used by the app.                                          |
| `version`         | string             | The version of the Liatir app.                                                            |
| `windows`         | `AppWindowInfo[]`  | Array of information objects for all open app windows.                                        |

::: warning IMPORTANT
`AppInfo` fields are always snake_case in Node, Python, R and Native, because they
come from the JSON response of the Liatir bridge.
:::

### Related Types

#### AppWindowInfo

| Field           | Type    | Description                          |
|-----------------|---------|------------------------------------|
| `label`         | string  | The window's label or identifier.  |
| `width`         | number  | The window's width in pixels.      |
| `height`        | number  | The window's height in pixels.     |
| `x`             | number  | The x-coordinate of the window.    |
| `y`             | number  | The y-coordinate of the window.    |
| `is_fullscreen` | boolean | Whether the window is fullscreen. |
| `is_maximized`  | boolean | Whether the window is maximized.   |
| `is_minimized`  | boolean | Whether the window is minimized.   |
| `is_visible`    | boolean | Whether the window is visible.      |

#### AppScreenInfo

| Field          | Type    | Description                          |
|----------------|---------|------------------------------------|
| `name`         | string  | The screen's name or identifier.   |
| `width`        | number  | The screen's width in pixels.      |
| `height`       | number  | The screen's height in pixels.     |
| `x`            | number  | The x-coordinate of the screen.    |
| `y`            | number  | The y-coordinate of the screen.    |
| `scale_factor` | number  | The screen's scale factor.          |


## Example Usage

<Tabs>
<Tab title="Node">

```ts
// Retrieve app information
const info = await Liatir.desktop.app.info();
console.log('Platform:', info.os);
```

</Tab>
<Tab title="Python">

```python
# Retrieve app information
info = ctx.liatir.desktop.app.info()
print('Platform:', info['os'])
```

</Tab>
<Tab title="R">

```r
info <- ctx$liatir$desktop$app$info()
cat("Platform:", info$os, "\n")
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
let info = ctx.liatir.desktop().app().info()?;
println!("Platform: {}", info["os"]);
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto info = liatir::invoke("lia_app_info");
std::cout << "Platform: " << info.at("os") << "\n";
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Notes

:::tip Efficient usage of `info()`
Cache the result of `info()` if you need app details multiple times, if you only need its platform/version. Window state, display details and the
timestamp can change, so request fresh information when those values matter.
:::
