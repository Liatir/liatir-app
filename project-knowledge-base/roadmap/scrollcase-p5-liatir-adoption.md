# Scrollcase P5 — Liatir adoption and legacy builder retirement

Last reviewed: 2026-07-30

Status: **in progress — P5.2V complete; P5.3 macOS complete, Linux and
Windows native proofs pending**

This is the canonical execution plan for **Scrollcase extraction phase P5**. P1–P4
are complete: Scrollcase is an independent Apache-2.0 project. The selected P5
target is exact `scrollcase@0.4.11`, whose published tarball contains the v2-only
contract. The checkout now pins `0.4.11` exactly and consumes it only through
its published package surface. P5 is downstream Liatir work: consume Scrollcase
without weakening the existing Runtime Box
product, trust, distribution, scientific-validation, or evidence contracts.
Schema v1 is fully deprecated and is not part of the target Liatir architecture.

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
4. Every supported Liatir Runtime Box document, build, signer, Registry response
   and product consumer uses Scrollcase schema v2 while keeping the frozen
   `liatir.runtime-box` namespace and canonical target IDs. Schema-v1 objects
   remain immutable historical bytes, but new Liatir rejects them as unsupported
   rather than maintaining a second reader or silently converting them.
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
9. Cheap gates, v2 contract parity, explicit v1-rejection regressions, native
   consumer tests, migration cleanup for already installed v1 state, and one
   complete non-production v2 product lifecycle prove the cutover. No support or
   publication claim is made from build-only evidence.

## Non-goals

- P5 does not publish or promote a new Runtime Box.
- P5 does not deploy the signer or Registry.
- P5 does not add a model family, enable on-demand weights in the product, or
  change Jobs/Results UX.
- P5 does not rename a target ID, replace a trust root, rewrite an existing signed
  document, or overwrite immutable R2 bytes.
- P5 does not preserve schema-v1 Runtime Box support. Historical v1 objects stay
  immutable but are unsupported by the v2-only Liatir cutover.
- P5 does not move Liatir CI, model recipes, validators, evidence, distribution, or
  key custody into Scrollcase.
- P5 does not require the optional Scrollcase `--global` toolchain mode.

## Current state at the P5 boundary

### Package and contract

- Selected P5 target: exact `scrollcase@0.4.11`, read from npm on 2026-07-30.
  SHA-1:
  `7bb8364ff820dd44dc749e9ef28a6df9cc9808ac`. Integrity:
  `sha512-/BLoSjwN4rcKOx+gTtfb0tBrN4+hlsno3pIl4L/m1jHSHBGgM4qPA1GY7ns9BEK7Cj8nWfrqYqNDtz3FoZvCWw==`.
  Its published schemas require `schemaVersion: 2`; it uses `scroll.json` under
  `scrolls/<boxId>/<targetId>/`, adds `scrollcase/consumer` and `scrollcase run`,
  and does not accept schema-v1 authoring/wire documents.
- Historical pre-cutover pin: exact `scrollcase@0.1.3`. Version `0.1.1` added the public
  TypeScript declarations required by the P5.0 preflight; `0.1.2` adds the
  browser-safe generic contract helpers required by Liatir's frontend build;
  `0.1.3` safely unpacks legitimate conda symlink chains and removes
  machine-specific conda metadata from deterministic boxes.
- The `0.4.11` tarball's changelog describes the v2-only work under
  `Unreleased`, despite the package already shipping v2. Treat that
  package/documentation mismatch as an adoption preflight item; do not infer a
  release boundary from the repository or changelog.
- Public entry points:
  - `scrollcase/contract`;
  - `scrollcase/contract/browser`;
  - `scrollcase/contract/types`;
  - `scrollcase/contract/schema/*.json`;
  - `scrollcase/contract/fixtures/*.json`;
  - `scrollcase/build`;
  - `scrollcase/consumer`;
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

