---
layout: home

hero:
  name: Liatir
  text: Bioinformatics. On your machine. Under your control.
  tagline: A desktop app that runs real bioinformatics tools and pipelines locally, and much more — no cloud, no servers, no subscriptions. Built on Rust and Tauri for native speed when handling multi-gigabyte genomic files.
  actions:
    - theme: brand
      text: Get Started
      link: /introduction/overview
    - theme: alt
      text: How It Works
      link: /introduction/architecture

features:
  - icon: 🦀
    title: Rust backend, native performance
    details: Every file operation, process spawn, and data parse runs in Rust via Tauri. Opening a 40 GB BAM, streaming gzipped FASTQ, or parsing a dense VCF — Liatir handles it without blocking the UI or running out of memory.
  - icon: 🔒
    title: 100% local and offline
    details: Your genomic data never leaves your machine. There are no API calls to external servers, no telemetry, no licence checks. Liatir works on an air-gapped workstation just as well as a connected laptop.
  - icon: 📦
    title: .lia plugins — extend anything
    details: A .lia file is a self-contained JavaScript bundle (built with liatir-cli) that plugs in as a first-class analysis step. Share a plugin as a single file; load it with a drag-and-drop. No install, no conflicts, no root access.
  - icon: 🔌
    title: WASM plugin system
    details: For performance-critical or language-agnostic logic, Liatir supports WebAssembly plugins. Compile from Rust, C, or any WASM target and register the plugin — the same input/output schema used by every other step applies.
  - icon: 🧠
    title: Local AI Models and AI Tools
    details: Install model runtimes only when needed, then use them directly or inside pipelines for single-cell annotation, sequence embeddings, structure prediction, and genomic scoring.
  - icon: 🗂️
    title: Unified data layer
    details: Import files once, use them everywhere. Liatir tracks every file you add by path, shows extension-aware icons, detects when a file moves or disappears, and provides an inline text preview for FASTQ, VCF, SAM, BED, and GTF formats.
  - icon: 🔗
    title: Orchestrate any pipeline
    details: The .lia plugin system can shell out to Nextflow, Snakemake, or any CLI tool. A .lia plugin that wraps a Nextflow workflow appears in the pipeline builder exactly like a native tool — same schema, same run history, same output tracking.
---
