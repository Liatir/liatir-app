# scrollcase — extracting the Runtime Box builder into an independent open-source tool

**Status:** APPROVED TO START (2026-07-25). **Extraction target:** `scrollcase/src/` in the repo
root — the maintainer has scaffolded `scrollcase/` there with an Apache-2.0 `LICENSE`, a `README.md`,
a `.gitignore`, and a VitePress `docs/` site; `src/` is empty and is where the builder is extracted.
It is currently tracked inside `liatir-stack` (not a nested git repo, not yet a workspace member);
P4 moves it to its own repo.
**Prerequisite — REVISED 2026-07-25** (was: "the pixi migration must be fully closed on all
targets"): the builder must be **validated across the full OS/accelerator matrix on ≥1
representative model** — which is met. scGPT is validated on the pixi substrate across
macOS/Linux/Windows × CPU/CUDA/Metal, exercising every builder code path; the remaining models
(Geneformer, UCE) are packaged **after** extraction, **through** the external tool. See the revised
P0 for the rationale and the two Liatir-side caveats that do **not** gate extraction.
**Decision date:** 2026-07-25.

---

## Context (why)

The Runtime Box builder (`scripts/runtime-box*.mjs` + `scripts/runtime-box/`, ~3,900 LOC) turns a
declarative **recipe** into a signed, verifiable, installable Python environment box for scientific
models, wrapped in a license-audit and reproducible-evidence contract. This capability is generic and
rare: anyone building local-first desktop apps that must run heavy ML on heterogeneous hardware
(Metal / CUDA / CPU) needs it, and few solve the signing + license-audit + cross-OS validation
combination well.

The builder is already almost fully decoupled from the Liatir app: the `.mjs` tooling imports **zero**
`liatir-core` code and depends only on `tar`, `yauzl`, `yazl` + `node:*`. The Liatir Rust/Tauri side is
the **consumer** of boxes, not a dependency of the builder — the dependency arrow already points the
right way.

**Decision:** once the pixi migration is complete, extract the builder into a standalone open-source
repository named **`scrollcase`**, licensed **Apache-2.0**, that Liatir consumes as an external tool.
Liatir keeps its proprietary consumer (Rust/Tauri) and its production signing/registry infrastructure
private.

### Confirmed choices
- **Name:** `scrollcase`. **License:** Apache-2.0 (permissive → Liatir can consume it without copyleft
  contamination; explicit patent grant matters for an ML-packaging tool bundling third-party deps).
  The license covers scrollcase's **code**, not the **box contents** (PyTorch, model weights,
  conda-forge deps have their own licenses) — which is exactly what the existing license audit under
  `runtime-boxes/legal/audits/` handles.
- **Scope:** core builder only (registry worker + KMS signer stay private in Liatir) — **but** signing
  capability itself is part of scrollcase (see Signing model).
- **Contract source of truth:** **invert** — scrollcase owns the box-format contract; `liatir-core`
  consumes it.