The v2-only P5.2V cutover keeps `scripts/runtime-box.mjs` as a small consumer-side
dispatcher. Generic `doctor`, `keygen`, `lock`, `audit`, `build` and `verify`
commands are routed to the executable declared by exact installed
`scrollcase@0.4.11`; Liatir distribution commands remain local. Schema-v1
authoring is rejected rather than routed to the file-local legacy builder. That
legacy implementation remains only as P5.4/P5.5 deletion inventory while the
frozen pre-v2 model inputs are migrated.

Scrollcase deliberately has no Liatir distribution verbs.
`scripts/runtime-box-ci.mjs`, the validation/release workflows, and the
product-lifecycle launcher rely on Liatir-only flags and receipts:

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
| V2 box schemas, generated types, target rules and golden fixtures | Scrollcase | Consumed only through published exports |
| Lock, licence audit, deterministic build, local/external signing, verify | Scrollcase | pixi + conda-pack only |
| Liatir type names and product refinements | `packages/liatir-core` | Thin aliases/refinements over Scrollcase generic types |
| Runtime Box catalog, runner policy, evidence and scientific validators | Liatir | Never imported into Scrollcase |
| KMS/OIDC HTTP invocation | Liatir signer-command adapter | Payload on stdin, signed envelope on stdout |
| R2 upload, Registry, channel promotion, revocation and candidate serving | Liatir distribution CLI | Operates on Scrollcase-produced documents |
| Installation, anti-replay, activation, rollback/removal, Jobs/Results/provenance | Rust/Tauri + frontend | V2-only consumer; schema v1 fails explicitly as unsupported |
| Model source/assets and recipes | Liatir | Project-owned scientific and legal inputs |

The desktop app remains offline-capable. Scrollcase is a build-time dependency,
never a dependency of installing or running an already downloaded Runtime Box.

## Execution ledger

| Phase | State | Exit evidence |
| --- | --- | --- |
| P5.0 — historical schema-v1 package/API preflight | Complete | Exact public `scrollcase@0.1.3`; clean install and package/API probes green |
| P5.1 — contract inversion | Complete | Core, Node, Worker, signer, Rust and frontend production build agree |
| P5.2 — Liatir adapter and distribution split | Complete | Real clean `keygen → lock → build → verify --self-test` cycle through the stable Liatir command; namespace, archive hash and receipts checked |
| P5.2V — Scrollcase v2-only cutover | Complete | Exact `scrollcase@0.4.11`; active contracts and consumers use v2; v1 is explicitly unsupported; clean local v2 proof green |
| P5.3 — v2 foundation-fixture migration | In progress | Three reviewed v2 scrolls/locks/audits; macOS native proof green; Linux and Windows native proofs pending |
| P5.4 — model-recipe migration | Pending | Every active model input is a v2 scroll; Geneformer/UCE no longer require uv |
| P5.5 — final cutover and legacy deletion | Pending | No generic local builder caller or active uv recipe remains |
| P5.6 — local/native closure | Pending | Full cheap gate plus one reviewed non-production product lifecycle |
| P5.7 — documentation handoff | Pending | Status, inventories and operator docs match the implemented boundary |

Mark a phase complete only from its listed evidence. Do not infer completion from
the next phase starting.

## P5.0 — Historical schema-v1 package/API preflight

### Purpose

This completed section records how `scrollcase@0.1.3` was proven before the v2
line existed. It is evidence and rollback history, not the package-selection
procedure for current work. P5.2V is the only operative package/contract
preflight.

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
- At the P5.0 checkpoint, the source repository contained high-level `buildBox`
  and `verifyBox` functions, but `scrollcase@0.1.0` had to be judged only by its
  published `exports` map. The same consumer rule applies to the current
  `0.1.3` pin: source-repository visibility never authorizes a deep import.
- The Scrollcase CLI correctly does not understand Liatir's signer URL, audience,
  receipt, publish, promote, revoke, or serve flags. P5.2 supplies those
  consumer-side adapters.

### Stop rule

