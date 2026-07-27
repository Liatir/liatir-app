# Scrollcase P5 — Liatir adoption and legacy builder retirement

Last reviewed: 2026-07-27

Status: **in progress — P5.0 through P5.2 complete; stopped before P5.3**

This is the canonical execution plan for **Scrollcase extraction phase P5**. P1–P4
are complete: Scrollcase is an independent Apache-2.0 project and
`scrollcase@0.1.2` is public on npm. P5 is downstream Liatir work: consume that
published tool without weakening the existing Runtime Box product, trust,
distribution, scientific-validation, or evidence contracts.

This plan does not authorize implementation, a remote runner, a protected release,
publication, promotion, or deployment. Each remote/native allocation and every
protected release still requires its own explicit approval with the exact target,
runner, timeout, cost, expected evidence, stop condition, and cleanup.

## Outcome

P5 is complete only when all of the following are true:

1. Liatir installs an exact published Scrollcase version through npm; no build or
   test resolves Scrollcase from a sibling checkout, unpublished path, vendored
   copy, or deep import outside its `exports` map.
2. Scrollcase is the source of truth for the generic box-format contract, target
   identity rules, schemas, fixtures, build, audit, signing envelope, and verify
   implementation.
3. `packages/liatir-core` imports or refines the published contract rather than
   hand-writing a second generic type layer. Liatir-specific activation, catalog,
   CI, evidence, product compatibility, and support types remain in Liatir.
4. Every new document built by Liatir keeps the frozen
   `liatir.runtime-box` namespace and schema version 1. Existing signed documents,
   installed boxes, target IDs, trust roots, and public object paths remain valid.
5. Liatir supplies its private KMS signer through Scrollcase's external-signer
   boundary. The package never learns about Cloud Run, GCP, OIDC, R2, Liatir
   credentials, or Liatir policy.
6. Every active build recipe uses pixi + conda-pack + conda-forge. The current nine
   uv recipes are either migrated, or a legacy target is formally frozen through
   an approved compatibility mechanism; the generic uv builder is not silently
   retained.
7. Runtime Box CI, runner allocation, model-specific scientific validators,
   evidence, Registry/R2 distribution, promotion/revocation, the Rust/Tauri
   consumer, Jobs, Results, provenance, and trust roots remain owned by Liatir.
8. The old generic builder and duplicated generic modules are removed only after
   all callers are green on the published package. The stable
   `npm run runtime-box -- ...` operator surface may remain as a thin Liatir
   orchestration/distribution CLI.
9. Cheap gates, contract parity, native consumer tests, and one complete
   non-production product lifecycle prove the cutover. No support or publication
   claim is made from build-only evidence.

## Non-goals

- P5 does not publish or promote a new Runtime Box.
- P5 does not deploy the signer or Registry.
- P5 does not add a model family, enable on-demand weights in the product, or
  change Jobs/Results UX.
- P5 does not rename a target ID, replace a trust root, rewrite an existing signed
  document, or overwrite immutable R2 bytes.
- P5 does not move Liatir CI, model recipes, validators, evidence, distribution, or
  key custody into Scrollcase.
- P5 does not require the optional Scrollcase `--global` toolchain mode.

## Current state at the P5 boundary

### Package and contract

- Published package: `scrollcase@0.1.2`. Version `0.1.1` added the public
  TypeScript declarations required by the P5.0 preflight; `0.1.2` adds the
  browser-safe generic contract helpers required by Liatir's frontend build.
- Public entry points:
  - `scrollcase/contract`;
  - `scrollcase/contract/browser`;
  - `scrollcase/contract/types`;
  - `scrollcase/contract/schema/*.json`;
  - `scrollcase/contract/fixtures/*.json`;
  - `scrollcase/build`;
  - `scrollcase/sign`;
  - the `scrollcase` executable.
- `packages/liatir-core/src/runtime-box.ts` aliases/refines Scrollcase's generic
  wire types and retains the Liatir-specific product/CI types.
- TypeScript target identity delegates to Scrollcase. The Node legacy builder,
  signer, Registry Worker, and Rust mirrors remain checked against
  `runtime-boxes/target-id-contract.json` as a tracked compatibility fixture.
- `scrollcase.config.json` has no stale local `$schema` hint; Scrollcase's
  fail-closed parser remains authoritative until it publishes a config schema.

### Builder and orchestration

`scripts/runtime-box.mjs` currently combines two different responsibilities:

- generic builder commands: `keygen`, `lock`, `build`, `verify`;
- Liatir distribution commands: `publish`, `promote`, `revoke`, `serve`.

The second group stays in Liatir. Scrollcase deliberately has no distribution
verbs. `scripts/runtime-box-ci.mjs`, the validation/release workflows, and the
product-lifecycle launcher also rely on Liatir-only flags and receipts:

- private signer URL and audience;
- `.runtime-box-ci` verification/build/publication receipts;
- R2/Registry inputs;
- local candidate Registry serving;
- evidence and heartbeat integration.

These are adapter/orchestration requirements, not reasons to copy the builder.

### Recipe inventory

Five scGPT recipes are already pixi recipes:

- `scgpt-whole-human-macos-arm64-metal`;
- `scgpt-whole-human-linux-x86_64-cpu`;
- `scgpt-whole-human-linux-x86_64-cuda12.9`;
- `scgpt-whole-human-windows-x86_64-cpu`;
- `scgpt-whole-human-windows-x86_64-cuda12.8`.

Nine recipes still use uv and block complete builder retirement:

| Group | Recipe | Current target state |
| --- | --- | --- |
| Fixture | `installer-fixture-macos-arm64` | Foundation fixture |
| Fixture | `installer-fixture-linux-x86_64` | Foundation fixture |
| Fixture | `installer-fixture-windows-x86_64` | Foundation fixture |
| Geneformer | `geneformer-v1-10m-macos-arm64-metal` | Published |
| Geneformer | `geneformer-v1-10m-linux-x86_64-cpu` | Published |
| Geneformer | `geneformer-v1-10m-linux-x86_64-cuda12.4` | Published legacy CUDA target |
| Geneformer | `geneformer-v1-10m-windows-x86_64-cpu` | Published |
| Geneformer | `geneformer-v1-10m-windows-x86_64-cuda12.4` | Buildable; do not dispatch under the current rule |
| UCE | `uce-4layer-macos-arm64-metal` | Published; large/heavy |

The Geneformer CUDA recipes need special treatment. The conda-forge substrate
selected by the pixi migration is CUDA 12.9 on Linux and CUDA 12.8 on Windows.
Changing a tracked `cuda12.4` target ID in place would break identity and existing
publication evidence. A successor target must be additive; the existing target is
preserved as a historical/installed compatibility identity.

## Target architecture

| Concern | Owner after P5 | Boundary |
| --- | --- | --- |
| Box schemas, generated types, target rules and golden fixtures | Scrollcase | Consumed only through published exports |
| Lock, licence audit, deterministic build, local/external signing, verify | Scrollcase | pixi + conda-pack only |
| Liatir type names and product refinements | `packages/liatir-core` | Thin aliases/refinements over Scrollcase generic types |
| Runtime Box catalog, runner policy, evidence and scientific validators | Liatir | Never imported into Scrollcase |
| KMS/OIDC HTTP invocation | Liatir signer-command adapter | Payload on stdin, signed envelope on stdout |
| R2 upload, Registry, channel promotion, revocation and candidate serving | Liatir distribution CLI | Operates on Scrollcase-produced documents |
| Installation, anti-replay, activation, rollback/removal, Jobs/Results/provenance | Rust/Tauri + frontend | Wire-compatible consumer; no Scrollcase runtime dependency |
| Model source/assets and recipes | Liatir | Project-owned scientific and legal inputs |

The desktop app remains offline-capable. Scrollcase is a build-time dependency,
never a dependency of installing or running an already downloaded Runtime Box.

## Execution ledger

| Phase | State | Exit evidence |
| --- | --- | --- |
| P5.0 — published-package/API preflight | Complete | Exact public `scrollcase@0.1.2`; clean install and package/API probes green |
| P5.1 — contract inversion | Complete | Core, Node, Worker, signer, Rust and frontend production build agree |
| P5.2 — Liatir adapter and distribution split | Complete | Stable adapter routes pixi work to Scrollcase and keeps distribution in Liatir |
| P5.3 — fixture migration | Pending | Three pixi fixtures; foundation gates green |
| P5.4 — model-recipe migration | Pending | Geneformer/UCE active recipes no longer require uv |
| P5.5 — final cutover and legacy deletion | Pending | No generic local builder caller or active uv recipe remains |
| P5.6 — local/native closure | Pending | Full cheap gate plus one reviewed non-production product lifecycle |
| P5.7 — documentation handoff | Pending | Status, inventories and operator docs match the implemented boundary |

Mark a phase complete only from its listed evidence. Do not infer completion from
the next phase starting.

## P5.0 — Published-package and API preflight

### Purpose

Prove that the selected published Scrollcase version is sufficient for Liatir
before changing a contract or deleting code. The sibling checkout is useful for
reading history, but it is not an acceptable dependency or test input.

### Work

1. Add the exact Scrollcase version to the root dependency graph and to
   `packages/liatir-core` where the contract dependency semantically belongs.
   This is a dependency task, so the root lockfile is expected to change.
2. From a clean install, verify the package name, version, executable and every
   required export. Add a package-surface regression so an unpublished deep import
   cannot enter later.
