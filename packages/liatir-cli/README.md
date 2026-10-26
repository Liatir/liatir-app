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
liatir init my-plugin --wasm         # Rust/WASM
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
| Native | Rust/Cargo for the starter or another compiler implementing the executable protocol. CLI supplies `src/liatir.rs` and `src/liatir_bridge.rs` for Rust. |
| WASM | Rust/Cargo with `wasm32-wasip1`. CLI supplies `src/liatir.rs`, without the bridge. |

`liatir build` refreshes the managed SDK files; keep your own code elsewhere.
R and Native require an app and CLI build containing their runtime support.
Node, Python, R and Native have full Plugin bridge access. WASM has no bridge
and runs in an isolated environment.

For R, the first build writes `renv.lock`; commit it with the project. Subsequent
builds restore it. Users install compatible R and choose **Prepare R packages**
in Liatir; preparation may need network access and build tools. Prepared runs
work offline.

Native builds package exact OS/processor targets and read the contract from the
executable. The Rust starter builds the host target. Users grant **Allow
executable access** for the exact imported bundle; an update needs permission
again. Other languages can implement the same version 1 executable protocol.
Cross-target builds use generated, hash-bound `<executable>.contract.json`
metadata. See [R and Native documentation](https://liatir.com/plugins/r-and-native)
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