If a required generic capability cannot be reached through the published package:

1. stop the Liatir cutover;
2. record the smallest vendor-neutral public API or declaration that the
   external tool would need;
3. stop and ask the Scrollcase maintainer to implement and publish it in that
   independent project; Liatir-side work must not modify the external source;
4. pin the resulting immutable published version in this plan before resuming.

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

Liatir pins `0.1.3` in the root graph and `@liatir/core`. The package regression
checks the exact package name, version, executable, export map, tarball identity,
strict TypeScript declarations, runtime imports, schemas, fixtures, CLI discovery,
and rejection of unpublished deep/sibling/file imports. The invalid local
configuration `$schema` hint was removed because Scrollcase does not publish a
configuration schema. The fail-closed parser remains the authority.

The P5.2 closure advanced the immutable pin from `0.1.2` to `0.1.3` after the
real consumer build exposed a valid conda symlink-chain layout that `0.1.2`
could not unpack. The public npm identity read back before installation is:

- npm SHA-1 `eafb801264ed62f80bf087c6c46fde7120ecb7e8`;
- npm integrity
  `sha512-dyrCX0IH+eqjB9q+dwQsdLcMflL5xScVprFNi8dpbL0NDINSidNOZZkRaIGxi7zei8zzawdSXwQQRH+Ryzz3hg==`.

The stable P5.0 boundary is the published CLI for high-level `lock`, `build`, and
`verify`, with public primitives used where exported. P5.2 wraps that CLI for
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

## P5.1 — Historical schema-v1 contract inversion

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

## P5.2 — Historical schema-v1 adapter and distribution split

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

### P5.2 execution record — complete

The stable `npm run runtime-box -- ...` surface now enters the thin
`scripts/runtime-box.mjs` dispatcher. `scripts/runtime-box/scrollcase-adapter.mjs`
resolves the executable declared by the exact installed `scrollcase@0.1.3`
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
wrapper. The package bin, npm, heartbeat and signer invocations remain shell-free
on Windows and preserve quoted arguments.

The proposed model-workflow path-filter widening has been removed. The existing
foundation workflow still watches Liatir's Runtime Box adapter files for its cheap
preflight, but its legacy hosted native-fixture matrix is now guarded by
`github.event_name == 'workflow_dispatch'`. Pull requests, normal pushes and the
schedule cannot allocate those native fixture jobs. Model-native validation
remains explicit and on-demand on the checked self-hosted profiles; no workflow
was dispatched while completing this checkpoint. P5.3 will migrate and rewire
the three foundation fixtures one target at a time rather than using this
historical hosted matrix as migration evidence.

The synthetic adapter fixture exercises real key generation through the installed
published CLI, pixi build routing with the frozen namespace, verification and
receipt composition, local shared-envelope signing, all Liatir distribution
routes, and the temporary uv branch. The first real package cycle also exposed
and fixed one Liatir-side defect: the consumer workspace parser did not accept
the public `paths.toolchain` key emitted by `scrollcase init`. The parser now
accepts that key and the corresponding `--toolchain-dir` override, with a direct
regression.

A first clean temporary consumer checkout used the stable Liatir command with the
managed, checksum-verified pixi 0.73.0 and conda-pack 0.9.2 toolchain:

1. `keygen` completed through the exact installed package;
2. `lock` resolved and committed the generated macOS arm64 Python 3.11 lock;
3. `build` installed the frozen environment and completed conda-pack;
4. the package then failed while extracting its own conda-pack tar with
   `TAR_SYMLINK_ERROR: Cannot extract through symbolic link`.

A fresh diagnostic extraction with the same pinned Node `tar` implementation
identified the exact legitimate in-prefix structure: the archive contains
`lib/icu/current` as a symlink and later
`lib/icu/current/pkgdata.inc`; strict extraction rejects the latter as extraction
through a symlink. This occurs before Scrollcase's documented in-place symlink
materialisation step. No release document or receipt was created, so `verify`
could not truthfully run.

