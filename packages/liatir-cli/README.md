# Liatir CLI

[Liatir website](https://liatir.com) ·
[Plugin documentation](https://liatir.com/plugins/getting-started)

`@liatir/cli` creates, develops and packages `.lia` Plugins for **Node, Python,
R, Native and WASM**. Every runtime uses the same code-declared input/output
contract and connects to Liatir pipelines, Jobs and Results.

## Create a Plugin

Install Node.js and npm to run the CLI, then:

```sh
npm install -g @liatir/cli
liatir init my-plugin --yes
cd my-plugin
```

The default is Node TypeScript, with npm dependencies installed automatically.
Run `liatir init` for guided setup, or select a runtime explicitly:

```sh
liatir init my-plugin --node --ts
liatir init my-plugin --node --js
liatir init my-plugin --python
liatir init my-plugin --r
liatir init my-plugin --native       # Rust executable
liatir init my-plugin --native --cpp # C++ executable
liatir init my-plugin --wasm         # Rust/WASM
liatir init my-plugin --wasm --cpp   # C++/WASM
liatir init my-plugin --runtime r    # equivalent runtime selector
```

Other flags include `--template <name>`, `--category <name>`, `--tags "FASTQ,QC"`,
`--no-install` (Node npm dependencies) and `--no-wasm-target` (WASM target setup).
Node metadata lives in `package.json`; other runtimes use `.lia-manifest.json`.

## Develop, build and import

With the desktop app running, use `liatir dev`. Its temporary Dev Runner rebuilds
on save and runs the current Plugin without importing it permanently. All five
runtimes use this workflow. Run `liatir build` to create the `.lia` file, then
import it from **Plugins** in Liatir and complete any required preparation.

| Runtime | Requirements and SDK |
| --- | --- |
| Node | Node.js/npm; `@liatir/api` supplies `definePlugin` and field builders. |
| Python | A compatible Python for local contract extraction; the app prepares its managed runtime. CLI supplies `src/liatir.py`. |
| R | R >= 4.1, found through `Rscript` on PATH or `LIATIR_RSCRIPT`. CLI supplies `src/liatir.R`. |
| Native | Rust/Cargo, or CMake with a C++17 compiler and libcurl development files. CLI supplies the Rust modules or C++ `src/liatir.hpp` / `src/liatir_bridge.hpp`. |
| WASM | Rust/Cargo with `wasm32-wasip1`, or CMake with WASI SDK (`WASI_SDK_PATH`) for C++. CLI supplies the selected library without the bridge. |

`liatir build` refreshes the managed SDK files; keep your own code elsewhere.
The supplied authoring libraries cover Node (JavaScript/TypeScript), Python,
R, Rust and C++. C++ headers are created by `liatir init` and refreshed by
`liatir build`, including contract extraction and input/output validation. CMake
uses installed nlohmann/json 3.12 or fetches its pinned release on first build.
`LIATIR_CMAKE` overrides the CMake executable when needed.
R and Native require an app and CLI build containing their runtime support.
Node, Python, R and Native have full Plugin bridge access. WASM has no bridge
and runs in an isolated environment.

For R, the first build writes `renv.lock`; commit it with the project. Subsequent
builds restore it. Users install compatible R and choose **Prepare R packages**
in Liatir; preparation may need network access and build tools. Prepared runs
work offline.

Native builds package exact OS/processor targets and read the contract from the
executable. Both Rust and C++ starters build the host target. Users grant **Allow
executable access** for the exact imported bundle; an update needs permission
again. The supplied Rust and C++ libraries enforce the shared version 1 contract.
Cross-target builds use generated, hash-bound `<executable>.contract.json`
metadata. See [Plugin bundle format](https://liatir.com/plugins/format)
for distribution and protocol details.

## Commands

| Command | Purpose |
| --- | --- |
| `liatir init` | Create a Plugin project. |
| `liatir dev` | Open the app-backed temporary Dev Runner. |
| `liatir build` | Generate the manifest from code and package the `.lia` file. |
| `liatir update` | Update a Node project's `@liatir/cli` and `@liatir/api` together. |
| `liatir -v` / `liatir version` | Show CLI and installed project API versions. |

Declare inputs and outputs once using the language SDK; do not maintain a
parallel manifest schema. Standard file outputs are saved to Results and can
feed another runtime in the same pipeline. For R and Native, return inline
content or persistent bridge-managed paths: their temporary Job directory is
removed at termination.