- **Weights:** recipe format supports **both** embed and on-demand; **default = embed** (no regression
  vs today's behavior, air-gapped-friendly).

---

## Product design (the tool as users experience it)

### Distribution & bootstrap
- `npm install -g scrollcase` (or `npx`) installs the JS CLI + node deps (`tar`, `yauzl`, `yazl`) only.
- `scrollcase init` — **one-time**, per project: scaffolds a `scrollcase.config.json`, an example
  recipe, and a `.gitignore`; then bootstraps the external toolchain (downloads a **pinned** `pixi`,
  installs `conda-pack` via `pixi global install`) with confirmation prompts and size disclosure. If a
  target needs a toolchain it cannot install (e.g. CUDA), it says so clearly instead of failing
  mid-build.
- `scrollcase doctor` — **idempotent**, re-runnable: diagnoses toolchain health (pixi present/pinned,
  conda-pack present, GPU toolchain for the targets in use). Never writes project files.
- **pixi/conda-pack are bootstrapped, not vendored** — they cannot ship inside an npm package. The
  managed-toolchain download reuses the pattern Liatir already has in `src-tauri` `managed_bins`.
- **Toolchain location:** **isolated per-project by default** (reproducible, CI-friendly), with a
  `--global` flag for a shared user-level install (single copy, global state).

### CLI verbs
- `scrollcase build <recipe>` — pixi install from `pixi.lock` → conda-pack → extract to `venv/` → strip
  build-prefix service files → self-test with the box's own interpreter → deterministic ZIP → sign →
  emit box + evidence.
- `scrollcase verify <box>` — hardware/health-check + signature verification against a trusted key set.
  Promotes the existing `--self-test` path to a first-class command.
- `scrollcase audit <recipe|box>` — dependency license inventory (the existing conda/pip audit).
- `scrollcase keygen` — generate a local ed25519 signing keypair (already exists).

### Packing mechanism (settled, not open)
conda-pack with the build-prefix stripped (the embedded `conda-unpack` is deliberately **not** run).
Rationale is recorded in `runtime-box-pixi-phase0-spike.md`: conda-pack ships a ready-to-run **tree**
(zero install-time work on the user's machine); pixi-pack ships **packages** that require a per-user
package install + a bundled `pixi-unpack` binary. The slow step (compression) is paid once per box on
the builder's CI, not on every user install. pixi-pack stays documented as the fallback only.

### Weights model (new capability)
The recipe already declares assets as `assets[]` with `url` + `sha256` + `relativePath`, plus
`assetBaseUrl` (mirror) and `modelCacheSubdir`. Add an explicit per-build **mode**:
- `embed` (default): download assets and pack them into the box (current behavior — air-gapped).
- `on-demand`: do not embed; the box resolves assets at install time from `url`/`assetBaseUrl`, with the
  declared `sha256` guaranteeing integrity. Cheap to add because the descriptor + hash already exist.

### Signing model (pluggable)
Signing is part of the **format and trust model**, so it lives in scrollcase; only Liatir's production
**key custody** stays private.
- **Built-in local-key signer** — `keygen` + sign with a local PEM (already implemented). Any user gets
  signed, verifiable boxes out of the box.
- **Pluggable external signer** — a configurable signer interface/hook (command or module) so an
  operator can plug in KMS/HSM/OIDC signing without the key ever touching the machine. Liatir plugs its
  existing KMS signer here.
- **Verification always built in** — verify a box/release/channel against a configured trust-anchor set.
- **Stays private in Liatir:** `services/runtime-box-signer` (KMS deploy), the production trust key
  `runtime-boxes/trust/production-public.json` (baked into the Liatir binary via `include_str!`), and
  `workers/runtime-box-registry` (Cloudflare control plane).

---

## Extraction: what moves vs what stays

### Moves into `scrollcase`
- Entry points: `scripts/runtime-box.mjs`, `scripts/runtime-box-ci.mjs`, and `scripts/node-cli.mjs`
  (the only local file imported from outside the folder — 45 LOC, copied in).
- All 11 modules in `scripts/runtime-box/` (`archive, evidence, filesystem, heartbeat, identity,
  licenses, pixi, process, python, targets, validator-context`).
- The **box-format contract** (see Contract inversion) + `runtime-boxes/target-id-contract.json`.
- Self-contained tests: `runtime-box-{conda-licenses, pixi, target-adapters, validator-context,
  evidence, cost-controls}.test.ts` (depend only on the extracted modules).
- Example recipes: the `installer-fixture-*` recipes (model-agnostic), as scaffolding samples.
- New files: `package.json`, `LICENSE` (Apache-2.0), `NOTICE`, `README.md`,
  `tests/unit/vitest.config.ts`, `.gitignore`, JSON Schema(s) for recipe/box/manifests,
  `scrollcase.config.json` schema.

### Stays in Liatir (private)
- The consumer: `src-tauri/src/bridge/runtime_boxes.rs` (+ `python_env.rs`, `ai_runtime.rs`,
  `managed_bins.rs`, `ai_hardware.rs`) — genuinely Tauri-coupled (`AppHandle`, 3 `#[tauri::command]`),
  legitimately Liatir-specific.
- Production infra: `workers/runtime-box-registry`, `services/runtime-box-signer`, the trust keys, and
  the model-specific validators/recipes with real weights (`scgpt-*`, `geneformer-*`, `uce-*`) and their
  `.github/workflows/runtime-box-*.yml` (10 workflows) — these depend on Liatir's runners, keys, and R2.
- Tests coupled to app internals: `runtime-box-{ci-catalog, host-selection, publisher,
  target-id-contract, e2e-support, signer-deployment}.test.ts`.

### Naming cleanup
Everything is `Liatir*`-prefixed today. scrollcase's published contract uses neutral names
(`RuntimeBox*` / a `scrollcase` namespace). `liatir-core` re-exports/aliases them so app call sites keep
working.

---

## Contract inversion (the one real architectural change)

Today the box-format contract is **triplicated** and kept in sync by the golden JSON + a contract test:
1. `packages/liatir-core/src/runtime-box.ts` — TS types + `runtimeBoxTargetId()` +
   `isLiatirSignedRuntimeBoxDocument()`; consumed by `frontend/src/lib/ai/*`,
   `workers/runtime-box-registry`, tests.
2. `scripts/runtime-box/targets.mjs` — JS reference used by the CLI/CI.
3. `src-tauri/src/bridge/runtime_boxes.rs` — Rust implementation.
4. `runtime-boxes/target-id-contract.json` — golden cases cross-checking 1/2/3
   (`tests/unit/runtime-box-target-id-contract.test.ts`).

**Target state:** `scrollcase` becomes the **single source of truth** for the box format:
- scrollcase publishes the machine-readable spec (JSON Schema for
  recipe/box/release/channel/revocation + `target-id-contract.json`) **and** a reference JS
  implementation.
- `liatir-core` **depends on** the published `scrollcase` contract package and re-exports the TS types it
  needs (replacing the hand-maintained `runtime-box.ts` definitions with generated/imported ones where
  practical).
- The Rust impl stays a hand-written mirror but is validated in Liatir CI against scrollcase's published
  `target-id-contract.json` fixtures (keep the existing contract test, repoint it at the dependency).
- This honors the CLAUDE.md "single source of truth / avoid duplicated contracts" rule — the source
  simply moves into the published package.

---

## Fixing Liatir to consume scrollcase

1. Add `scrollcase` (contract package) as a `liatir-core` dependency; replace the local box-format types
   with imports/re-exports; run `gen:sdk-types` so generated bindings follow.
2. Repoint the Liatir build/CI scripts (`runtime-box*` npm scripts in root `package.json`) at the
   installed `scrollcase` CLI instead of local `scripts/`. Keep model-specific validators and the
   registry/signer scripts in Liatir.
3. Plug Liatir's KMS signer into scrollcase's external-signer interface; keep trust keys and the
   `include_str!` baked-in anchor in Liatir.
4. Update the contract test to validate the Rust mirror against the dependency's fixtures.
5. Remove the extracted `scripts/runtime-box*` from Liatir once the dependency path is green.

---

## Sequencing (phases)

- **P0 — Prerequisite (REVISED 2026-07-25): MET, extraction approved.** Original wording: "pixi
  migration fully closed on all targets." Revised to: **"the builder validated across the full
  OS/accelerator matrix on ≥1 representative model."** Rationale: the builder is model-agnostic and
  already decoupled (the `.mjs` tooling imports zero `liatir-core`), so migrating Geneformer/UCE
  in-repo would add almost no *builder* coverage — they are PyTorch, the same code paths scGPT
  already exercised on the pixi substrate across macOS/Linux/Windows × CPU/CUDA/Metal. Doing that
  work against a builder about to move is waste; packaging the remaining models **through** the
  external tool is cheaper and is the strongest integration test of the frozen public API. The
  original "don't maintain a public API mid-change" concern is therefore *better* served by
  extracting first. **Two caveats that do NOT gate extraction** — both are Liatir-side release
  concerns (the Rust/Tauri consumer + the private KMS signer, which stay in Liatir by design):
  (1) the macOS pixi box has only been built locally, never validated in CI — scGPT macOS remains
  the uv published pilot; (2) no pixi box has been through a protected release (KMS sign → R2
  publish), only dev-signed local builds + CI validation. Both are closed **after** extraction, via
  scrollcase's pluggable external-signer interface. Since Liatir is not released, retiring the uv
  boxes/recipes is likewise a low-risk downstream cleanup, done per-target once each pixi box is
  published.
- **P1 — Parametrize paths: DONE (2026-07-25).** The `resolve(import.meta.dirname, '..')` root
  assumptions are gone; the builder now resolves its layout from a consumer-owned
  `scrollcase.config.json` with CLI overrides. See "P1 execution record" below for the contract and
  the evidence.
- **P2 — Carve the contract: DONE (2026-07-25).** scrollcase now owns a self-contained contract
  package — reference implementation, JSON Schemas, and golden fixtures — with its own dependencies
  and test command. Liatir was deliberately left untouched. See "P2 execution record" below.
- **P3 — Build the CLI surface:** `init`, `doctor`, `verify`, `audit`, `--global`, weights
  `embed|on-demand`, pluggable signer.
- **P4 — New repo + Apache-2.0 packaging:** move to the standalone repo, add LICENSE/NOTICE/README, CI,
  publish to npm.
- **P5 — Invert & consume:** make `liatir-core` depend on the published package; repoint Liatir scripts;
  plug in KMS signer; delete the in-tree copy.

---

## P1 execution record (2026-07-25)

### The path contract (approved by the maintainer before implementation)

A workspace is declared by the **consumer**, never by the tool — the same model as `tsconfig.json`
or `wrangler.jsonc`. scrollcase ships the resolver, the defaults, and the JSON Schema; each project
that consumes it keeps its own `scrollcase.config.json` at its root. `scrollcase init` (P3) will
scaffold that file; nothing about it lives inside scrollcase itself.

- **Config file:** `scrollcase.config.json`, `{ "version": 1, "paths": { recipes, build, dist, keys } }`.
  Every field is optional. Schema: `scripts/runtime-box/scrollcase.config.schema.json` (moves with the
  tool). Relative values resolve against the project root, so the file is portable; absolute values
  are taken as given. Unknown keys, a wrong version, and empty values are hard errors rather than
  silent fallbacks.
- **Defaults (unchanged from the historical layout):** `runtime-boxes/recipes`, `.runtime-box-build`,
  `.runtime-box-dist`, `.runtime-box-local`.
- **CLI overrides:** `--config`, `--project-root`, `--recipes-dir`, `--build-dir`, `--out-dir`,
  `--keys-dir`. Flag values resolve against the working directory, which is what a shell user expects.
- **Precedence:** CLI flag > `scrollcase.config.json` > built-in default. The root is the
  `--project-root`, else the directory of an explicit `--config`, else the nearest
  `scrollcase.config.json` found walking up from the working directory, else the working directory.
- **Liatir's own config is committed at the repo root**, which makes the root explicit rather than
  cwd-dependent and is the natural integration point for P5.

### What changed

- New `scripts/runtime-box/workspace.mjs` (resolver, memoized per process, with a test seam) and
  `scripts/runtime-box/scrollcase.config.schema.json`.
- `runtime-box.mjs`, `runtime-box-ci.mjs` and `runtime-box/evidence.mjs` read paths through lazy
  workspace accessors instead of module-level constants derived from `import.meta.dirname`, so the
  entry point can configure the layout from flags before the first path is resolved.
- Liatir's `runtime-box*` npm scripts are untouched and keep working: they run from the repo root,
  where the committed config resolves to exactly the previous paths.
- `scrollcase.config.json` committed at the liatir-stack root.
- New `tests/unit/runtime-box-workspace.test.ts` (9 tests) covering defaults, walk-up discovery,
  flag-over-config precedence, absolute paths, argv scanning, malformed-config rejection, and memoization.

### Evidence (all local, zero cost)

- **Behavioral identity proven by A/B build.** The `installer-fixture-macos-arm64` box was built in
  the same directory from HEAD and from the P1 tree. Unzipping both and diffing the trees recursively
  reports exactly one differing file, `box.json`, whose only differing line is
  `"sourceTreeDirty": false` → `true` — the builder honestly recording that the P1 changes were still
  uncommitted. The payload is byte-identical; archive hashes are `7ff006f4…9775` (HEAD, clean tree)
  and `a72eb1fa…b383` (P1, dirty tree). A HEAD build in a separate worktree produced the identical
  `7ff006f4…9775`, confirming the archive does not depend on the build directory and isolating the
  provenance flag as the sole cause.
- `node scripts/validate-runtime-box-native-fixture.mjs --recipe installer-fixture-macos-arm64`
  passed on the P1 tree: build, deterministic rebuild (the validator asserts the two archives are
  byte-identical), signature verification, and `verify --self-test`.
- `npm run test:unit`: **190/190 passed**, 31 files (was 181; the 9 new workspace tests are the delta).
- `npm run runtime-box:catalog:check`: 3 model records, 3 foundation fixtures validated.
- `npm run runtime-box:test:foundation`: Gate 2 foundation validation passed, including the Rust
  `bridge::runtime_boxes` large-archive fixture test.
- `npm run lint:ts`: 0 errors (43 pre-existing warnings under `packages/`, unrelated).

### Follow-up noted, deliberately not done in P1

`scripts/validate-runtime-box-native-fixture.mjs` still derives its own root from
`import.meta.dirname`. It is a Liatir-side validator that stays private and invokes the CLI with the
repository as its working directory, so it is unaffected; it is listed here so the remaining
assumption is not forgotten.

## P2 execution record (2026-07-25)

### The rule this phase established

**`scrollcase/` is treated as an external repository from now on.** It is not a part of Liatir, not
even partially: Liatir's CI does not watch it, Liatir's code does not import from it, and its tests
run on their own. It happens to sit inside `liatir-stack` only until P4 moves it out. Liatir becomes
an ordinary consumer of an external tool at P5, when it installs the published package and deletes
its in-tree copies.

This ruled out two designs that were considered and rejected: adding `scrollcase/**` to the Liatir
workflow path filters (Liatir's CI would be testing an external project), and keeping a generated
mirror of the contract at the old Liatir paths (a copy is exactly what the extraction is removing).
The consequence is accepted deliberately: **during P2–P4 the contract exists twice** — the live copy
Liatir still builds with, and scrollcase's, which is now the source of truth. The contract is frozen
for byte-compatibility anyway, and P5 deletes the Liatir side.

### What scrollcase now owns

`scrollcase/` is a standalone package: `package.json` (Apache-2.0, `type: module`, exports
`./contract`), `NOTICE`, its own `devDependencies` and its own `npm test`. Under
`src/contract/`:

- **Reference implementation.** `targets.mjs` (the target model, identity rule, and per-target
  payload adapters) and `documents.mjs` (the signed-envelope contract: schema version, payload
  encoding, signature algorithm, document kinds, a structural check, and a hash-verifying payload
  decoder). `index.mjs` is the public surface and resolves shipped schemas and fixtures by URL.
- **Machine-readable spec.** Seven JSON Schemas (2020-12): `target`, `signed-document`,
  `release-manifest`, `channel-manifest`, `revocations-manifest`, `box-manifest`, `recipe`. They were
  written from real emitted documents and from the field set the builder actually reads, not from
  memory.
- **Golden fixtures.** `fixtures/target-id-contract.json` (byte-identical to Liatir's, verified) plus
  `fixtures/examples/` holding a real release manifest, channel manifest, `box.json`, signed
  envelope, and both a uv and a pixi recipe. The pixi example is synthetic and model-neutral; no
  Liatir model recipe, weight, or asset URL was copied into the tool.

### Decisions taken, with their reasons

- **Wire `kind` strings stay `liatir.runtime-box.*` verbatim.** They are baked into published boxes,
  the deployed registry, and installed clients; renaming them is a breaking format change that can
  only arrive with a new `schemaVersion`, never as a silent edit. Recorded in the schemas themselves.
  A neutral rename is an open decision for a future format version, not a P2 cleanup.
- **`https://scrollcase.dev/schema/...` is used as the schema `$id` namespace**, matching the choice
  made in P1 for the config schema. A JSON Schema `$id` is an identifier rather than a fetched URL,
  so this is safe, but the domain should be confirmed when publishing at P4.
- **Ajv runs with `strict: true` but `strictRequired: false`** in scrollcase's tests. `strictRequired`
  is an Ajv lint, not a spec rule, and it rejects `required` inside an `if`/`then` or `oneOf` branch —
  exactly how the conditional CUDA rule and the pixi-vs-uv substrate rule are expressed.

### P2 evidence (all local, zero cost)

- `npm test` inside `scrollcase/`: **17/17 passed**, 2 files, on its own vitest + ajv install. The
  suite proves the reference implementation matches every golden case, that the schemas accept the
  real documents the builder emits, that schema and implementation accept and reject exactly the same
  targets, and that a tampered payload hash and four malformed envelopes are refused.
- **No drift at seeding:** `scrollcase/src/contract/targets.mjs` differs from
  `scripts/runtime-box/targets.mjs` by exactly the 14-line header comment; the code is byte-identical.
  `fixtures/target-id-contract.json` is byte-identical to `runtime-boxes/target-id-contract.json`.
- **Liatir untouched:** `git status` shows only additions under `scrollcase/`, and
  `npm run test:unit` still passes 190/190 across 31 files.

## Verification

- **scrollcase standalone:** `npm test` (the 6 migrated vitest files) green in the new repo; a full
  `scrollcase init` → `build <installer-fixture>` → `verify` cycle passes on a clean machine with only
  Node installed (proves the bootstrap story). Local `keygen` → sign → `verify` round-trips.
- **Contract parity:** the target-id contract test passes against scrollcase's published fixtures in all
  three surfaces (JS reference, `liatir-core` TS, Rust mirror).
- **Liatir regression:** `npm run test:verify`, `cargo test runtime_box`, catalog check, and `lint:ts`
  clean after repointing to the dependency (commands are authoritative in `package.json` / `Cargo.toml`
  — read them at execution time, do not hardcode).
- **No consumer change needed for weights default** — `embed` keeps current box output byte-compatible;
  verify a rebuilt `installer-fixture` box against the existing Rust install path.