This is not a Liatir adapter or recipe-policy decision and must not be patched
around by pruning a dependency, deep-importing package internals, copying the
builder, loosening archive safety, or modifying the external source from this
repository. Under the P5.0 stop rule, the smallest required upstream change is a
vendor-neutral safe extraction implementation that accepts legitimate
in-prefix symlink-parent entries while still rejecting path escape, followed by
a new immutable Scrollcase release. Liatir must then pin that release and repeat
the complete real `keygen → lock → build → verify` cycle.

The independent maintainer published that vendor-neutral fix as
`scrollcase@0.1.3`. Liatir updated both exact dependency pins and the root
lockfile, preserved the unchanged public export map, and repeated the same
macOS arm64/Python 3.11/ICU 78.3 fixture from a new clean temporary Git checkout.
Through `scripts/runtime-box.mjs`:

1. `keygen` created a local Ed25519 key;
2. `lock` resolved and the generated `pixi.lock` was committed;
3. `build` installed from that frozen lock, packed and safely unpacked the conda
   environment, ran the declared stdlib self-test, emitted the frozen
   `liatir.runtime-box.release` namespace, signed the release and wrote a checked
   Liatir build receipt;
4. a separate `verify --self-test` invocation verified the signature, safe
   archive, manifest agreement and extracted interpreter, then wrote the checked
   verification receipt.

Both receipts report `status: passed`, `localSignatureVerified: true` and
`selfTest: passed`. The clean release records `sourceTreeDirty: false`. The
96,978,171-byte archive SHA-256 is
`6deb058e1ed288c74ba73f20fda494059cfc280f5b2101467d0ea504aa2147b4`,
matching the signed release and both receipts; the release payload SHA-256 is
`032fc3bda759ab4008af7dfcf0236320dd677939232c150d1c3145f8d2ee2b17`.

This checkpoint downloaded only the small declared toolchain and stdlib fixture.
It did not download a model, allocate a runner, publish, promote, deploy, or
change a trust root.

Evidence on 2026-07-27:

- `npm run test:unit`: 35 files and 219 tests passed;
- `npm run test:verify`: unit/contract tests, SDK generation, core build,
  zero-error Svelte check, frontend production build and root TypeScript compile
  passed;
- `npm run runtime-box:test:foundation`: TAR safety, deterministic Zip64 and the
  Rust large-archive compatibility fixture passed;
- `npm run docs:internal:build`: the tracked maintainer documentation built;
- targeted adapter, signer, receipt, publisher, deployment, CI path-filter and
  Windows invocation regressions passed.
- real consumer proof on `scrollcase@0.1.3`: clean keygen, committed lock,
  frozen build, self-test, signed release, separate verify and both Liatir
  receipts passed with matching hashes.

P5.2 is complete for the immutable `scrollcase@0.1.3`/schema-v1 baseline. Do not
start the fixture conversion by changing recipes under that assumption:
Scrollcase's current public line is v2-only and must pass P5.2V first.

## P5.2V — Cut Liatir over to the published Scrollcase v2 contract

This is a new migration phase, not a reopening of the evidence that closed
P5.0–P5.2. That proof remains historical evidence for the package version that
produced it, not a compatibility requirement for new Liatir. P5.2V replaces the
active schema-v1 contract completely: there is no dual reader, npm alias,
generated v1 compatibility layer or v1/v2 union in the target architecture.

### P5.2V.0 — Verify the selected immutable `scrollcase@0.4.11`

The initial npm/tarball identity readback is complete and recorded above. Repeat
it immediately before installation so a registry or maintainer change cannot be
mistaken for the reviewed package.

1. Read back the exact npm name, version, SHA-1, integrity, executable and
   `exports` map immediately before changing a dependency.
2. Inspect only the published tarball. Do not use a sibling Scrollcase checkout
   as an implementation or test input.
