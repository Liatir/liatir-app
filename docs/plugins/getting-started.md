# Getting started

The Liatir CLI is the command-line tool that creates Plugin projects and builds
their `.lia` files. Install Node.js and npm to use it, even when the Plugin itself
uses another language.

```sh
npm install -g @liatir/cli
liatir init my-liatir-plugin --yes
cd my-liatir-plugin
```

This creates a Node TypeScript Plugin and installs its npm dependencies. Node is
the recommended starting point unless your analysis needs another language.
R and Native require an app and CLI build containing their runtime support;
an older installation may not offer these choices.

## Choose a runtime

A runtime is the environment that executes your Plugin's code.

| Runtime | Use it for | Author prerequisites | App bridge |
| --- | --- | --- | --- |
| Node | TypeScript/JavaScript and npm libraries. | Node.js and npm. | Yes |
| Python | Scientific Python and Python packages. | A compatible Python for local contract extraction; the app prepares a managed environment for packaged runs. | Yes |
| R | R statistics, CRAN and Bioconductor packages. | R >= 4.1; `Rscript` on PATH or `LIATIR_RSCRIPT`. | Yes |
| Native | Compiled programs, with a Rust starter. | Rust/Cargo for the starter, or your language's compiler. | Yes |
| WASM | Portable computation in an isolated environment. | Rust/Cargo and the `wasm32-wasip1` target. | No |

The bridge lets a Plugin use Liatir Jobs, storage, logs and progress. Node,
Python, R and Native also have ordinary operating-system access. WASM has no
bridge or arbitrary host filesystem/network access.

Run `liatir init` without arguments for guided setup. It asks for the project
folder, runtime and metadata. Node additionally offers TypeScript or JavaScript
and npm installation; WASM offers to install its Rust compilation target.
Node metadata lives in `package.json`; the other runtimes use
`.lia-manifest.json`.

## Initialization flags

```sh
liatir init                            # guided initialization
liatir init plugin-name --yes          # Node TypeScript defaults
liatir init plugin-name --node --ts
liatir init plugin-name --node --js
liatir init plugin-name --python
liatir init plugin-name --r
liatir init plugin-name --native        # Rust executable
liatir init plugin-name --wasm          # Rust/WASM
liatir init plugin-name --runtime r     # equivalent runtime selector
liatir init plugin-name --template <TEMPLATE_NAME>
liatir init plugin-name --category "Quality Control" --tags "FASTQ,QC"
liatir init plugin-name --no-install    # skip Node npm installation
liatir init plugin-name --no-wasm-target
```

## Declare inputs and outputs

Declare the fields once in code. They define the form users see and the ports
that connect the Plugin to a pipeline. `liatir build` reads these declarations
and generates the bundle's manifest; do not maintain a separate schema.

| Runtime | Entry point | Contract declaration |
| --- | --- | --- |
| Node | `src/index.ts` or `src/index.js` | `definePlugin({ inputs, outputs }).main(handler)` |
| Python | `src/main.py` | `define_plugin(...)` and `@plugin.main` |
| R | `src/main.R` | `define_plugin(...)` and `plugin$main(handler)` |
| Native / WASM Rust | `src/main.rs` | `define_plugin().input(...).output(...).main(handler)` |

The CLI supplies and refreshes the non-Node SDK files. See
[API packages](/plugins/api-packages), [complete entry points](/plugins/define-plugin)
and [field declarations](/plugins/field).

## Test, build and import

1. Open Liatir and run `liatir dev` from your project. Its temporary Dev Runner
   rebuilds on save and tests the current bundle without adding it to your
   permanent Plugin library. All five runtimes use this workflow.
2. Run `liatir build` to produce the distributable `.lia` file.
3. Import it on the **Plugins** page in Liatir.
4. Complete any runtime preparation shown on the Plugin's page, then run it
   alone or add it to a pipeline.

## Runtime preparation

The Plugin's page shows any preparation needed before running it:

| Runtime | Preparation |
| --- | --- |
| Node | Uses Liatir's Node runtime. npm dependencies are bundled by the CLI. |
| Python | Prepare the Plugin's managed Python environment and declared packages. |
| R | Install compatible R and choose **Prepare R packages** to restore the bundled dependency lock. |
| Native | Import an executable for the exact OS/processor and choose **Allow executable access** after reviewing it. |
| WASM | Uses the built-in isolated runner; no separate interpreter or executable permission is needed. |

Package preparation may require internet access and compilation tools; prepared
runs work offline. R's first build creates `renv.lock`, which must be committed
with the project. Native permission applies to the exact imported bundle and
must be granted again after a change. The Native Rust starter builds the author's
host target by default; include and test additional targets before distribution.
See the [bundle format](./format) for dependency locks and executable packaging.

## Pipeline integration

Every runtime uses the same file, text, number and boolean inputs and standard
outputs. File outputs appear in Results and can feed later steps, including
steps using a different runtime. Runs appear in Jobs with logs, cancellation and
their pipeline association.

R and Native run in temporary directories removed when their Job ends. Return
file content inline, or a path in bridge-managed storage outside that directory;
see [file output values](/plugins/field#file-output-values).

## CLI commands

| Command | Purpose |
| --- | --- |
| `liatir init` | Create a project for any of the five runtimes. |
| `liatir dev` | Test in the running app's temporary Dev Runner. |
| `liatir build` | Extract the code contract and package a `.lia` file. |
| `liatir update` | Update CLI/API dependencies in a Node project. |
| `liatir -v` / `liatir version` | Show the CLI version and installed project API version, if present. |

## Related

- [Plugin context](/plugins/plugin-context)
- [API bridge](/plugins/api-bridge)
- [.lia bundle format](/plugins/format)
- [Runtime packaging](/plugins/format)
