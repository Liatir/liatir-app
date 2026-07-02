# What is Liatir

Liatir is a local-first bioinformatics desktop application. It runs native command-line tools (FastQC, Samtools, BCFtools, fastp, ...), custom JavaScript plugins (`.lia` files), WebAssembly tools, and local AI Models used by AI Tools - all from a single UI, entirely on your own machine.

## Why local-first matters

Most modern bioinformatics platforms are cloud-based: you upload files to a remote server, pay per compute hour, and trust a third party with patient or proprietary data. Liatir takes the opposite approach.

- **Your data never leaves your machine.** No uploads. No API calls. No telemetry. Files are referenced by path — Liatir reads them directly.
- **Works offline.** Air-gapped HPC nodes, restricted institutional networks, no WiFi on a train — Liatir runs without any connectivity.
- **No subscriptions or rate limits.** Process as many samples as your local hardware allows.
- **Reproducible by default.** Every run stores its inputs, tool version, and parsed results locally. No external job IDs to chase, no logs that expire.

## The Rust advantage

Liatir is built on [Tauri 2](https://v2.tauri.app/) — a framework that pairs a Rust backend with a web-technology frontend. This matters for bioinformatics because genomic files are large.

- Streaming a gzip-compressed FASTQ, reading the first N lines of a 50 GB BAM, or processing a dense multi-sample VCF — these are synchronous file I/O operations in the Rust backend. They never block the JavaScript UI thread.
- Spawning `samtools`, `bcftools`, or `fastp` as a child process and capturing streamed stdout is handled natively without shelling out through a Node.js proxy.
- Binary formats (BAM, BCF, CRAM) are safely identified and flagged before any attempt is made to read them as text.

## Extensibility: three layers

Liatir offers four ways to add new analysis capability:

### 1 — Native tools
Any binary installed in your system PATH can be wrapped as a native tool. Liatir checks availability, surfaces install instructions when the binary is missing, and runs the command with the parameters you choose. Run history and parsed results are stored automatically.

### 2 — .lia plugins
A `.lia` file is a self-contained extension bundle. Node plugins declare their
inputs and outputs in code with `definePlugin({ inputs, outputs })`, and
`lia build` generates the bundle manifest from that contract. WASM plugins use a
manifest file and a sandboxed `plugin.wasm` payload.

### 3 — WASM tools
For performance-critical or cross-language logic, Liatir supports WebAssembly plugins. Compile from Rust, C, or any WASM-compatible language and expose it as a normal tool in the UI and in pipelines.

### 4 — AI Models and AI Tools
AI Models are locally installed model runtimes managed by Liatir. AI Tools are the pipeline capabilities that use those models for tasks such as single-cell annotation, sequence embedding, protein structure prediction, and genomic variant scoring.

## Core concepts

| Concept | Description |
|---------|-------------|
| **Data library** | A registry of file paths on disk. Files are never copied — Liatir tracks references and detects when files move or disappear. |
| **Native tool** | A system binary wrapped with a Liatir UI, dependency check, and run history. |
| **.lia plugin** | A self-contained extension bundle that adds custom steps through the shared input/output contract. |
| **WASM tool** | A WebAssembly-backed tool for performance-critical logic. FastQC is the primary example. |
| **AI Model** | A locally managed model runtime installed only when needed. |
| **AI Tool** | A pipeline-ready capability that runs a compatible local AI Model through the shared I/O contract. |
| **Pipeline** | A directed graph of steps whose typed outputs connect to typed inputs of subsequent steps. |
| **Analysis run** | A single execution: recorded inputs, stdout, parsed sections, and any output files. |

## Getting started

1. [Add files to your Data library](/data/overview) — import by path, no copying.
2. [Run a native tool](/tools/overview) — start with FastQC or fastp on FASTQ files.
3. [Read the AI guide](/ai/guide) — learn what AI Models and AI Tools do before interpreting results.
4. [Install an AI Model](/ai/models/overview) — try local annotation, embedding, or structure workflows.
5. [Build or import a .lia plugin](/plugins/overview) — for custom logic or pipeline orchestration.
6. [Connect steps in a pipeline](/pipeline/overview) — automatic type-matched data flow.