3. Record the v1-to-v2 delta for:
   - scroll/recipe input and workspace layout;
   - release, channel, revocation and signed-envelope schemas;
   - target identity;
   - archive layout and content-addressed output names;
   - external signer payload;
   - verification and execution metadata;
   - browser-safe helpers, Node consumer and generated declarations.
4. Resolve or explicitly accept the `0.4.11` release-note inconsistency: its
   published tarball is v2-only while its changelog places that work under
   `Unreleased`. `0.4.11` remains the selected version unless the maintainer
   explicitly changes this plan; a newer version requires a fresh immutable
   identity readback and restarts only this preflight.
5. Add a package-surface regression for every public entry point Liatir will use,
   including `scrollcase/consumer` only if the architecture decision below keeps
   it.

### P5.2V.1 — Replace the shared contract once

1. Upgrade the root and `packages/liatir-core` exact dependency to
   `scrollcase@0.4.11` in one dependency slice.
2. Make `packages/liatir-core` import/refine only Scrollcase v2 public
   declarations and helpers. Regenerate SDK artifacts; never hand-write a
   frontend, `src-ts`, Worker or Rust v2 shadow contract.
3. Replace every active schema-v1 fixture, parser, signer payload, Registry
   document and product IPC type with schema v2.
4. Remove schema-v1 authoring, verification and installation paths rather than
   retaining aliases, unions or fallback parsing.
5. Preserve `liatir.runtime-box.*`, canonical target IDs and trust roots as
   product identity. Schema version changes; product identity does not.
6. Reject schema v1 and every unknown schema version with a stable explicit
   unsupported-format error. Never guess the version from a filename, channel,
   box version or target ID.

Existing v1 release/channel/archive objects stay byte-for-byte immutable as
historical artefacts. They are not converted, resigned, republished or accepted
by the v2-only client.

### P5.2V.2 — Define the installed-v1 product cutover

Dropping the v1 parser must not leave stale installed state pretending to be
usable. Before the code cutover:

1. inventory how installed Runtime Box metadata records its schema version;
2. detect v1 state before normal selection or execution and mark it explicitly
   unsupported;
3. disable dispatch and update for that box without blocking unrelated Jobs,
   models or pipelines;
4. offer bounded removal/reinstall-to-v2 handling using installation metadata
   and filesystem ownership, not v1 document interpretation;
5. preserve completed Results and provenance records even when their producing
   v1 runtime is no longer runnable;
6. ensure a v1 channel or cached release cannot be selected as an update for a
   v2-only client;
7. document the compatibility break and the minimum Liatir version for the first
   v2 box before any protected publication.

If safe removal cannot be performed without keeping the v1 wire parser, stop and
choose an explicit one-time application migration before deleting it. That
migration may inspect only the product-owned installed-state record; it must not
become a permanent v1 Runtime Box consumer.

### P5.2V.3 — Prove every Liatir-owned boundary

Before migrating a recipe:

1. make the signer policy validate only the exact v2 payload and reject v1;
2. make the Registry Worker and local candidate server serve only supported v2
   documents and fail closed on v1 or unknown versions;
3. make Rust/Tauri installation, persisted anti-replay state and frontend
   selection v2-only;
4. prove stable explicit rejection and product-owned cleanup for installed or
   offered v1 state;
5. prove a synthetic v2 release through keygen, external signer translation,
   build, separate verify/self-test, Liatir receipts and safe extraction;
6. compare namespace, target ID, archive hash, payload hash and manifest
   agreement from parsed documents rather than filenames;
7. decide whether `scrollcase/consumer` is only a Node conformance oracle or has
   a bounded build/test role. It must not become a desktop runtime dependency,
   download layer, registry client or substitute for Rust/Tauri lifecycle;
8. keep Scrollcase's Python consumer outside Liatir unless a separately approved
   product requirement appears.

### P5.2V exit gate

- the selected exact v2 package identity and release-note disposition are
  recorded;
- all active types/schemas come from the published v2 package through
  `packages/liatir-core`;