3. Compile a minimal TypeScript consumer of:
   - runtime helpers from `scrollcase/contract`;
   - generated types from `scrollcase/contract/types`;
   - schema/fixture resolution;
   - signing helpers from `scrollcase/sign`;
   - build primitives from `scrollcase/build`.
4. Inventory every generic symbol currently imported from
   `scripts/runtime-box/{archive,filesystem,identity,licenses,pixi,targets,workspace}.mjs`
   and map it to a public Scrollcase export.
5. Exercise the installed CLI with `help`, workspace discovery, and a no-network
   `doctor`/validation path against Liatir's `scrollcase.config.json`.
6. Decide the stable programmatic boundary:
   - preferred: public high-level APIs when the published export supplies them;
   - otherwise: the published CLI, wrapped by Liatir for receipts and signer
     translation.
7. Resolve the configuration schema reference. Do not leave
   `scrollcase.config.json` pointing at a file deleted later. Use an official
   published schema only if Scrollcase exports one; otherwise remove the editor
   hint and rely on the package's fail-closed config parser until an official
   schema is published.

### Known preflight questions

- `scrollcase/contract/types` is a declared types-only export; runtime helpers are
  under `scrollcase/contract`. Verify that TypeScript can type the runtime import
  under Liatir's `moduleResolution` settings.
- The source repository contains high-level `buildBox` and `verifyBox` functions,
  but `scrollcase@0.1.0` must be judged only by its published `exports` map. Do not
  deep-import those source files.
- The Scrollcase CLI correctly does not understand Liatir's signer URL, audience,
  receipt, publish, promote, revoke, or serve flags. P5.2 supplies those
  consumer-side adapters.

### Stop rule

If a required generic capability cannot be reached through the published package:

1. stop the Liatir cutover;
2. add the smallest vendor-neutral public API or declaration in the Scrollcase
   repository with its own tests/docs/changelog;
3. ask the maintainer to publish a new Scrollcase version;
4. pin that new immutable version in this plan before resuming.

Never work around a missing export with a deep import, sibling path, copied module,
postinstall patch, or `any` declaration. Only the maintainer may run `npm publish`.

### Exit gate

- clean dependency install succeeds;
- package-surface and TypeScript probes pass;
- every required generic symbol has an owned destination;
- no Liatir source imports the sibling checkout;
- the selected exact Scrollcase version is recorded here before P5.1 begins.

### P5.0 execution record — complete

The first strict consumer probe correctly stopped on `scrollcase@0.1.0`: the
runtime exports existed, but the published tarball did not expose TypeScript
declarations for `scrollcase/contract`, `scrollcase/build`, or `scrollcase/sign`.
The fix was made upstream without any Liatir behavior or vocabulary:

- upstream commit `ed5d1983f7df91afeb3ccd8118da20707be84430`;
- published package `scrollcase@0.1.1`;
- npm SHA-1 `f4b352d95637da674d9e9df0a5696ca6605f3171`;
- npm integrity
  `sha512-HmqKS3r7UnAEZXQEXGMSeJgUtaWLINe7aEnTorC43fhLhmIBWtm8qts9EfOlvU9CIHRrFH7lrVr5flZQfHpYyQ==`.

Liatir pins `0.1.2` in the root graph and `@liatir/core`. The package regression
checks the exact package name, version, executable, export map, tarball identity,
strict TypeScript declarations, runtime imports, schemas, fixtures, CLI discovery,
and rejection of unpublished deep/sibling/file imports. The invalid local
configuration `$schema` hint was removed because Scrollcase does not publish a
configuration schema. The fail-closed parser remains the authority.

The stable P5.0 boundary is the published CLI for high-level `lock`, `build`, and
`verify`, with public primitives used where exported. P5.2 will wrap that CLI for
Liatir receipts, distribution, and signer translation. It must not deep-import the
high-level functions that are intentionally outside the package export map.

The later `npm run test:verify` frontend build exposed one additional public
surface requirement: `scrollcase/contract` also exports the Node-only payload
decoder and therefore loads `node:crypto`, even when a browser consumer needs only
target identity and the envelope shape guard. The vendor-neutral correction was
published from Scrollcase `main` commit
`6044714b3b66487ae8d39bead9812106c44248f2` as version `0.1.2`:

- new public `scrollcase/contract/browser` export;
- shared target, document-name, constant, and envelope-shape helpers;
- no Node built-in anywhere in that entry point's complete module graph;
- generated declarations, strict TypeScript consumer, 113 tests, docs build,
  tarball inspection, and a real esbuild browser bundle are green;
- no Liatir reference or behavior was added.

The maintainer explicitly authorized publication on 2026-07-27. The public npm
record was read back after registry propagation:

- npm SHA-1 `208c9ff16266695951f16132a778013536c81678`;
- npm integrity
  `sha512-dIA7dOPLOLMGuMHNAVE/Ov0gGWT5GtYzEN+mJYERre7VniNQKiUV0I4LqQF9G1py7q5gfahqf4q//kU4mw88LQ==`;
- clean `npm ci`, exact package/export/CLI checks, and the strict TypeScript
  consumer pass from the registry tarball.

Generic-module inventory:

| Local module/symbol group | Published destination after cutover |
| --- | --- |
| `archive`: deterministic zip, list, extract | `scrollcase/build`: `createDeterministicZip`, `listZipEntries`, `extractZipArchive` |
| `archive`: recipe extraction and bounded entry reads | High-level published CLI owns build/verify; Liatir-native inspection retains only product-specific reads |
| `filesystem`: exists, collect, SHA-256 | `scrollcase/build`: `fileExists`, `collectFiles`, `sha256File` |
| `filesystem`: normalization, safe paths, payload sizing | High-level published CLI; no consumer deep import |
| `identity`: release stem, object prefix, builder fields | `scrollcase/build`: `boxReleaseStem`, `boxReleaseObjectPrefix`, `builderVersionFields` |
| `licenses`: conda lock parse/audit/validation | Matching `scrollcase/build` exports |
| `licenses`: uv lock/audit helpers | Legacy Liatir compatibility only until P5.3–P5.4 recipe migration; not a Scrollcase substrate |
| `pixi`: discovery, arguments, install/pack | Matching `scrollcase/build` exports |
| `targets`: ID, adapter(s), host, entry point, conda subdir, accelerator | Matching `scrollcase/contract` exports with the `box*` names |
| `targets`: uv lock and PyTorch-index arguments | Legacy Liatir compatibility only until uv recipes are migrated |
| `workspace`: discovery, resolution, configuration, overrides | Matching `scrollcase/build` exports; reset remains test-local |

## P5.1 — Contract inversion

### Type split

Refactor `packages/liatir-core/src/runtime-box.ts` into two explicit layers.

Generic wire shapes come from `scrollcase/contract/types`:

- target;
- provenance;
- archive and self-test;
- release;
- channel;
- revocations;
- signed envelope.

Liatir keeps thin refinements where its product contract is intentionally
stricter:

- `kind` literals remain exactly `liatir.runtime-box.release`,
  `.channel`, and `.revocations`;
- compatibility requires `minLiatirVersion` and retains Liatir host constraints;
- activation metadata and selected target;
- product catalog candidates;
- CI catalog, runner, status, evidence and publication types.

Use aliases/intersections/`Omit` refinements over Scrollcase types rather than
copying their fields. Preserve the existing exported Liatir names so frontend,
Worker and bridge call sites do not need a parallel migration.

### Runtime helpers and fixtures

1. Implement `runtimeBoxTargetId` as the Liatir-named export of Scrollcase's
   runtime target helper. Do not keep the local algorithm in TypeScript.
2. Implement the signed-envelope guard through the Scrollcase document helper,
   with a Liatir type refinement where required.
3. Read the published `target-id-contract` fixture through the package API.
4. Keep `runtime-boxes/target-id-contract.json` as a tracked compatibility
   boundary because existing CI and machines depend on that path, but add an
   exact drift check against the package fixture. Do not hand-edit or silently
   remove it.
5. Continue validating the signer, Registry Worker and Rust mirrors against the
   same cases. Other languages may mirror the rule; JavaScript/TypeScript should
   consume the reference implementation.
6. Validate the real Liatir release/channel/revocation fixtures against the
   published Scrollcase schemas while preserving the Liatir namespace and
   compatibility extension fields.
7. Regenerate SDK-derived artifacts through `npm run gen:sdk-types`; never edit
   them directly. Confirm the generator does not emit unresolved external type
   references into the browser/editor surface.

### Byte-compatibility gate

Create a deterministic synthetic Liatir fixture and assert:

- exact document kinds and schema version;
- exact payload encoding and signature algorithm;
- the same target ID and object stem;
- release/channel JSON shape accepted by the Rust consumer and Registry Worker;
- existing checked signed documents still decode and validate;
- no `scrollcase.box` kind is ever emitted by a Liatir build.

Any unexplained wire or payload difference stops P5. Do not update golden
fixtures to make a regression disappear.

### Exit gate

- `packages/liatir-core` builds from published Scrollcase types/helpers;
- generated SDK artifacts are current;
- core, Scrollcase reference, signer, Worker and Rust target cases agree;
- existing signed fixtures and installed-document readers remain compatible;
- Liatir-specific CI/product types remain local and DRY.

### P5.1 implementation record — complete

- `@liatir/core` now aliases/refines the published target, release, channel,
  revocation, provenance, archive, self-test, and signed-envelope types while
  retaining the exported `Liatir*` names.
