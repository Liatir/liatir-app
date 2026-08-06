# Liatir CLI

[Liatir website ↗](https://liatir.com)

In order to start developing a **Liatir plugin**, you have to install the **Liatir CLI** from `@liatir/cli`, the Liatir command-line package for scaffolding, developing, and building `.lia` plugins.

Liatir commands exposed by the CLI:
- `liatir init`: this will generate your project folder and scaffolding.
- `liatir update`: you can use this to update @liatir/cli.
- `liatir dev`: opens a temporary Liatir Dev Runner session for testing the plugin inside Liatir.
- `liatir build`: with this command the cli will build your plugin and generate the relative `.lia` file.
- `liatir -v` (or `liatir version`): prints the CLI version, plus the `@liatir/api` version when it is installed in the current project.

## Quick initialization

1. First run:

```bash
npm install -g @liatir/cli

liatir init my-liatir-plugin --yes   # recommended defaults

cd my-liatir-plugin

npm install
```

2. Once done, start developing your Liatir plugin.


## Guided initialization (recommended)

```bash
npm install -g @liatir/cli

liatir init
```

### The CLI will then walk you through the project setup:

1. **Project folder** — the directory to create (e.g. `my-liatir-plugin`).

2. **Runtime** — how the plugin runs:
   - **Node** — JavaScript/TypeScript with the full Liatir desktop bridge.
   - **Python** — Python code with dependencies resolved by Liatir when the packaged plugin runs.
   - **WASM** — Rust compiled to WASM, for sandboxed local computation.

3. **Node language** *(Node runtime only)*:
   - **TypeScript** *(recommended)* — best type safety and contract validation while developing.
   - **JavaScript** — plain ESM plugin, no TypeScript project.

4. **Starter template**:
   - **Minimal text plugin** *(recommended)* — the smallest example for learning the plugin contract.
   - **File processor** — reads metadata from a user-selected local file.
   - **Bio CLI wrapper** — wraps a local bioinformatics command.

5. **Metadata** — display name, description, and category. All optional; you can change them later in the manifest.

6. **Install dependencies** — answer **Yes** to run `npm install` right away.

7. Open the project folder with `cd my-liatir-plugin`.

8. Start developing your Liatir plugin.

## Initialization flags

```bash
liatir init                            # full guided initialization
liatir init plugin-name --yes          # uses recommended defaults
liatir init plugin-name --node --ts    # Node TypeScript plugin
liatir init plugin-name --node --js    # Node JavaScript plugin
liatir init plugin-name --wasm         # Rust/WASM plugin
liatir init plugin-name --template <TEMPLATE_NAME>
liatir init plugin-name --category "Quality Control" --tags "FASTQ,QC"
liatir init plugin-name --no-install
liatir init plugin-name --no-wasm-target
```

## Test, build and import

1. While developing, use `liatir dev` to test your plugin as you work. It opens a temporary Dev Runner window in Liatir, rebuilds on save, and lets you run the current bundle without importing it into your real plugin library.

2. When you're happy with it, run `liatir build` to package your plugin into a `.lia` bundle.

3. Open the **Plugins** page in Liatir and import the generated `.lia` file.

4. Now you are ready to run it by itself or integrate it into a pipeline.

## Pipeline integration

The fields declared in `inputs` and `outputs` become the plugin's pipeline
contract. Liatir uses them to render forms, validate required inputs, expose
outputs to later steps, and store file outputs in Results.