- no schema-v1 package alias, shared type, parser, signer, Registry path,
  installation path or fallback remains;
- core, frontend, Worker, signer and Rust accept v2 and explicitly reject v1 and
  unknown schema versions;
- installed-v1 state has a bounded product-owned unsupported/removal path that
  preserves Results and provenance;
- one clean synthetic v2 `keygen → lock → build → verify --self-test` proof is
  green;
- no recipe, catalog identity, trust root, public object, channel or protected
  release changed during the cutover phase.

### P5.2V completion evidence — 2026-07-30

P5.2V is complete.

- Root and `packages/liatir-core` pin exact `scrollcase@0.4.11`. Immediate npm
  readback matched SHA-1
  `7bb8364ff820dd44dc749e9ef28a6df9cc9808ac` and integrity
  `sha512-/BLoSjwN4rcKOx+gTtfb0tBrN4+hlsno3pIl4L/m1jHSHBGgM4qPA1GY7ns9BEK7Cj8nWfrqYqNDtz3FoZvCWw==`.
  The package-surface regression compiles the browser contract, generated
  declarations, signer helpers and bounded Node consumer from the installed
  tarball. The v2 work appearing under `Unreleased` in the packaged changelog is
  accepted as release-note lag; the immutable tarball schemas and exports are
  the operative contract.
- `packages/liatir-core` imports the v2 types and browser-safe helpers from public
  Scrollcase exports. There is no npm alias, deep import, sibling checkout,
  v1/v2 union or frontend shadow type.
- Signer policy, signed envelopes, Registry release/channel/revocation routing,
  local candidate serving, Rust installation/anti-replay state and frontend
  runnable provenance are v2-only. Schema v1 and unknown versions fail closed.
- Installed v1 state is marked unsupported and disabled per model. Rust never
  interprets its v1 release document; removal uses product-owned filesystem
  identity, leaves unrelated models and jobs alone, and preserves already
  persisted Results/provenance records.
- `scrollcase/consumer` is used only by the native validation harness as an
  independent build/test oracle. It is not a desktop runtime, downloader,
  Registry client or Python product dependency.
- The synthetic stdlib fixture completed
  `keygen → lock → build twice → verify --self-test`: the reviewed lock was
  unchanged byte-for-byte, both clean-source archives had SHA-256
  `e0e5a8d668724532bb425a8d43b54b21bf6f74a5245f73721b1113a121e89a03`,
  the external Liatir signer adapter returned a v2 envelope, Node safely
  extracted and ran the declared shell-free entry point, and Rust passed archive
  agreement, activation/rollback/removal and explicit v1 rejection.
- `npm run test:verify` passed 35 files / 220 tests, SDK type generation, core
  build, zero-error Svelte check, frontend production build and root TypeScript
  compile. Catalog, signer and foundation gates also passed.

No trust root, public object, channel, protected release, publication or remote
runner changed in P5.2V.

## P5.3 — Migrate the three foundation fixtures to v2

Begin only after P5.2V is green. Migrate the cheapest native artifacts before
model recipes:

1. macOS fixture;
2. Linux fixture;
3. Windows fixture.

For each fixture, one at a time:

1. create one schema-v2
   `scrolls/<boxId>/<targetId>/scroll.json` and its single-platform `pixi.toml`;
2. preserve the existing `recipeId`, `boxId`, runtime identity, target ID and
   Liatir namespace; do not derive a replacement identity from the new path;
3. generate and review `pixi.lock` with the exact pinned pixi version;
4. add a lock-derived conda licence audit where the foundation contract requires
   it;
5. carry shell-free execution/self-test metadata explicitly into the v2 signed
   manifests;
6. update catalog lock hash and disk plan from measured output;
7. refactor `validate-runtime-box-native-fixture.mjs` so it validates the
   Scrollcase v2/pixi layout rather than standalone-Python/uv assumptions;