- `liatir.runtime-box.*`, required `minLiatirVersion`, host-environment metadata,
  activation, catalog, CI, evidence, and publication contracts remain Liatir-owned.
- New Scrollcase/pixi provenance uses the published type. The explicit uv union is
  read compatibility for already-issued boxes only; it does not make uv a
  Scrollcase build substrate.
- TypeScript target IDs and signed-envelope shape checks delegate to the published
  runtime helpers. The tracked target fixture must exactly equal the package
  fixture, while the signer, Worker, local legacy CLI mirror, and Rust keep running
  the same valid and invalid cases.
- `runtime-boxes/contract-compatibility-fixtures.json` fixes representative Liatir
  release, legacy-uv release, channel, and revocation payloads. Published schemas,
  exact pretty-JSON payload bytes, base64 encoding, Ed25519 envelope, target ID,
  object stem/prefix, Worker route checks, signature verification, and Rust
  deserialization are covered.
- `npm run gen:sdk-types` is current and the regression confirms no external
  Scrollcase name/reference leaks into the browser/editor SDK artifact.

The published `0.1.2` pin and `scrollcase/contract/browser` runtime import made
`npm run test:verify` green on 2026-07-27: 201 unit/contract tests, SDK generation,
core build, zero-error Svelte check, frontend production build, and root TypeScript
compile passed. The targeted Rust compatibility-fixture test also passed.

No recipe, builder caller, distribution command, signer adapter, release, runner,
promotion, or trust root was changed at this checkpoint.

## P5.2 — Liatir adapter and distribution split

### Stable operator surface

Keep `npm run runtime-box -- ...` as the stable Liatir-facing command, but make
`scripts/runtime-box.mjs` a thin dispatcher instead of a builder implementation.

| Command | Implementation after P5 |
| --- | --- |
| `keygen` | Scrollcase |
| `lock` | Scrollcase |
| `build` | Scrollcase with forced Liatir namespace and signer adapter |
| `verify` | Scrollcase plus Liatir evidence receipt |
| `publish` | Liatir |
| `promote` | Liatir |
| `revoke` | Liatir distribution logic using the shared signing envelope |
| `serve` | Liatir local candidate Registry |

Recommended module split:

- `scripts/runtime-box.mjs` — argument dispatch only;
- `scripts/runtime-box/scrollcase-adapter.mjs` — published CLI/API invocation,
  namespace enforcement and receipt composition;
- `scripts/runtime-box/signer-command.mjs` — private signer adapter;
- `scripts/runtime-box/distribution.mjs` — R2/Registry publish, promote, revoke,
  serve and multipart logic;
- existing `evidence.mjs`, `heartbeat.mjs`, and `validator-context.mjs` —
  Liatir-owned and retained.

Exact names may change if the existing module layout yields a smaller coherent
split, but the ownership boundary may not.

### Namespace and signing

1. Every build invocation injects `--namespace liatir.runtime-box`; a conflicting
   caller override fails rather than emitting another namespace.
2. Development builds use Scrollcase's local key path under the existing
   consumer-owned workspace.
3. Protected builds use a Liatir signer-command adapter:
   - payload bytes arrive on stdin;
   - the adapter obtains the existing short-lived OIDC identity token or the
     explicitly supported manual `gcloud` token;
   - it calls the private Cloud Run signer;
   - it writes only the signed JSON document to stdout;
   - diagnostics go to stderr and never expose credentials;
   - Scrollcase verifies that the returned envelope contains the exact payload
     and a locally valid signature.
4. Keep signer policy verification before any native paid/remote build. Do not
   grant direct KMS access to the release identity.
5. Revocation remains a Liatir distribution action, but it must use the shared
   Scrollcase envelope/signing primitives rather than another local signature
   implementation when the public package surface permits it.

### Receipts and evidence

Scrollcase owns verification; Liatir owns CI evidence. The adapter writes the
existing compact receipt only after Scrollcase returns success:

- `status`;
- `localSignatureVerified`;
- signing key IDs;
- release payload SHA-256;
- archive SHA-256 and size;
- self-test status.

The evidence layer continues to bind that receipt to the checked recipe, lock,
host probe, scientific validator and product lifecycle. Never infer a receipt
from file existence or console text alone.

### Workflow changes

- `runtime-box-ci.mjs tracked-build` must reach Scrollcase through the checked
  adapter and continue recording bounded metrics/heartbeat.
- Validation and release workflows keep their current ordering:
  resolve → host probe → build → verify → scientific validation → optional
  publication/product lifecycle/evidence.
- Path filters watch the pinned dependency/lockfile and Liatir adapter files, not
  the external Scrollcase repository.
- Windows command invocation remains shell-free and must preserve quoted signer
  command arguments.

### Exit gate

