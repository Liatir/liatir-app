---
title: Invoke
description: Low-level command invocation for advanced API usage.
---

# `.invoke`

`Liatir.invoke()` calls a low-level bridge command directly.

Use it only when:

- the API has no typed wrapper for what you need;
- you know the command name and payload contract;
- you can handle app-version changes.

Prefer typed namespaces for public plugin code.

## Signature

<Tabs>
<Tab title="Node">

```ts
invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>
```

</Tab>
<Tab title="Python">

```python
invoke(cmd, payload=None) -> any
```

</Tab>
<Tab title="R">

```r
invoke(cmd, payload = list())
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
invoke(cmd: &str, payload: Value) -> Result<Value>
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto result = liatir::invoke("lia_deps_check", {{"binary", "samtools"}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const result = await Liatir.invoke('lia_deps_check', {
  binary: 'samtools'
});

console.log('Result:', result);
```

</Tab>
<Tab title="Python">

```python
result = ctx.liatir.invoke('lia_deps_check', {
    'binary': 'samtools'
})

print('Result:', result)
```

</Tab>
<Tab title="R">

```r
result <- ctx$liatir$invoke("lia_deps_check", list(binary = "samtools"))
print(result$available)
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
let result = ctx.liatir.invoke("lia_deps_check", json!({ "binary": "samtools" }))?;
println!("Available: {}", result["available"]);
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto result = liatir::invoke("lia_deps_check", {{"binary", "samtools"}});
std::cout << "Available: " << result.at("available") << "\n";
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Notes

Typed namespaces are more stable and easier to understand and should be preferred. Treat `invoke()` as
an **escape hatch for advanced integrations**.

Only commands exposed by the Plugin IPC server are callable; this is not access
to every internal desktop command. For example, the dependency payload uses
`binary` (one tool) or `binaries` (several), regardless of the caller's language.
The SDK handles connection authentication and development-session identity.
Native permission and runtime preparation remain desktop-only actions.

Use the [bridge language conventions](/plugins/api-bridge#language-conventions)
for error handling and Native Rust imports. WASM has no `invoke` method.
