# Liatir Maintainer Guide

This is the private maintainer documentation for developing Liatir itself.
It is not the public product documentation and should not be linked from the
user-facing site.

## Purpose

Use this site to keep durable decisions close to the codebase:

- architecture rules that affect multiple surfaces;
- testing and release checks;
- the canonical [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md);
- the evidence-backed [Runtime Box production report](./roadmap/runtime-box-production-report.md);
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