8. build through the exact published v2 executable, use Liatir's external signer
   adapter, then run separate verify/self-test;
9. run the Rust archive fixture and activation/rollback/removal checks on the
   matching native host, while retaining the explicit v1-rejection regression;
10. remove that fixture's uv-only fields/files only after its native v2 proof is
    green, then clean only generated fixture build state.

Locks may be resolved without dispatch where pixi supports the target platform,
but a cross-resolved lock is not native self-test evidence. Linux/Windows native
execution still requires a separately approved runner/session.

### Exit gate

- all three fixture recipes are pixi-only;
- all three build inputs are schema-v2 scrolls in the canonical nested layout;
- foundation validation imports active generic helpers from the v2 package;
- schema-v1 documents remain explicitly unsupported on every product boundary;
- `npm run runtime-box:test:foundation`, the relevant Rust tests, catalog check
  and unit group pass;
- no foundation workflow invokes `--uv` or expects a requirements lock.

### P5.3 execution evidence — 2026-07-30

- All three canonical
  `runtime-boxes/scrolls/runtime-box-installer-fixture/<targetId>/scroll.json`
  inputs, single-platform `pixi.toml` files, pixi `0.73.0` locks and
  lock-derived conda licence audits are reviewed and catalog-bound. Stable
  recipe provenance IDs, `boxId`, `runtimeId`, target IDs and
  `liatir.runtime-box` namespace are unchanged.
- Cross-platform lock resolution is complete. It is not counted as native
  execution evidence.
- macOS Apple Silicon is complete. The native proof resolved the reviewed lock
  without changing it, built twice deterministically, exercised the external
  signer adapter, separate verify/self-test, Node consumer extraction/execution,
  and Rust archive plus activation/rollback/removal checks. Measured installed
  size is `257776217` bytes; archive size is `96979089` bytes. Only after that
  proof passed were the macOS uv recipe and requirements files removed.
- The Linux and Windows v2 inputs are ready, but their old uv recipe files remain
  intentionally present until each matching native proof passes.
- `runtime-box-foundation.yml` accepts exactly one reviewed fixture per manual
  dispatch. Linux uses `liatir-linux-selfhosted` with a 30-minute bound; Windows
  uses `liatir-windows-selfhosted` with a 60-minute bound. The shared ephemeral
  launchers resolve foundation runner identity and disk floors directly from
  the catalog. No foundation workflow invokes `--uv`.

P5.3 remains open until the separately approved Linux and Windows native
sessions pass, their measured disk plans are recorded, and only then their two
uv fixture directories are removed.

## P5.4 — Migrate active model recipes

Migrate every active model authoring record, not only the uv substrates. The
five already-pixi scGPT inputs still use the old schema-v1 `recipe.json` layout
and therefore are not accepted by the v2-only adapter. Convert them first
because their dependency locks and native/scientific baselines already exist.
Keep one target in flight:

1. scGPT macOS Metal;
2. scGPT Linux CPU;
3. scGPT Windows CPU;
4. scGPT Linux CUDA 12.9;
5. scGPT Windows CUDA 12.8;
6. Geneformer macOS Metal;
7. Geneformer Linux CPU;
8. Geneformer Windows CPU;
9. UCE macOS Metal;
10. Geneformer Linux CUDA successor;
11. Geneformer Windows CUDA successor only when its no-dispatch rule is lifted.

The scGPT conversion proves schema-v2 authoring without also changing the pixi
substrate. The lighter CPU/Metal Geneformer targets then establish the uv-to-pixi
migration path before the large UCE and CUDA builds.

### Repeated recipe gate

For every target:

1. preserve model/source/asset hashes, legal record, box ID and runtime ID;
2. create the exact schema-v2 nested scroll, single-target pixi manifest and
   committed lock;