- the synthetic pixi fixture completes keygen/build/verify through the stable
  Liatir command;
- local and external signer paths are covered, including payload substitution,
  invalid signature, malformed JSON, non-zero exit and quoted Windows paths;
- verification receipts feed the current evidence builder;
- publish/promote/revoke/serve tests remain Liatir-owned and green;
- no distribution or credential knowledge enters Scrollcase.

### P5.2 implementation record — complete

The stable `npm run runtime-box -- ...` surface now enters the thin
`scripts/runtime-box.mjs` dispatcher. `scripts/runtime-box/scrollcase-adapter.mjs`
resolves the executable declared by the exact installed `scrollcase@0.1.2`
package through a public ESM export, invokes it through the current Node
executable without a shell, forces `liatir.runtime-box` exactly once, and writes
the existing compact verification receipt only after Scrollcase succeeds and
the signed payload, archive size and archive SHA-256 have been checked locally.

`scripts/runtime-box/signer-command.mjs` is the Liatir-private external signer
adapter. It receives the exact payload bytes on stdin, obtains either the
explicit short-lived token or a shell-free audience-bound `gcloud` token, calls
the private `/v1/sign` endpoint, emits only the returned JSON document on stdout,
and does not echo credentials or private service bodies in diagnostics.
Scrollcase remains responsible for rejecting payload substitution, invalid
signatures, malformed JSON and non-zero signer exits. Liatir revocation now uses
the public Scrollcase signing envelope rather than a second local implementation.

Distribution remains entirely Liatir-owned. The temporary
`scripts/runtime-box/legacy-cli.mjs` contains the nine-recipe uv compatibility
builder plus the existing publish, publish-key, promote, revoke and serve
implementation until P5.3/P5.4 migrate those recipes and P5.5 removes the generic
legacy builder. The stable dispatcher routes those command sets explicitly and
the legacy module fails closed if called directly for pixi lock/build, so a pixi
recipe cannot bypass Scrollcase. This is a visible migration boundary, not a
silent fallback.

`runtime-box-ci.mjs tracked-build` still enters through the stable npm command and
therefore reaches the adapter while preserving the existing heartbeat and metric
wrapper. Foundation, scGPT, Geneformer and UCE workflow path filters now watch the
root package manifest, lockfile, stable CLI and adapter modules. The package bin,
npm, heartbeat and signer invocations remain shell-free on Windows and preserve
quoted arguments.

The synthetic adapter fixture exercises real key generation through the installed
published CLI, pixi build routing with the frozen namespace, verification and
receipt composition, local shared-envelope signing, all Liatir distribution
routes, and the temporary uv branch. Native box construction is deliberately
deferred to the one-target-at-a-time P5.3/P5.4 gates; P5.2 did not download a
toolchain or model, allocate a runner, publish, promote, deploy, or change a trust
root.

Evidence on 2026-07-27:

- `npm run test:unit`: 35 files and 218 tests passed;
- `npm run test:verify`: unit/contract tests, SDK generation, core build,
  zero-error Svelte check, frontend production build and root TypeScript compile
  passed;
- `npm run runtime-box:test:foundation`: TAR safety, deterministic Zip64 and the
  Rust large-archive compatibility fixture passed;
- targeted adapter, signer, receipt, publisher, deployment, CI path-filter and
  Windows invocation regressions passed.

Execution stops here before P5.3.

## P5.3 — Migrate the three foundation fixtures

Migrate the cheapest native artifacts before model recipes:

1. macOS fixture;
2. Linux fixture;
3. Windows fixture.

For each fixture, one at a time:

1. create a single-platform `pixi.toml`;
2. generate and review `pixi.lock` with the exact pinned pixi version;
3. add a lock-derived conda licence audit where the foundation contract requires
   it;
4. update recipe provenance fields and remove uv-only fields/files;
5. update catalog lock hash and disk plan from measured output;
6. refactor `validate-runtime-box-native-fixture.mjs` so it validates the
   Scrollcase/pixi layout rather than standalone-Python/uv assumptions;
7. run build, verify, Rust archive fixture and activation/rollback/removal checks
   on the matching native host;
8. clean only generated fixture build state.

Locks may be resolved without dispatch where pixi supports the target platform,
but a cross-resolved lock is not native self-test evidence. Linux/Windows native
execution still requires a separately approved runner/session.

### Exit gate

- all three fixture recipes are pixi-only;
- foundation validation imports generic helpers from the package;
- `npm run runtime-box:test:foundation`, the relevant Rust tests, catalog check
  and unit group pass;
- no foundation workflow invokes `--uv` or expects a requirements lock.

## P5.4 — Migrate active model recipes

Use the model ordering from the pixi migration, with one target in flight:

