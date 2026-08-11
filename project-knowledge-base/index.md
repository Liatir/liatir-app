# Liatir Maintainer Guide

This is the private maintainer documentation for developing Liatir itself.
It is not the public product documentation and should not be linked from the
user-facing site.

## Purpose

Use this site to keep durable decisions close to the codebase:

- architecture rules that affect multiple surfaces;
- testing and release checks;
- a beginner-friendly explanation of the
  [Runtime Box system](./architecture/runtime-box-system-explained.md);
- the canonical [current project status](./current-project-status.md) and
  continuation order;
- the canonical [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md);
- the evidence-backed [Runtime Box production report](./roadmap/runtime-box-production-report.md);
- the completed [Runtime Box pixi migration record](./roadmap/runtime-box-pixi-migration.md);
- the completed independent
  [Scrollcase extraction record](./roadmap/scrollcase-extraction-plan.md) and the
  completed downstream [Liatir adoption record](./roadmap/scrollcase-p5-liatir-adoption.md);
- AI Models and AI Tools roadmap status;
- Quenta and MCP trust boundaries;
- native bridge and runtime constraints;
- notes that help future maintainers avoid repeating old mistakes.

## Public vs internal docs

The public documentation in `docs/` explains how to use Liatir. It must be
clear for no-code users first, then provide deeper technical notes where useful.

This internal documentation explains how Liatir is built and maintained. It can
refer to implementation details, test scripts, state ownership, and known
engineering constraints.

## Documentation workflow

- Run `npm run docs:dev` for the public documentation.
- Run `npm run docs:internal:dev` for this private site.
- Run `npm run docs:all:build` before larger documentation handoffs.

Both sites use VitePress local search.

## Runtime Box ownership boundary

Scrollcase is an independent Apache-2.0 tool distributed through npm. It owns
the generic box contract, pixi/conda-pack build pipeline, signing envelope and
verification implementation. This repository consumes an exact published
version; it does not contain or develop Scrollcase source.

Liatir owns Runtime Box recipes, model-specific scientific validation,
runner/cost policy, evidence, its private signer adapter and key custody,
Registry/R2 distribution, trust roots, the Rust/Tauri installer, and product
Jobs/Results/provenance. Scrollcase is a build-time tool and never a runtime
dependency of the installed desktop application.