3. verify packages, channels, source-build absence and native-library closure;
4. generate and review the conda licence audit;
5. update `pythonVersion` to the interpreter actually installed;
6. remove `uvVersion`, `requirementsInput`, `requirementsLock` and their files;
7. update catalog dependency hash, audit path and measured disk plan;
8. preserve or explicitly translate `minLiatirVersion`, namespace and all
   product-owned compatibility fields into the v2 manifest;
9. build through the published package on the matching native host;
10. pass self-test, model scientific validator, Jobs/Results/provenance and
    removal/rollback as required by the target's validation mode;
11. retain compact evidence and update the roadmap before another target starts.

### Immutable-version rule

Published uv boxes cannot be rebuilt as different pixi bytes under the same
release version. Before any protected publication, select a new version and
prove that its immutable object keys do not collide. P5 may validate a candidate
locally, but it must not upload or promote it.

The schema transition does not authorize rewriting an existing release. A v2
successor receives a new box version and content-addressed objects; prior v1
release/channel objects remain preserved and immutable but unsupported by the
v2-only client.

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
- no active build or consumer accepts schema v1, while rejection fixtures remain
  green;
- no generated binding was edited by hand;
- active v2 package fixtures and tracked v2 compatibility fixtures are
  identical;
- historical v1 artefacts remain byte-for-byte unchanged and outside active
  fixture resolution.

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
Scrollcase-v2-built candidate:

```text
install -> self-test -> real inference -> Job -> Result -> provenance ->
replacement/rollback -> removal -> Result survival -> cleanup
```

Prefer the smallest representative target whose recipe and runner are already
approved. This is not a protected release and must not publish or promote.

Separately prove that a v1 fixture cannot install, update or execute, produces
the stable unsupported-format state, can be removed through the bounded
product-owned cleanup path, and does not delete completed Results or provenance.

Additional native target runs belong to the per-target recipe migration and keep
their explicit approval boundary.

### Fresh-checkout acceptance

From a clean checkout with no generated Runtime Box output:

- install dependencies from the committed lockfile;
- build `@liatir/core`;
- resolve the exact active v2 Scrollcase binary and public exports;
- run the synthetic v2 fixture and the v1 rejection/cleanup fixture;
- prove no sibling repository, global npm package, warm build tree, or untracked
  key is required.

### Closure evidence

Record:

- exact active-v2 package identity and lockfile integrity;
- v2 contract/fixture parity and v1 rejection results;
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

- Implement P5.2V–P5.4 in small commits while the old builder still exists, so a
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

1. The selected exact v2 package lacks a required public export, usable
   declaration or unambiguous immutable release identity.
2. A Liatir build would require a deep import, copied Scrollcase code, sibling
   checkout, global install, or `any` contract shim.
3. Any active surface still needs a schema-v1 parser, package alias, shared type,
   signer path, Registry path or installation fallback after cutover.
4. A wire fixture, namespace, target ID, payload encoding, signature, archive
   layout or Rust consumer result changes unexpectedly.
5. A recipe needs source builds, has an incomplete licence audit, changes a model
   asset hash without review, or cannot self-test natively.
6. A CUDA successor would overwrite or rename a 12.4 identity.
7. Any active uv recipe or caller remains when deletion begins.
8. A heavy model build, remote runner, paid resource, deployment, protected
   release, publication or promotion becomes necessary without specific approval.
9. A failed protected or native run lacks its exact underlying log.
10. User-owned work overlaps a required file and cannot be preserved safely.

After a new defect: record the symptom, root cause, regression, retry limit,
cheap rechecks and cleanup before another expensive attempt.

## Maintainer decisions still required during execution

The initial P5 go-ahead authorizes local implementation and cheap verification
only. Pause later for:

1. any upstream Scrollcase patch and new npm publication;
2. the one-time installed-v1 cleanup mechanism if product-owned state is
   insufficient for safe removal without a v1 wire parser;
3. the Geneformer CUDA legacy/successor catalog design;
4. each Linux/Windows/native or heavy UCE allocation;
5. any protected signer deploy or release;
6. final deletion if the active-recipe/caller inventory is not exactly zero.