1. Geneformer macOS Metal;
2. Geneformer Linux CPU;
3. Geneformer Windows CPU;
4. UCE macOS Metal;
5. Geneformer Linux CUDA successor;
6. Geneformer Windows CUDA successor only when its no-dispatch rule is lifted.

The lighter CPU/Metal Geneformer targets establish the public Scrollcase path
before the large UCE and CUDA builds.

### Repeated recipe gate

For every target:

1. preserve model/source/asset hashes, legal record, box ID and runtime ID;
2. create the exact single-target pixi manifest and committed lock;
3. verify packages, channels, source-build absence and native-library closure;
4. generate and review the conda licence audit;
5. update `pythonVersion` to the interpreter actually installed;
6. remove `uvVersion`, `requirementsInput`, `requirementsLock` and their files;
7. update catalog dependency hash, audit path and measured disk plan;
8. preserve `minLiatirVersion`, namespace and product-owned compatibility fields;
9. build through the published package on the matching native host;
10. pass self-test, model scientific validator, Jobs/Results/provenance and
    removal/rollback as required by the target's validation mode;
11. retain compact evidence and update the roadmap before another target starts.

### Immutable-version rule

Published uv boxes cannot be rebuilt as different pixi bytes under the same
release version. Before any protected publication, select a new version and
prove that its immutable object keys do not collide. P5 may validate a candidate
locally, but it must not upload or promote it.

The same rule applies to the published scGPT macOS pilot: its current pixi recipe
must receive a new release version before any future pixi publication replaces
the uv-built beta in the channel.

### Geneformer CUDA identity migration

Never mutate these identities in place:

- published `linux-x86_64-cuda12.4`;
- buildable `windows-x86_64-cuda12.4`.

Recommended migration:

1. preserve the old target records, evidence and public objects as frozen legacy
   compatibility;
2. add new recipes/records for `linux-x86_64-cuda12.9` and
   `windows-x86_64-cuda12.8`;
3. add an explicit catalog status/field for a frozen historical target if the
   current schema cannot represent “still installable but no longer buildable”;
4. keep installed-client support and signed old channels honest;
5. expose a successor target to new clients only after its own scientific,
   native-lifecycle and protected-release evidence.

This is a breaking catalog evolution and requires a specific maintainer decision
before implementation. The fallback is to retain a narrow legacy builder for
those recipes, in which case P5 remains incomplete; silently relabelling CUDA
12.9/12.8 bytes as CUDA 12.4 is forbidden.

### UCE capacity rule

UCE is a multi-gigabyte build. Before running it:

- confirm free disk against the current measured plan plus rollback margin;
- state whether weights/toolchain caches already exist;
- state timeout and cleanup;
- obtain approval for the heavy local or remote execution;
- stop after one failure and diagnose locally from exact logs before retrying.

### Exit gate

- no active non-legacy model recipe requires uv;
- each migrated target has reviewed lock/audit and native scientific evidence;
- legacy CUDA identity is represented honestly;
- no target is marked published from P5 validation alone.

## P5.5 — Final cutover and legacy deletion

Only begin after P5.0–P5.4 are green.

### Delete or replace the generic copies

Replace consumers with package exports, then remove the superseded generic
implementations:

- archive and filesystem primitives;
- target/identity reference implementation;
- pixi/conda-pack builder helpers;
- generic licence audit;
- generic workspace resolver;
- standalone-Python/uv builder code;
- local Scrollcase config schema;
- local build/lock/keygen/verify implementation.

Candidate files are currently under `scripts/runtime-box/`, but delete a file
only after `rg` proves no Liatir-specific behavior remains inside it.

Keep and organize the Liatir-owned code:

- CI catalog/host/cost/evidence orchestration;
- heartbeat and validator context;
- model validators;
- signer-command adapter and signer policy verification;
- R2/Registry distribution, candidate serving, promotion and revocation;
- product lifecycle;
- Rust/Tauri consumer and trust roots.

`scripts/runtime-box.mjs` may remain as the small product-facing dispatcher. P5
retires the **builder implementation**, not the Runtime Box product vocabulary or
operator command.

### Static deletion guards

Add checks proving:

- no active recipe declares `uvVersion`, `requirementsInput` or
  `requirementsLock`;
- no build/CI path imports deleted generic modules;
- no Liatir source deep-imports `scrollcase/src/...`;
- no sibling checkout path or `file:` dependency exists;
- no Liatir build emits the default `scrollcase.box` namespace;
- no generated binding was edited by hand;
- the package fixture and tracked compatibility fixture are identical.

### Exit gate

- a clean checkout installs and builds with no local generic builder;
- all root Runtime Box scripts resolve to either the published package or
  Liatir-owned orchestration;
- unit, catalog, signer, Rust and TypeScript gates pass after deletion;
- the diff contains no trust-root, secret, generated build output or unrelated
  cleanup.

