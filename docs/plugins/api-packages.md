# Liatir API packages

The SDK is the small library that declares a Plugin's inputs and outputs and
connects its code to Liatir. All five runtimes use the same I/O contract.

| Runtime | Authoring SDK | How it is supplied |
| --- | --- | --- |
| Node | `definePlugin`, `field`, `output` from `@liatir/api` | npm dependency installed by `liatir init`. |
| Python | `define_plugin`, `field` from `liatir` | CLI-managed `src/liatir.py`. |
| R | `define_plugin`, `field` after `source("liatir.R")` | CLI-managed `src/liatir.R`. |
| Native | Rust or C++ builders for the shared contract and app bridge. | CLI-managed `src/liatir.rs` / `src/liatir_bridge.rs`, or `src/liatir.hpp` / `src/liatir_bridge.hpp`. |
| WASM | Rust or C++ builders for the shared contract, without the app bridge. | CLI-managed `src/liatir.rs` or `src/liatir.hpp`. |

`liatir init` supplies the Python, R, Rust and C++ libraries and `liatir build`
refreshes them from your installed CLI. Keep your logic in the entry point or
separate modules; managed files are overwritten during updates. No separate
Liatir pip, R or Cargo package is needed. These Plugins do not use the Node
`@liatir/api` dependency.

The supported authoring languages are JavaScript/TypeScript, Python, R, Rust and
C++, with the Liatir library supplied for each. Native and WASM offer Rust and
C++; the low-level execution protocol is not a promise of support for other
languages.

```sh
liatir init my-plugin --native --cpp --yes
liatir init my-plugin --wasm --cpp --yes
```

C++ scaffolding needs a CLI build containing the managed C++ SDK; older CLI
releases may not recognize `--cpp`. C++ builds need CMake >= 3.21. Native additionally needs a C++17 compiler and
libcurl development headers/libraries; WASM needs WASI SDK, selected through
`WASI_SDK_PATH`. CMake uses installed nlohmann/json 3.12 or fetches its pinned
release on the first build. Prepared author dependencies can be reused offline.
These tools are author prerequisites; users of a packaged Plugin do not need a
compiler.

`liatir update` updates a Node project's CLI/API packages. For the other
languages, update your installed CLI and run `liatir build` to refresh the
managed library. See [complete entry points](./define-plugin#native-wasm).

## Related

- [Getting started](/plugins/getting-started)
- [Plugin context](/plugins/plugin-context)
- [Plugin authoring](/plugins/define-plugin)
- [Declaring fields](/plugins/field)
- [Runtime packaging](/plugins/format)
- [API bridge](/plugins/api-bridge)
