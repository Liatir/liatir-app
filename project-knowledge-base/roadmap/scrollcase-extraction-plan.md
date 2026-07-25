# scrollcase — extracting the Runtime Box builder into an independent open-source tool

**Status:** planned, not started. **Hard prerequisite:** the pixi migration must be fully closed on
all targets before extraction begins (see `runtime-box-pixi-migration.md`).
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

- **P0 — Prerequisite:** pixi migration fully closed on all targets. Do not start extraction before this
  (avoids maintaining a public API mid-change).
- **P1 — Parametrize paths:** replace `resolve(import.meta.dirname, '..')` root assumptions
  (`runtime-box.mjs:96`, `evidence.mjs`) with `--recipes-dir`/`--out-dir` or `scrollcase.config.json`
  discovery. This is the only mechanical refactor and is worth doing regardless.
- **P2 — Carve the contract:** extract the box-format spec + reference impl into the scrollcase package
  boundary; add JSON Schemas; wire the golden fixtures.
- **P3 — Build the CLI surface:** `init`, `doctor`, `verify`, `audit`, `--global`, weights
  `embed|on-demand`, pluggable signer.
- **P4 — New repo + Apache-2.0 packaging:** move to the standalone repo, add LICENSE/NOTICE/README, CI,
  publish to npm.
- **P5 — Invert & consume:** make `liatir-core` depend on the published package; repoint Liatir scripts;
  plug in KMS signer; delete the in-tree copy.

---

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