## P5.6 — Verification and closure

### Cheap gate after every slice

Use the commands present in the checkout at execution time:

```text
git diff --check
npm run test:unit
npm run runtime-box:catalog:check
npm run runtime-box:test:foundation
npm run runtime-box:signer:check
npm run gen:sdk-types
npm run test:verify
npm run lint:ts
```

Run the relevant focused unit files before the full gate:

- contract/target identity;
- workspace/package surface;
- target adapters;
- conda licences;
- catalog and evidence;
- publisher/distribution;
- signer deployment/policy drift;
- Windows command invocation.

For Rust consumer or signed-wire changes:

```text
cd src-tauri
cargo test runtime_box
cargo clippy
```

When workflows change, run the repository's workflow validation/actionlint gate.
When tracked knowledge changes, run `npm run docs:internal:build`.

### Native acceptance

Before declaring P5 complete, run one reviewed non-production lifecycle on a
Scrollcase-built candidate:

```text
install -> self-test -> real inference -> Job -> Result -> provenance ->
replacement/rollback -> removal -> Result survival -> cleanup
```

Prefer the smallest representative target whose recipe and runner are already
approved. This is not a protected release and must not publish or promote.

Additional native target runs belong to the per-target recipe migration and keep
their explicit approval boundary.

### Fresh-checkout acceptance

From a clean checkout with no generated Runtime Box output:

- install dependencies from the committed lockfile;
- build `@liatir/core`;
- resolve the Scrollcase binary and public exports;
- run the synthetic fixture;
- prove no sibling repository, global npm package, warm build tree, or untracked
  key is required.

### Closure evidence

Record:

- exact Scrollcase package version and lockfile integrity;
- contract/fixture parity result;
- recipe inventory at zero active uv entries;
- deleted-versus-retained module inventory;
- cheap-gate counts;
- Rust result;
- native lifecycle report;
- generated-state cleanup;
- explicit statement that no protected release/publication occurred.

## P5.7 — Documentation and handoff

Update together:

- this plan and execution ledger;
- `project-knowledge-base/current-project-status.md`;
- `project-knowledge-base/roadmap/scrollcase-extraction-plan.md`;
- `project-knowledge-base/roadmap/runtime-box-pixi-migration.md`;
- Runtime Box production/operator documentation if commands changed;
- `AGENTS.md` only if repository commands or boundaries changed.

The final handoff must state separately:

- Scrollcase extraction status;
- Liatir adoption status;
- model/target validation status;
- protected publication status.

Do not collapse “uses Scrollcase”, “scientifically validated”, and “published”
into one readiness claim.

## Rollback and cleanup

- Implement P5.0–P5.4 in small commits while the old builder still exists, so a
  failed slice can revert to the previous local path without touching installed
  boxes or public state.
- Do not delete the legacy builder in the same change that first exercises the
  Scrollcase path.
- Recipe migrations are target-specific. Revert only the target in flight; never
  roll back already reviewed independent targets.
- Keep old published versions and signed objects immutable. A failed candidate is
  cleaned locally; it does not replace the current channel.
- Clean only known generated directories:
  `.runtime-box-build`, `.runtime-box-dist`, `.runtime-box-local`,
  `.runtime-box-ci`, and configured Scrollcase generated state. Never clean a
  broad workspace or user directory.
- Private keys, trust roots, credentials and signer policy are never recreated as
  rollback.

## Stop conditions

Stop and report evidence when any of these occurs:

1. `scrollcase@0.1.0` lacks a required public export or usable declaration.
2. A Liatir build would require a deep import, copied Scrollcase code, sibling
   checkout, global install, or `any` contract shim.
3. A wire fixture, namespace, target ID, payload encoding, signature, archive
   layout or Rust consumer result changes unexpectedly.
4. A recipe needs source builds, has an incomplete licence audit, changes a model
   asset hash without review, or cannot self-test natively.
5. A CUDA successor would overwrite or rename a 12.4 identity.
6. Any active uv recipe or caller remains when deletion begins.
7. A heavy model build, remote runner, paid resource, deployment, protected
   release, publication or promotion becomes necessary without specific approval.
8. A failed protected or native run lacks its exact underlying log.
9. User-owned work overlaps a required file and cannot be preserved safely.

After a new defect: record the symptom, root cause, regression, retry limit,
cheap rechecks and cleanup before another expensive attempt.

## Maintainer decisions still required during execution

The initial P5 go-ahead authorizes local implementation and cheap verification
only. Pause later for:

1. any upstream Scrollcase patch and new npm publication;
2. the Geneformer CUDA legacy/successor catalog design;
3. each Linux/Windows/native or heavy UCE allocation;
4. any protected signer deploy or release;
5. final deletion if the active-recipe/caller inventory is not exactly zero.
