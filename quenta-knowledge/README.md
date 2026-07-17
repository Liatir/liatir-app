# Quenta curated knowledge

Curated bioinformatics knowledge that Quenta (the in-app assistant) retrieves over. This is the
**single source of truth** for this knowledge: it is authored here as Markdown, then compiled into a
retrieval seed by `scripts/build-quenta-docs.mjs` and bundled into the app.

Do **not** hand-write these documents into TypeScript — edit the Markdown here and let the generator
produce the seed. This corpus is intentionally separate from `docs/` (the user-facing docs site): it
is Quenta's domain knowledge, not product documentation.

## Layout

Each `.md` file is one topic; `##` sections within it are subtopics, and each becomes its own
retrievable unit. Frontmatter declares the document identity:

```md
---
id: bio:example
sourceKind: bioinformatics
title: Human-readable title
locator: Bioinformatics / Where this lives
---
```

## What does NOT live here

- The Quenta safety boundary (anti prompt-injection) stays compiled into the app bundle and is never
  fetched or replaced at runtime — see `frontend/src/lib/quenta/knowledge.ts`.
- User-facing Liatir documentation lives in `docs/`, a separate corpus with the same generator.
