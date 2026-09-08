# scrollcase — extracting the Runtime Box builder into an independent open-source tool

Last reviewed: 2026-08-11

**Status:** **EXTRACTION COMPLETE (P1–P4, 2026-07-26).** Scrollcase is an independent
Apache-2.0 project at `https://github.com/suffro/scrollcase`, its documentation is live at
`https://scrollcase.dev`, and Liatir's verified extraction baseline is
`scrollcase@0.1.3` (`0.1.0` was the original release). The public package has
since advanced and Liatir now pins exact v2-only `scrollcase@0.8.0`; adopting
and updating that line is downstream Liatir work, not a reopening of extraction. The temporary in-tree
`scrollcase` copy was removed from Liatir in commit `6b4934e`.

**Downstream adoption:** **P5 is complete in Liatir; P5.0, P5.1, P5.2,
P5.2V, P5.3, P5.4, P5.4R, P5.4T, P5.4E, P5.4V, P5.4W, P5.4P, P5.5, P5.6 and P5.7 are complete.**
Exact `scrollcase@0.8.0` is installed,
the v2-only cutover is complete, all active recipes use pixi/conda-pack, and all
nine current model targets are published. No extraction or adoption phase
remains open.
The historical `scrollcase@0.1.3` contract inversion and clean
keygen/lock/build/verify consumer cycle remain prior evidence, not the target
architecture.
P5.2/P5.2V added the consumer and signer/distribution adapters, replaced the
active contract with v2 across every Liatir surface, removed active v1 parsing,
and defined explicit unsupported/removal handling for installed v1 state.
P5.3/P5.4 completed every foundation and model migration, P5.4R closed the Rust
delegation boundary, and P5.5 deleted the local builder plus every superseded
generic helper copy. P5.6 then closed the final local/native product lifecycle;
P5.7 reconciled the documentation and operator handoff. Future product
anti-replay work is downstream Liatir hardening, not Scrollcase extraction.
This integration does not change Scrollcase's completed extraction or its
independence. The detailed canonical execution plan is
[Scrollcase P5 — Liatir adoption](./scrollcase-p5-liatir-adoption.md).
**Prerequisite — REVISED 2026-07-25** (was: "the pixi migration must be fully closed on all
targets"): the builder must be **validated across the full OS/accelerator matrix on ≥1
representative model** — which is met. scGPT is validated on the pixi substrate across
macOS/Linux/Windows × CPU/CUDA/Metal, exercising every builder code path; the remaining models
(Geneformer, UCE) are packaged **after** extraction, **through** the external tool. See the revised
P0 for the rationale and the two Liatir-side caveats that do **not** gate extraction.
**Decision date:** 2026-07-25.

---

## Context (why)

The following context and move map describe the pre-extraction Liatir source at
the time P1–P4 were planned. They are historical provenance, not a claim that
Scrollcase source still exists in this repository.

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
- `scrollcase build <recipe>` — pixi install from `pixi.lock` → conda-pack → extract to `venv` → strip
  build-prefix service files → self-test with the box's own interpreter → deterministic ZIP → sign →
  emit box + evidence.
- `scrollcase verify <box>` — hardware/health-check + signature verification against a trusted key set.
  Promotes the existing `--self-test` path to a first-class command.
- `scrollcase audit <recipe|box>` — dependency license inventory (the existing conda/pip audit).
- `scrollcase keygen` — generate a local ed25519 signing keypair (already exists).

### Packing mechanism (settled, not open)
conda-pack with the build-prefix stripped (the embedded `conda-unpack` is deliberately **not** run).
Rationale is recorded in `.context/decisions/runtime-box-pixi-phase0-spike.md`: conda-pack ships a ready-to-run **tree**
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

**REWRITTEN 2026-07-25 from the actual import graph.** The maintainer's rule, stated plainly: *scrollcase
packages a model into a portable, locked, self-contained box for each OS using pixi + conda-pack +
conda-forge, and nothing else.* CI, the model catalog, runner allocation, scientific validation, R2
publication, the Cloudflare registry and KMS signing are **Liatir's**, and a consumer of the tool
would have its own equivalents or none at all. The earlier inventory was written from what imported
what and dragged roughly 2,000 lines of Liatir infrastructure into the tool. Corrected below.

### Moves into `scrollcase`
- **The builder entry point, minus distribution:** `scripts/runtime-box.mjs` lines ~115–829 —
  argument parsing, local key handling and signing, uv/pixi discovery, `lock`, verified asset
  download, archive extraction, `buildRecipe` (the 255-line core), and `verifyRelease`. Verbs:
  `build`, `verify`, `lock`, `keygen`.
- **The 9 modules the builder actually imports:** `archive` (214), `filesystem` (80), `licenses`
  (233), `identity` (23), `process` (29), `workspace` (191), `python` (194), `pixi` (202), and
  `targets` (217, already carved out at P2 together with the document contract).
- Self-contained tests: `runtime-box-{conda-licenses, pixi, target-adapters}.test.ts` — the three
  that exercise only the modules above.
- Example recipes: neutral, synthetic ones. The `installer-fixture-*` recipes are Liatir fixtures and
  are not shipped as-is.
- New files: `package.json`, `LICENSE` (Apache-2.0), `NOTICE`, `README.md`, a vitest config,
  `.gitignore`, the JSON Schemas, and the `scrollcase.config.json` schema (currently parked in
  `scripts/runtime-box/` from P1 — it belongs to the tool and moves with it).

**Roughly 2,100 lines move, not 4,100.** Of those, ~430 (the contract) are already in scrollcase.

### Stays in Liatir (private)
- **The whole CI entry point: `scripts/runtime-box-ci.mjs` (812 LOC).** Not split, not partially
  moved — it *is* Liatir's CI: the model catalog, runner profiles and host probing, GitHub Actions
  outputs, the cost policy, disk-plan gating, and the evidence records. A tool that packages a model
  has no business knowing any of it.
- **`scripts/runtime-box/evidence.mjs` (601 LOC), `heartbeat.mjs` (110) and `validator-context.mjs`
  (62).** The import graph settles it: the builder entry point imports none of the three. `evidence`
  and `heartbeat` are imported only by the CI entry point, and `validator-context` only by Liatir's
  model validators (`validate-scgpt-runtime.mjs`, `validate-uce-runtime.mjs`).
- **`scripts/node-cli.mjs` (45 LOC).** Its `npmInvocation` exists to spawn *Liatir's own npm scripts*
  (`npm run <scientific validator>`, `npm run runtime-box -- build …`), and `heartbeat` special-cases
  the literal command `npm` while passing pixi, cargo, node and python straight through. A standalone
  CLI never needs it; ten other Liatir callers do.
- **Distribution: `runtime-box.mjs` lines ~830–1223 (~390 LOC)** — multipart R2 upload, remote object
  verification, the registry admin token, `publish`, `publish-key`, `promote`, and the local `serve`
  helper. Liatir builds a box with scrollcase and then puts it on R2 through its own infrastructure;
  the tool stops at a signed, verified box on disk. `revoke` and `serve` are the two grey cases to
  settle at P3: both sign or serve format documents, but both exist to feed Liatir's registry.
- The consumer: `src-tauri/src/bridge/runtime_boxes.rs` (+ `python_env.rs`, `ai_runtime.rs`,
  `managed_bins.rs`, `ai_hardware.rs`) — genuinely Tauri-coupled (`AppHandle`, 3 `#[tauri::command]`),
  legitimately Liatir-specific.
- Production infra: `workers/runtime-box-registry`, `services/runtime-box-signer`, the trust keys, and
  the model-specific validators/recipes with real weights (`scgpt-*`, `geneformer-*`, `uce-*`) and their
  `.github/workflows/runtime-box-*.yml` (10 workflows) — these depend on Liatir's runners, keys, and R2.
- Tests coupled to Liatir's CI or app internals: `runtime-box-{ci-catalog, host-selection, publisher,
  target-id-contract, e2e-support, signer-deployment, evidence, cost-controls,
  validator-context}.test.ts`.

### Naming cleanup — DONE (2026-07-25)
scrollcase ships no Liatir name and no Liatir product vocabulary. "Runtime Box" was Liatir's product
term and is gone from the tool: the artifact is a **box**, matching the `scrollcase.box` document
namespace. The contract API is now `boxTargetId`, `boxTargetAdapter(s)`, `assertNativeHost`,
`assertPythonEntryPoint`, `torchBackendArguments`, `lockArguments`, `condaSubdir`, `pixiAccelerator`,
`BOX_SCHEMA_VERSION`, `isSignedBoxDocument`; schema titles and error messages follow. Liatir's own
types keep their `Liatir*` prefix on its side of the boundary, and `liatir-core` aliases the tool's
names at P5 so app call sites keep working.

### P3 design item — accelerator parity and tolerances belong to the tool

Raised by the maintainer 2026-07-25 and adopted. Today every model validator hard-codes its own
thresholds and re-implements the same comparison: `ai-validation/geneformer-parity.py` carries
`CPU_RELATIVE_TOLERANCE`, `CPU_ABSOLUTE_TOLERANCE`, `ACCELERATOR_RELATIVE_TOLERANCE`,
`ACCELERATOR_ABSOLUTE_TOLERANCE` and `ACCELERATOR_MINIMUM_COSINE` as constants, and
`validate-scgpt-runtime.mjs` carries its own `MINIMUM_COSINE_SIMILARITY` plus a hand-rolled cosine.

The question those checks answer — *does this box produce the same numbers on CUDA as on CPU?* — is a
**packaging** question, not a scientific one. It catches the wrong wheels, a CPU-only build shipped as
CUDA, a bad BLAS. Any tool packaging a model for several accelerators faces it, and scrollcase already
holds half the mechanism: each target adapter carries `validationEnvironments`
(`CUDA_VISIBLE_DEVICES`, `PYTORCH_ENABLE_MPS_FALLBACK`), i.e. it already knows how to force a run onto
CPU or onto the accelerator.

So the split is:
- **The tool owns the mechanism and the declaration.** Tolerances (`rtol`, `atol`, minimum cosine)
  become recipe data rather than constants in per-model code; scrollcase runs the declared check
  inside the box once per accelerator, compares the emitted arrays against the declared tolerances,
  fails the build on a breach, and records the measured values in the box's evidence.
- **The consumer owns the meaning.** The script that decides what to feed the model and which tensor
  to read, the fixture, and the scientific interpretation stay with the project. scrollcase never
  decides what is scientifically correct — it enforces a threshold its user declared.

This upgrades `selfTest` from "imports plus files plus arbitrary Python" into a real numerical gate.
It is **new capability, not a move**: nothing existing is lifted. Note that
`scripts/runtime-box/validator-context.mjs` is the closest existing relative — its
`productAcceleratorForTarget` and accelerator normalization are generic — but the file as written is
Liatir's (its `LIATIR_*` environment variables and repository paths), so it is rewritten in the tool,
not moved.

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
- **P3 — Move the builder and build the CLI surface: DONE (2026-07-25).** Seven verbs, pixi-only,
  pluggable signer, weights `embed|on-demand`, declared parity tolerances. `revoke` and `serve` were
  settled as Liatir's. See the P3 execution record. **Not done, deliberately deferred:** toolchain
  bootstrap (`init` downloading a pinned pixi and installing conda-pack) and the `--global` shared
  toolchain flag. Doing that responsibly means pinning a release checksum per platform, which is
  release engineering for P4, not something to fake now; `doctor` meanwhile names the exact missing
  tool and how to install it.
- **P4 — New repo + Apache-2.0 packaging: DONE (2026-07-26).** Scrollcase now lives in its
  standalone public repository with its own CI, documentation and package surface;
  `scrollcase@0.1.0` is public on npm. See the P4 execution record.
- **P5 — Invert & consume: IN PROGRESS. The schema-v1 P5.0–P5.2 work is a
  completed historical checkpoint; the exact `scrollcase@0.4.11` v2-only P5.2V
  cutover is complete, and P5.3 is complete on macOS with native Linux/Windows
  evidence pending.**
  The historical core contract aliases/refinements and compatibility fixtures
  for `scrollcase@0.1.3` were replaced rather than extended.
  Follow the
  [canonical P5 execution plan](./scrollcase-p5-liatir-adoption.md): prove the published
  package surface, replace the active contract with v2 across every Liatir
  boundary, add the signer/evidence/distribution adapter, migrate all active uv
  recipes, then delete the local generic builder and every v1 consumer path.

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

**From P2 onward, `scrollcase` was treated as an external repository.** It was not part
of Liatir even while temporarily tracked there: Liatir's CI did not watch it, Liatir's
code did not import from it, and its tests ran on their own. P4 subsequently moved it to
the standalone repository and commit `6b4934e` removed the temporary in-tree copy. Liatir
becomes an ordinary package consumer at P5, when it installs the published package and
deletes its local contract and builder copies.

This ruled out two designs that were considered and rejected: adding `scrollcase/**` to the Liatir
workflow path filters (Liatir's CI would be testing an external project), and keeping a generated
mirror of the contract at the old Liatir paths (a copy is exactly what the extraction is removing).
The consequence is accepted deliberately: **during P2–P4 the contract exists twice** — the live copy
Liatir still builds with, and scrollcase's, which is now the source of truth. The contract is frozen
for byte-compatibility anyway, and P5 deletes the Liatir side.

### What scrollcase now owns

`scrollcase` is a standalone package: `package.json` (Apache-2.0, `type: module`, exports
`./contract`), `NOTICE`, its own `devDependencies` and its own `npm test`. Under
`src/contract`:

- **Reference implementation.** `targets.mjs` (the target model, identity rule, and per-target
  payload adapters) and `documents.mjs` (the signed-envelope contract: schema version, payload
  encoding, signature algorithm, document kinds, a structural check, and a hash-verifying payload
  decoder). `index.mjs` is the public surface and resolves shipped schemas and fixtures by URL.
- **Machine-readable spec.** Seven JSON Schemas (2020-12): `target`, `signed-document`,
  `release-manifest`, `channel-manifest`, `revocations-manifest`, `box-manifest`, `recipe`. They were
  written from real emitted documents and from the field set the builder actually reads, not from
  memory.
- **Golden fixtures.** `fixtures/target-id-contract.json` (byte-identical to Liatir's, verified) plus
  `fixtures/examples` holding a real release manifest, channel manifest, `box.json`, signed
  envelope, and both a uv and a pixi recipe. The pixi example is synthetic and model-neutral; no
  Liatir model recipe, weight, or asset URL was copied into the tool.

### Decisions taken, with their reasons

- **scrollcase contains no reference to Liatir, anywhere.** Not in code, schemas, fixtures, tests,
  examples, or NOTICE — verified by grep. An earlier draft of this phase kept the wire `kind` strings
  as `liatir.runtime-box.*` on byte-compatibility grounds and was **rejected by the maintainer**: a
  tool that is meant to be independent cannot carry its first consumer's name in its format.
- **The document namespace is the consumer's, not the tool's.** `kind` is `<namespace>.release` /
  `.channel` / `.revocations`. `documentKinds(namespace)` builds them, `parseDocumentKind()` splits
  them back, and the schemas validate the shape rather than one hard-coded string. scrollcase's own
  default is `scrollcase.box`. This is what dissolves the apparent conflict with byte-compatibility:
  a project with boxes already in the field keeps emitting the namespace its clients recognise by
  declaring it, and the tool never needs to know whose it is. Liatir declares
  `liatir.runtime-box` when it adopts scrollcase at P5, and its documents stay byte-identical.
- **Compatibility constraints are pass-through, not Liatir's.** `minLiatirVersion` is gone from the
  schemas; the neutral fields are `minHostAppVersion` / `maxHostAppVersionExclusive`, and the
  `compatibility` object is open, because the builder copies it into the release manifest verbatim
  and never interprets it. A project may declare its own constraints there — including a legacy field
  name — without the tool defining them.
- **Every example is synthetic.** The fixture examples were regenerated for a fictional
  `example-model` published at `assets.example.org`, and the signed envelope was re-signed with a
  throwaway ed25519 key whose public half ships beside it, so the example verifies without any Liatir
  artifact, URL, model, or development key being shipped in the tool.
- **`https://scrollcase.dev/schema/...` is used as the schema `$id` namespace**, matching the choice
  made in P1 for the config schema. A JSON Schema `$id` is an identifier rather than a fetched URL,
  so this is safe, but the domain should be confirmed when publishing at P4.
- **Ajv runs with `strict: true` but `strictRequired: false`** in scrollcase's tests. `strictRequired`
  is an Ajv lint, not a spec rule, and it rejects `required` inside an `if`/`then` or `oneOf` branch —
  exactly how the conditional CUDA rule and the pixi-vs-uv substrate rule are expressed.

### P2 evidence (all local, zero cost)

- `npm test` inside `scrollcase`: **21/21 passed**, 2 files, on its own vitest + ajv install. The
  suite proves the reference implementation matches every golden case, that the schemas accept the
  real documents the builder emits, that schema and implementation accept and reject exactly the same
  targets, that a namespace belonging to another project round-trips while a malformed one is
  refused, and that a tampered payload hash and four malformed envelopes are rejected.
- **No Liatir reference survives in the tool:** `grep -rin liatir` over `scrollcase/src`,
  `scrollcase/tests`, `NOTICE` and `package.json` returns nothing. The only remaining hits under
  `scrollcase` are in the maintainer-authored VitePress theme (`HomePage.vue`,
  `HomePage.released.vue`, `PatreonButton.vue`, `CookieBanner.vue`), which still carries Liatir
  marketing copy, the Patreon label, and a `liatir-cookie-consent-v1` storage key from the site it
  was scaffolded off. That is the maintainer's content and was left untouched.
- **No drift at seeding:** `scrollcase/src/contract/targets.mjs` differs from
  `scripts/runtime-box/targets.mjs` by exactly the 14-line header comment; the code is byte-identical.
  `fixtures/target-id-contract.json` is byte-identical to `runtime-boxes/target-id-contract.json`.
- **Liatir untouched:** `git status` shows only additions under `scrollcase`, and
  `npm run test:unit` still passes 190/190 across 31 files.

## P3 execution record — COMPLETE (2026-07-25)

scrollcase is a working tool: it sets a project up, tells you what your machine is missing, resolves
and audits dependencies, builds a signed box, and verifies one. Seven verbs — `init`, `doctor`,
`keygen`, `lock`, `audit`, `build`, `verify` — plus declared accelerator-parity tolerances and a
choice of embedded or on-demand weights.

### The substrate decision: pixi only

The uv path did not come along. scrollcase is a pixi + conda-pack + conda-forge tool, and a packaging
tool with two dependency backends has to prove every guarantee twice. Dropped: `findUv` and the uv
lock path, standalone-Python staging and relocation validation (`python.mjs` becomes `launchers.mjs`,
the ~50 lines the conda path actually uses), the `.dist-info` licence audit (the conda audit is
lock-derived and needs no built prefix), and the `--torch-backend` / `uv pip compile` helpers that P2
had carried into the contract along with `uvPlatform`. The recipe schema requires `pixiVersion`;
provenance records it alone.

**Consequence for Liatir:** Geneformer and UCE still have uv recipes and must become pixi recipes to
be built by scrollcase — already the direction of the pixi migration and of the revised P0. Liatir
keeps its own uv-capable builder until P5, so nothing breaks today.

### What moved, and what the tool now is

`src/build` holds the 8 modules the builder actually imports plus the ported core: recipe reading
and provenance, verified asset staging, the build orchestration, and verify. `src/sign` holds key
generation, local signing, and verification. `src/cli.mjs` exposes four verbs — `keygen`, `lock`,
`build`, `verify` — resolving every path through the workspace.

**Signing is custody-agnostic.** The built-in path uses a local ed25519 key. The external path hands
the payload to a command the operator configures, on stdin, and reads the signed document from
stdout — any language, any credential mechanism, no plugin API. Nothing about gcloud, KMS or Cloud
Run survives in the tool. The external signer is not trusted on its word: the returned document must
echo the exact payload it was given, and its signature is verified locally before the build
continues. Liatir plugs its KMS signer in here at P5 with a small wrapper.

### Five more Liatir references, found and removed

They arrived inside the moved modules, after the P2 grep had already passed: the
`LIATIR_RUNTIME_BOX_PIXI` / `LIATIR_RUNTIME_BOX_CONDA_PACK` environment variables, a temp-directory
prefix, the hard-coded licence-audit `kind` (now namespaced like every other document), and — the one
that mattered — **the default workspace paths, which were Liatir's directory names**. Defaults are now
`recipes` and `.scrollcase/{build,dist,keys}`; a project that keeps its files elsewhere says so in
its config, which is the mechanism working as designed. Lesson recorded: re-grep after every move,
because a clean grep only describes the tree at the time it ran.

### The rest of the CLI surface

- **`init`** scaffolds a config, an example recipe with the manifest already pinned to the target's
  conda subdirectory, and the ignore rules for generated state. It never overwrites: existing files
  are reported as kept, so a half-configured project is completed by running it again.
- **`doctor`** reports whether the machine can build — workspace, recipes directory, git, pixi at the
  required version, conda-pack — with a remedy per failure, and exits non-zero. It reports rather than
  throws on the first problem, so someone with nothing installed learns everything in one run.
  `init` writes and never touches the network; `doctor` reads and never writes. That line is what
  makes `doctor` safe in CI and `init` safe to re-run.
- **`audit`** produces the licence inventory straight from the lock, with no build. Licence review is
  a human step that belongs when dependencies change, not at the end of a multi-gigabyte build.
  `--write` records the reviewed copy; without it the inventory is compared and any drift fails.
- **Weights `embed|on-demand`.** `embed` (default) packs assets into the archive, so an installed box
  needs no network and works air-gapped. `on-demand` leaves them out and carries their descriptors —
  url, path, size, SHA-256 — in the signed release and in `box.json`, so a consumer fetches and
  verifies them at install. The declared hash is what makes that safe. Deferred assets are excluded
  from the self-test file check (they are legitimately absent), and combining on-demand with
  `assetArchives` is refused, since an archive is expanded at build time and cannot be deferred.
- **Declared parity tolerances**, as designed above: `parity` in the recipe names a script inside the
  box, the accelerators to run it under, and the bounds (`absolute`, `relative`, `minimumCosine`).
  The first accelerator is the reference. Non-finite output is rejected explicitly, being the classic
  symptom of a broken accelerator build, and relative error is only counted where the reference has
  magnitude, with the absolute bound guarding entries near zero.

### `revoke` and `serve`: settled — both stay in Liatir

Both sign or serve format documents, which is why they looked like tool verbs. Neither is: `revoke`
exists to tell a *registry* to stop serving a release, and `serve` exists to stand in for one
locally. Distribution is the consumer's, so a tool that stops at a signed, verified box on disk has
no business with either. They stay in Liatir with `publish`, `publish-key` and `promote`.

### P3 evidence (all local, zero cost)

- **A real box, built and verified end to end with the actual toolchain.** pixi 0.73.0 and conda-pack
  are installed on the maintainer's Mac under a dedicated `PIXI_HOME` at `~/.local/liatir-pixi/bin`
  (not on `PATH`, which is why a bare `which pixi` finds nothing). Against a throwaway project:
  `scrollcase lock` resolved `pixi.toml` into a real `pixi.lock` (python 3.11.15 from conda-forge),
  `keygen` produced a key, `build` installed from the lock, packed the prefix with conda-pack, ran
  the self-test with the box's own interpreter, wrote a deterministic 49,812,054-byte archive
  (`73e56c2f…`) and signed the release and channel, and `verify --self-test` extracted the archive
  and imported `json` and `sqlite3` **with the Python inside the box**: `Verified hello-box 1.0.0
  (macos-aarch64-metal)`, exit 0. The recipe is shipped as `examples/hello-box-macos-arm64-metal`.
- **`doctor` and `audit` against that same real project.** `doctor` passed all five checks naming the
  real pixi and conda-pack; `audit` listed the 13 packages of the example lock with their SPDX
  licences (MIT ×2, 0BSD, Apache-2.0, GPL-3.0-only, Python-2.0, TCL, X11 AND BSD-3-Clause, …) without
  building anything. `init` scaffolded a fresh project, and `doctor` then reported exactly what that
  machine was missing — no git checkout, no pixi, no conda-pack — each with its remedy, exiting 1.
- `npm test` inside `scrollcase`: **51/51 across 5 files.** The pipeline test builds, signs and
  verifies with the environment solve stubbed, and asserts that rebuilding the same commit yields a
  byte-identical archive, that a dirty tree is refused unless explicit, that a pruned-away self-test
  file fails the build, that a tampered archive and a foreign signing key are rejected, and that
  on-demand weights leave the payload out while carrying verified descriptors. The parity suite
  covers the comparison arithmetic, each tolerance breach, non-finite output, malformed check output,
  and an accelerator the target does not define. The project suite covers scaffolding, re-running
  `init` safely, cross-platform scaffolding, all-at-once diagnosis, a wrong pixi version, that
  `doctor` writes nothing, and that a stale reviewed audit fails.
- **A real defect the extraction introduced, caught by those tests:** trimming `licenses.mjs` to its
  conda half dropped the `CONDA_PACKAGE_FILE` constant its parser uses, so every audit threw
  `ReferenceError`. The P2 tests had not exercised that path end to end. Restored, with the audit
  suite now covering it.
- Liatir remains untouched and green at 190/190.

## P4 execution record — COMPLETE (2026-07-26)

Scrollcase is no longer a directory or implicit workspace inside Liatir. It is a standalone,
vendor-neutral open-source project with its own repository, release lifecycle, tests and
documentation. Liatir is only its first downstream consumer.

### Public release and package surface

- Repository: `https://github.com/suffro/scrollcase`.
- Documentation: `https://scrollcase.dev`.
- npm package: unscoped `scrollcase@0.1.0`, published
  `2026-07-26T16:15:08.771Z`; executable name `scrollcase`.
- Registry tarball:
  `https://registry.npmjs.org/scrollcase/-/scrollcase-0.1.0.tgz`, SHA-1
  `e6e0f4f44e6f2f9220a9b234f692d312f100fc2f`.
- Public library entry points: `scrollcase/contract`, `scrollcase/contract/types`,
  schema and fixture wildcard exports, `scrollcase/build`, and `scrollcase/sign`.
- Runtime dependencies are only `tar`, `yauzl`, and `yazl`; the package is
  Apache-2.0 and contains no consumer-specific name or Liatir product vocabulary.
- The release includes generated TypeScript contract types derived from the JSON
  Schemas. A drift test regenerates and compares them, and line-ending normalization
  keeps that exact-byte gate portable across Windows and POSIX checkouts.

Publication was performed by the maintainer. The final package dry run contained 44 files
(66.8 kB packed, 228.1 kB unpacked); a fresh consumer installed the packed tarball,
imported every public entry point and ran the CLI. Root runtime and documentation audits
reported zero vulnerabilities.

### Toolchain and verification evidence

- `init` can install pinned pixi and conda-pack into the project's own
  `.scrollcase/toolchain`, but only with explicit consent. The pixi release archive is
  checksum-verified and the verified digest is committed in `scrollcase.config.json`.
  Tool discovery is explicit flag, environment override, project toolchain, then `PATH`.
- The managed toolchain was proven against a throwaway project: pixi `0.73.0` and
  conda-pack `0.9.2` were installed, then `doctor` found both without environment
  overrides. The optional shared `--global` toolchain remains deliberately unimplemented;
  it is not part of the `0.1.0` contract.
- A real clean project completed `lock` → `keygen` → `build` →
  `verify --self-test`. The resulting
  `hello-box-1.0.0-macos-aarch64-metal.zip` was 49,811,879 bytes with SHA-256
  `17c0e0a771f8244acbee2e0e0698c30dd00fa131c6f38332869d28d7673721dc`;
  verification imported `json` and `sqlite3` with the Python inside the extracted box.
- The standalone suite passed 84 tests across 10 files without network or a real
  toolchain. CI run `30209373381` passed all 11 jobs: Node 20, 22 and 24 on Linux,
  macOS and Windows, plus package-surface/audit and documentation gates.
- The release head verified during closure was
  `a0f48de3b3bcad160ca5e7a4bac963e8e64bb4ac`.

### Liatir boundary at P4 extraction closure (historical snapshot)

Commit `6b4934e` removed the temporary full `scrollcase` tree from `liatir-stack`; the
standalone repository is now the only Scrollcase source tree. Liatir deliberately retained
the consumer-side pieces that never belonged to the tool: Runtime Box CI and runner policy,
model recipes and scientific validators, R2/Registry publication, KMS signer deployment and
key custody, the Rust/Tauri installer, Jobs/Results/provenance integration, and production
trust roots.

At P4 closure, the root `runtime-box*` scripts still invoked Liatir's local
builder, `@liatir/core` did not yet depend on `scrollcase`, and the local
box-format contract remained in place. That paragraph is no longer the current
P5 state; it records why downstream adoption remained necessary.

### Current downstream boundary

Liatir now consumes the exact published package for the generic contract.
The P5.2 checkpoint also routes generic pixi commands through the
installed package and keeps signer adaptation, CI/evidence and distribution in
Liatir. Nine uv recipes still require the explicit compatibility builder.
Geneformer and UCE still need pixi recipes before Scrollcase can build them.
These are Liatir adoption and model-migration tasks, not missing pieces of the
independent tool.

## P5 acceptance summary

The detailed phase gates, recipe inventory, CUDA identity migration, stop conditions and
rollback are maintained in
[Scrollcase P5 — Liatir adoption](./scrollcase-p5-liatir-adoption.md). This section remains
only the extraction-level completion summary.

- **scrollcase standalone:** `npm test` green in the new repo; a full
  `scrollcase init` → `build <installer-fixture>` → `verify` cycle passes on a clean machine with only
  Node installed (proves the bootstrap story). Local `keygen` → sign → `verify` round-trips.
- **Contract parity:** the target-id contract test passes against scrollcase's published fixtures in all
  three surfaces (JS reference, `liatir-core` TS, Rust mirror).
- **Liatir regression:** `npm run test:verify`, `cargo test runtime_box`, catalog check, and `lint:ts`
  clean after repointing to the dependency (commands are authoritative in `package.json` / `Cargo.toml`
  — read them at execution time, do not hardcode).
- **No consumer change needed for weights default** — `embed` keeps current box output byte-compatible;
  verify a rebuilt `installer-fixture` box against the existing Rust install path.
