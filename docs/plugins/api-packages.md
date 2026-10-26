# Liatir API packages

The SDK is the small library that declares a Plugin's inputs and outputs and
connects its code to Liatir. All five runtimes use the same I/O contract.

| Runtime | Authoring SDK | How it is supplied |
| --- | --- | --- |
| Node | `definePlugin`, `field`, `output` from `@liatir/api` | npm dependency installed by `liatir init`. |
| Python | `define_plugin`, `field` from `liatir` | CLI-managed `src/liatir.py`. |
| R | `define_plugin`, `field` after `source("liatir.R")` | CLI-managed `src/liatir.R`. |
| Native (Rust) | `define_plugin`, `field` from `mod liatir` | CLI-managed `src/liatir.rs` and `src/liatir_bridge.rs`. |
| WASM (Rust) | `define_plugin`, `field` from `mod liatir` | CLI-managed `src/liatir.rs`, without the app bridge. |

For Python, R, Native Rust and WASM, `liatir build` refreshes the managed files
from your installed CLI. Keep your own logic in the entry point or separate
modules: edits to managed SDK files are overwritten. These runtimes do not need
the Node `@liatir/api` package. R still needs a compatible R installation and its
prepared packages; Rust projects need Rust and Cargo to build.

`liatir update` updates the CLI/API dependencies of a **Node project**. To update
the other managed SDKs, update your installed CLI and rebuild the Plugin.

Native executables written in other languages can implement the
[executable protocol](/plugins/format#executable-protocol-version-1)
directly, including contract emission, validation and authenticated bridge calls.

## Related

- [Getting started](/plugins/getting-started)
- [Plugin context](/plugins/plugin-context)
- [Plugin authoring](/plugins/define-plugin)
- [Declaring fields](/plugins/field)
- [Runtime packaging](/plugins/format)
- [API bridge](/plugins/api-bridge)
