# Scrollcase P5 — Liatir adoption and legacy builder retirement

Last reviewed: 2026-08-06

Status: **in progress — P5.2V, P5.3 and P5.4 complete. Every model target is a
schema-v2 scroll and natively proven, and no uv recipe remains anywhere. P5.4V
has raised the pin to `0.7.1`; UCE was authored and proven on it, while the other
the three macOS targets are rebuilt and measured on it. Six Linux/Windows model
targets and two foundation fixtures still carry `0.4.11` archives and need their
own hosts. The schema-v1 uv authoring path is deleted.**

This is the canonical execution plan for **Scrollcase extraction phase P5**. P1–P4
are complete: Scrollcase is an independent Apache-2.0 project. The P5 target was
exact `scrollcase@0.4.11`, whose published tarball contains the v2-only
contract; P5.4V has since raised it to exact `0.7.1`. The checkout pins that
version exactly and consumes it only through
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

Six recipes still use uv and block complete builder retirement:

| Group | Recipe | Current target state |
| --- | --- | --- |
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
| P5.3 — v2 foundation-fixture migration | Complete | Three reviewed v2 scrolls/locks/audits; macOS, Linux and Windows native proofs green; every foundation uv fixture removed only after its matching proof |
| P5.4 — model-recipe migration | Complete | All five scGPT inputs, Geneformer's whole matrix (macOS Metal plus both CUDA successors, its CPU targets dropped on measurement) and UCE are v2 and natively proven. No uv recipe remains anywhere. UCE was authored on `0.7.1` and passed on first dispatch; the other eight model targets were proven on `0.4.11` and owe a rebuild, as do two foundation fixtures, tracked in P5.4V |
| P5.4R — adopt `scrollcase-consumer` in the Rust bridge | In progress | `runtime_boxes.rs` delegates format verification to exact `scrollcase-consumer` (now `0.3.0`, see P5.4E), keeps the product lifecycle, and proves the Liatir-owned call order |
| P5.4T — `scrollcase-consumer 0.2.0` pin and delegation sweep | Complete | Exact `=0.2.0`; hand-written trust parser replaced by `trust::parse_trusted_keys` with all three key sources on one format; `dir_size` → `filesystem::payload_size`; `RuntimeBoxArchive`, `RuntimeBoxSelfTest` and `ExtractedBoxMetadata` deleted in favour of the box format's own types; the 13-field comparison replaced by `assert_box_manifest_agreement`, which closes the uncompared `environment` field; `min_ram_gb` → `f64`, matching the shared TS contract. `cargo clippy` clean and 41/41 Rust tests green |
| P5.4E — Rust `Compatibility` carries project constraints | Resolved upstream, adopted | The Rust `Compatibility` was `deny_unknown_fields`, stricter than the schema the crate itself ships (`additionalProperties: true`, "a project may add its own"). Measured at the time: the Node consumer accepted `runtime-boxes/contract-compatibility-fixtures.json`, the Rust type rejected the same bytes. Fixed upstream in `scrollcase-consumer 0.3.0`, which carries unknown constraints in `Compatibility::additional` and states that an application finding one it does not understand must refuse the box. Liatir pins `=0.3.0`, has **deleted its own `ReleaseManifest` and `RuntimeBoxCompatibility`** in favour of the box format's types, reads `minLiatirVersion` / `maxLiatirVersionExclusive` from `additional`, and refuses any other entry. `to_box_format` is gone |
| P5.4V — Scrollcase `0.4.11` → current-line upgrade | Pin raised and locally proven; rebuilds outstanding | Exact `scrollcase@0.7.1` with its npm identity read back into the lockfile, `scrollcase-consumer 0.1.2` confirmed ahead of the format, the macOS foundation fixture rebuilt and passed end to end through the Rust lifecycle, and the maintainer decision recorded that every proven target rebuilds rather than freezes |
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
resolved the executable declared by exact installed `scrollcase@0.1.3` at this
historical P5.2 checkpoint. The current adapter uses exact `scrollcase@0.4.11`.
It resolves the package through a public ESM export, invokes it through the
current Node executable without a shell, forces `liatir.runtime-box` exactly
once, and writes
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

At the P5.2 checkpoint, foundation validation was manual-only and allocated one
checked ephemeral self-hosted Linux or Windows runner; it had no separate hosted
preflight, automatic pull-request, push or scheduled allocation. That remains
the foundation-fixture design. The current model workflow adds one essential,
bounded `ubuntu-24.04` catalog preflight (`timeout-minutes: 15`) before allocating
exactly one checked ephemeral self-hosted native runner. Model build, scientific
validation and lifecycle never use a GitHub-hosted runner. No model workflow was
dispatched while completing P5.2; later run evidence is recorded under P5.4.

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

### P5.3 execution evidence — 2026-07-30–31

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
- Linux x86_64 is complete. The first authorized dispatch, run `30565143883`,
  failed before the native fixture because the clean checkout ran the Rust
  foundation gate before generating `src-tauri/tsc/bridge.js`; it produced only
  failure evidence and is retained as incident provenance, not acceptance
  evidence. Commit `3de11868c510665544d54f9251496c479d02866a` moved the
  existing bridge-generation step before the gate and added an ordering
  regression. The single authorized retry, run `30594110843`, passed on
  `liatir-linux-selfhosted-1785458323-362` from that exact clean revision.
  It reproduced the reviewed lock byte-for-byte, built twice with identical
  archive bytes, exercised the external schema-v2 signer adapter, separate
  verify/self-test, shell-free Node consumer extraction/execution, Rust archive
  and activation/rollback/removal checks, and explicit schema-v1 rejection.
  Archive SHA-256 is
  `4968084661a0fc98b36dd2e86f37e5642ba092afd8078459e7a7a1ae5fc94fca`;
  measured archive size is `200216832` bytes and installed size is
  `506827820` bytes. Artifact `8779573721` has digest
  `sha256:19e10ac80b33b36bfd53d185490b9401b134f5579674bc54dcfeb5b006f0e260`.
  Only after this proof passed were the Linux uv recipe and requirements files
  removed.
- Windows x86_64 is complete. The first authorized dispatch, run
  `30594990987` at commit
  `2e3943a68138f39e8e76d29b4a24096cba90a489`, stopped in the foundation
  TAR safety gate because creating the malicious symlink fixture itself
  requires Developer Mode or administrator privilege on Windows. It produced
  only failure artifact `8779808344`
  (`sha256:96ac1dc53055d83172ef5a499a99a512d9ec6a2251a01a44f54abb58a8606941`)
  and is retained as incident provenance, not acceptance evidence. Commit
  `1dc25fd25d299f970fbc0501197267e03ec50d16` made that regression portable
  by constructing the TAR link entry directly, without weakening the
  extraction rejection. The single authorized retry, run `30595863980`
  (job `91047973218`), passed from that exact clean revision on
  `liatir-windows-selfhosted-1785460565-23168`. It reproduced the reviewed
  lock byte-for-byte, built twice with identical archive bytes, exercised the
  external schema-v2 signer adapter, separate verify/self-test, shell-free
  Node consumer extraction/execution, Rust archive and
  activation/rollback/removal checks, and explicit schema-v1 rejection.
  Archive SHA-256 is
  `e0455e6de2fa86b18ae47581e2cb47048520b114d7f003141fef1d5a8561c4bc`;
  measured archive size is `44718074` bytes and installed size is `126224685`
  bytes. Artifact `8780252596` has digest
  `sha256:d81d6db1c24c41b13f03dc74629ea986006838f92147e75bd97fe8f6dcf55832`.
  Only after this proof passed were the Windows uv recipe and requirements
  files removed.
- `runtime-box-foundation.yml` accepts exactly one reviewed fixture per manual
  dispatch. Linux uses `liatir-linux-selfhosted` with a 30-minute bound; Windows
  uses `liatir-windows-selfhosted` with a 60-minute bound. All foundation checks
  run on the selected self-hosted runner; no GitHub-hosted preflight exists.
  The shared ephemeral launchers resolve foundation runner identity and disk
  floors directly from the catalog. No foundation workflow invokes `--uv`.

P5.3 is complete. The cancelled historical foundation run `30548041903`
targeted the preceding revision and is explicitly excluded from acceptance
evidence. P5.4 is now in progress.

## P5.4 — Migrate active model recipes

Migrate every active model authoring record, not only the uv substrates. At the
start of P5.4 all five already-pixi scGPT inputs still used the old schema-v1
`recipe.json` layout and were not accepted by the v2-only adapter. All five
inputs are now canonical v2 scrolls. All five inputs have complete native
lifecycle proof.

P5.4 remains one phase. It is organized into three operational blocks, not new
subphases or acceptance checkpoints:

1. **scGPT v2:** convert the existing macOS Metal, Linux CPU, Windows CPU,
   Linux CUDA 12.9 and Windows CUDA 12.8 pixi inputs to schema-v2 authoring,
   reusing their reviewed locks and native/scientific baselines;
2. **Geneformer CPU/Metal + UCE:** migrate Geneformer macOS Metal, Linux CPU
   and Windows CPU from uv to pixi, then migrate the large UCE macOS Metal
   recipe;
3. **Geneformer CUDA legacy decision:** preserve the frozen CUDA 12.4
   identities and introduce a Linux CUDA 12.9 successor; introduce a Windows
   CUDA 12.8 successor only after its no-dispatch rule is explicitly lifted.

Within each block, keep one target in flight. Native runs are sequential
evidence for the same P5.4 phase; they do not create P5.4.1–P5.4.11 or separate
planning documents.

Block 1 started with `scgpt-whole-human-linux-x86_64-cpu`. Its authoring input
is now a single canonical schema-v2 scroll; the reviewed pixi lock remains
byte-identical at
`fb7aeff5b95faeda3277f4ba2216ac269db6f0d263c0ccf07779452b55f0dec1`,
and its 112-package audit was regenerated by published
`scrollcase@0.4.11`. The legacy schema-v1 descriptor was removed. Linux CPU
then passed the complete native lifecycle in run `30599143569`, job
`91057957841`, on runner `liatir-linux-selfhosted-1785464985-360` at commit
`a74b826c2f151f4810c715a9c98cedf75dd3ed71`. The clean build produced archive
SHA-256 `1cdaafa35270bf53a6bdc722a7f3d8e0d26fec70f5e359192322a053ff3b5801`,
archive size `1212137655` bytes and installed size `3544428400` bytes. Peak
additional runner disk was `5217239040` bytes; the measured catalog disk plan
is `9270355105` bytes within the retained `10737418240`-byte floor. Compact
artifact `8781444892` preserves the successful build, verify, scientific and
Rust lifecycle evidence.

Windows CPU then passed the same complete lifecycle in run `30707681953`, jobs
`91389511757` and `91389564939`, on runner
`liatir-windows-selfhosted-1785600732-2300` at commit
`0817376dd579b18a3602e0b4f19eb2ca58dc65b2`. Its schema-v2 scroll and
94-package Scrollcase audit replace the legacy descriptor while pixi lock
SHA-256 `223f3996e052be616e6f481e1fa65db376c0da2fa555b7425bc73fa2896682c8`
remained byte-identical. The clean build produced archive SHA-256
`99fce2900499b83a6db83fe3de61403f792adf7cefaad26276b433a50e44f235`,
archive size `566942596` bytes and installed size `1478447610` bytes. Peak
additional runner disk was `2248216576` bytes; the measured catalog disk plan
is `6559179256` bytes within the retained `8589934592`-byte floor. Compact
artifact `8821068033` and preflight artifact `8820836697` preserve the proof.
Historical runs `30706215540` and `30706781234` stopped before a valid build on
the Windows Pixi bootstrap and an overlong conda prefix respectively; failure
artifact `8820610374` is retained as provenance, not acceptance evidence. Liatir
now verifies the pinned official Pixi binary and bounds its own checkout build
path; no Scrollcase source was modified or simulated. Both CPU targets are
proven.

Linux CUDA 12.9 then moved to the same canonical v2 authoring layout without
changing pixi lock SHA-256
`3bc87da78d23f009d4f654f3da734f7ca226489f700f9ad5e355163b4a729194`.
Published `scrollcase@0.4.11` regenerated and checked the 142-package v2 audit.
Complete native lifecycle run `30709157030`, jobs `91393417061` and
`91393467655`, passed on runner
`liatir-linux-cuda-selfhosted-1785603174-361` at commit
`ca123fea99a5c71d6681fbd32907433c139395bb`. The RTX 4060 Ti build produced
archive SHA-256
`006796c1636eead60acaa65b8825054aa005bed96807f0768fcc60f1564135d7`,
archive size `17098121591` bytes and installed size `27706335619` bytes. Peak
additional disk was `45279006720` bytes; the measured plan is `50391988084`
bytes within the retained `60129542144`-byte floor. CUDA 12.9 scientific parity
passed at cosine `0.99999999999994`, maximum absolute difference
`8.940696716308594e-8`, and peak VRAM `219378688` bytes. Compact artifact
`8821789904` and preflight artifact `8821296478` preserve the proof.

Windows CUDA 12.8 completed the requested Linux/Windows set in run
`30711089971`, jobs `91398563744` and `91398620522`, on runner
`liatir-windows-cuda-selfhosted-1785606195-22696` at commit
`f3c719a9de169c0a5f429ffe6d9a7c2195aa4e68`. Its lock remained byte-identical
at SHA-256
`138eaefb4820a0e16288c87f01f799ff440b84e10f77e65639c631be739db6a8`,
and published Scrollcase regenerated and checked the 110-package v2 audit. The
RTX 4060 Ti build produced archive SHA-256
`1ad3b68cb526d976ecd280479d053cd6323a1c5ea7af4bfe8aab1b07f6218e39`,
archive size `4378954604` bytes and installed size `7053500062` bytes. Peak
additional disk was `11645431808` bytes; the measured plan is `17019985540`
bytes within the retained `25769803776`-byte floor. CUDA 12.8 scientific parity
passed at cosine `0.9999999999998881`, maximum absolute difference
`1.1920928955078125e-7`, and peak VRAM `219378688` bytes. Compact artifact
`8822298430` and preflight artifact `8821892037` preserve the proof. All four
Linux/Windows scGPT targets are canonical v2 and native-lifecycle validated.
The macOS Metal proof below completes block 1; later P5.4 blocks remain.

**macOS Metal completion:**
`scgpt-whole-human-macos-arm64-metal`. Its authoring input is now the canonical
`runtime-boxes/scrolls/scgpt-whole-human/macos-aarch64-metal/scroll.json`.
The existing pixi lock remains byte-identical at SHA-256
`04f83b64db8b5f6faf65fa40c677d6596a50c7d5482c51d8c1baa173588b388a`,
and published `scrollcase@0.4.11` generated and checked the matching 100-package
schema-v2 audit. The catalog routes the native proof to the dedicated
`liatir-macos-arm64-heavy` self-hosted Apple-Silicon runner. The published
`0.2.5-beta.1` release, production signature, archive, catalog publication
metadata and historical evidence are immutable; this continuation authorizes no
publication or channel change.

The first authorized macOS native run `30715635531`, job `91410651050`, at
commit `c855e66efd9ca64eefc0b450af250de9ded7ad15` is retained as failure
provenance, not acceptance evidence. It passed clean checkout, pinned pixi and
conda-pack setup, host probe, local signing, build, archive verification and
self-test. The build produced archive SHA-256
`c2bd4df34882ae58af5e1c0d0712535540a96dba2ccaf09865fbfc6023b3b5f7`,
archive size `664045178` bytes and installed size `1787639135` bytes. The real
scientific forward then failed with `ModuleNotFoundError: No module named
'sympy'`; Rust lifecycle correctly remained skipped. Compact failure artifact
`8823318701` has digest
`sha256:de2dc0d4f586410a2b7a440a25429c0d9a0dacbd1320f2da39fb99ce16dc419f`.

Root cause is Liatir's inherited macOS-only prune list, not Scrollcase or a
scientific parity difference: it removed complete locked runtime dependencies,
including `sympy`, while PyTorch 2.8 imports `sympy` lazily only during the
transformer forward. Import checks and the existing checkpoint self-test could
therefore pass without proving inference. The correction retains every locked
runtime dependency, aligning macOS with the other four canonical scGPT v2
scrolls. A regression checks all five scGPT targets and rejects any `venv/`
prune path. Cheap rechecks are the focused cost/catalog/product contracts,
catalog validation, Scrollcase audit agreement, frozen lock hash, full
`test:verify`, internal docs build and `git diff --check`.

The single authorized retry, run `30763954679`, jobs `91539295552` and
`91539336858`, passed at clean commit
`fd1819195dd77e033286ca083e05afa440c0d649` on self-hosted runner
`liatir-macos-heavy-1785699749-3285`. It completed the frozen-lock build, local
signing, archive verification and self-test, real CPU/Metal scientific parity,
and Rust archive/install/activate/rollback/removal lifecycle. Archive SHA-256 is
`d1d39e44a24de0ef4808df27225eb8a9834c0e10d4a40a2171e2c76140231e81`;
archive size is `687615488` bytes, installed size is `1863803480` bytes and peak
additional runner disk is `3340029952` bytes. The measured catalog disk plan is
`7065208018` bytes within the retained `8589934592`-byte floor. Metal parity
passed at cosine `0.9999999999999255`, maximum absolute difference
`5.960464477539063e-8`, and mean absolute difference
`1.3292677181198087e-8`; output and provenance contracts passed. Compact
artifact `8838446367` has digest
`sha256:b891dc6cccc26f91082f0d2fb13191fe3561c701c8280944e55b147612d1404a`;
preflight artifact `8838334277` has digest
`sha256:21663e80b3c6d1db53eefb5b039f7b0b1e7d4d13d9fb754964ed9cedda41984b`.
The ephemeral runner deregistered and its marked root was removed.

All five scGPT inputs are now canonical schema-v2 scrolls with complete native
lifecycle evidence. P5.4 block 1 is complete. The next one-target continuation
is block 2 target `geneformer-v1-10m-macos-arm64-metal`; do not start another
Geneformer or UCE target concurrently.

**Block 2 first-target preparation:** `geneformer-v1-10m-macos-arm64-metal` is
now a single canonical v2 scroll. The old schema-v1 uv descriptor,
`requirements.in` and `requirements.lock` are removed. Pixi 0.73.0 resolves
Python 3.11.15, PyTorch 2.8.0 and the preserved scientific dependency versions
entirely from conda-forge, with no PyPI or source-build path. Committed lock
SHA-256 is
`3e9841b2296656458715aa1276ece999b2bdfe4566e8dfdf77c0e29496c4d19f`;
published `scrollcase@0.4.11` generated and checked the matching 161-package v2
audit. The target now routes only native work to the
`liatir-macos-arm64-heavy` self-hosted runner.

Native-lifecycle run `30766478916`, jobs `91546006154` and `91546052389`, passed
at clean commit `6fe5a077da16c0c2f9abe8c6986e3639aaa98650` on ephemeral
self-hosted runner `liatir-macos-heavy-1785703738-15134`. It completed frozen
installation, local signing, archive verification and self-test, real CPU/Metal
scientific parity, and Rust install/activate/rollback/removal lifecycle. The
payload is `2179953895` bytes; the `672331169`-byte archive has SHA-256
`3ce6e4baecae7a641da6a6ecd2a71148f3d9c62f44e42fd5baa04a8110b0ae62`.
The real 4-cell by 128-gene validator produced finite `[4, 256]` embeddings at
maximum absolute error `8.121132850646973e-7` and minimum cosine similarity
`0.9999999403953552`; output and provenance contracts passed. Peak additional
runner disk was `4608819200` bytes. Compact artifact `8839187730` has digest
`sha256:37d124cefe4fe48e3473ef9dc037d1001ac163c0e3cbcd5d2d7d767ddf53f382`;
preflight artifact `8839102700` has digest
`sha256:4ebab7ef836ab92c921fb9051d9af36dc7cf2bb4df9f640e806f3f18535e7d2f`.
The runner deregistered and its marked root was removed. This target is complete;
the next one-target continuation is `geneformer-v1-10m-linux-x86_64-cpu`.
No production signing, publication, promotion or mutation of the published
`1.0.0-beta.1` objects occurred.

**Block 2 second-target preparation:** `geneformer-v1-10m-linux-x86_64-cpu`
is now a canonical schema-v2 scroll backed by pixi 0.73.0. The legacy uv
`recipe.json`, `requirements.in` and `requirements.lock` are removed. The
committed conda-forge-only lock resolves Python 3.11.15 and PyTorch 2.8.0 CPU
with SHA-256
`551716a80946450c076c9c0184458b5a29da855117b13a9da98129f4a19e16b4`.
Published `scrollcase@0.4.11` generated and rechecked the reviewed 171-package
conda licence audit with no unresolved licence. Catalog identity, asset hashes
and immutable publication metadata are preserved; its dependency audit field
and caller paths now point only at the v2 input. A conservative 12 GiB native
build floor is retained until measured evidence replaces the estimate.

Native-lifecycle run `30872534594`, jobs `91877296883` and `91877388153`, passed
at clean commit `6a26a352284e9bb177391b12a3e4f160b3a3c2e3` on ephemeral
self-hosted runner `liatir-linux-selfhosted-1785811312-359`
(`RUNNER_ENVIRONMENT=self-hosted`). It completed the frozen-lock installation,
local signing, archive verification and self-test, real CPU scientific
validation, and the Rust install/activate/rollback/removal lifecycle. The
committed lock hash `551716a8…` was reproduced unchanged. The clean build
produced archive SHA-256
`ead3546f6e39fb5d4e513ad9dbd33374a80e208566eef4e352152180cf320c6e`,
archive size `1232703132` bytes and installed size `3959042677` bytes in
`310019` ms on pixi 0.73.0, Python 3.11.15 and PyTorch 2.8.0 CPU
(`transformers-4.44.2-cpu`). The real 4-cell by 128-gene fixture produced finite
`[4, 256]` embeddings at maximum absolute difference `8.67992639541626e-7` and
minimum cosine similarity `0.9999999403953552`, with CPU baseline parity, output
and provenance contracts all passing. Peak additional runner disk was
`6244888576` bytes. The catalog disk plan is now the measured
`3959042677`/`1232703132` pair, giving a calculated plan of `9530222601` bytes
within the retained `12884901888`-byte floor. Compact artifact `8878554308` has
digest
`sha256:a519d319396ea184086fe8dacbb7515ace9b7c912dbda6f59ab5321c1dcc1b80`;
preflight artifact `8878372668` has digest
`sha256:38c5429cc73cdf3185bcd87cf857859d078d18bfb4e986912b2884295965e556`.
The runner deregistered, its marked root was removed and the repository
self-hosted inventory is empty. This target is complete; the next one-target
continuation is `geneformer-v1-10m-windows-x86_64-cpu`. No production signing,
publication, promotion or mutation of the published `1.0.0-beta.1` objects
occurred.

**Block 2 third-target preparation.**
`geneformer-v1-10m-windows-x86_64-cpu` is now a canonical schema-v2 scroll
backed by pixi 0.73.0. The legacy uv `recipe.json`, `requirements.in` and
`requirements.lock` are removed. The committed conda-forge-only lock resolves
Python 3.11.15 and PyTorch 2.8.0 `cpu_mkl` with SHA-256
`17aaea6dd7c4fdca8d37c6898c82020c210b21458f53d22d03b2f3b3324438ab`;
`pixi lock --check` reports it already up to date, and it contains no PyPI or
source-build entry. Published `scrollcase@0.4.11` generated the reviewed
150-package conda licence audit with `audit --write` and then rematched it
without `--write`; every package carries a declared licence. The uv-era manual
`array-api-compat` licence notice is translated away because conda-forge ships
that package with its own declared licence, recorded in the generated
`THIRD_PARTY_NOTICES/conda-distributions.json` that the self-test now requires
in place of `python-distributions.json`. `pythonEntryPoint` remains
`venv/python.exe`, and `boxId`, `modelId`, `runtimeId`, version
`1.0.0-beta.1`, source revision, compatibility, asset URLs, sizes and SHA-256
values are preserved byte-for-byte. The catalog target keeps its `published`
status and immutable publication metadata; only `dependencyLockSha256`, the
move from `dependencyLicenseAudit` to `condaDependencyLicenseAudit` and the
disk plan change. The Geneformer caller workflow now watches the
v2 directory. Local gates green: frozen lock check, audit write/recheck,
`runtime-box:catalog:check`, the focused Runtime Box catalog/cost-control/conda
licence/target-identity/adapter suites, full `test:verify`, the internal docs
build and `git diff --check`.

Native-lifecycle run `30915003666`, jobs `92010824861` and `92011005131`,
passed on the first dispatch at clean commit
`d3379778a2cdfb3bd110bf5bc4028d8cf3a9a7f7` on ephemeral self-hosted runner
`liatir-windows-selfhosted-1785850729-16884` (`RUNNER_ENVIRONMENT=self-hosted`,
label `liatir-windows-selfhosted`, no GPU). It completed the frozen-lock
installation, local ephemeral signing, archive verification and self-test, real
CPU scientific validation, and the Rust install/activate/rollback/removal
lifecycle; the uv and POSIX-pixi steps were correctly skipped. The committed
lock hash `17aaea6d…` was reproduced unchanged. The clean build produced archive
SHA-256
`afc48a00f1f6cfe3b557069c8d77169f95327b257887c50a1c32126eb5a4a684`,
archive `493253025` bytes and installed `1824134154` bytes in `691133` ms on
pixi 0.73.0, Python 3.11.15 and PyTorch 2.8.0 CPU
(`transformers-4.44.2-cpu`). The real 4-cell by 128-gene fixture produced finite
`[4, 256]` embeddings at maximum absolute difference `4.470348358154297e-7` and
minimum cosine similarity `1`, with CPU baseline parity, output and provenance
contracts all passing. Peak additional runner disk was `3558084608` bytes, so
the catalog disk plan now carries the measured installed/archive pair, giving a
calculated plan of `6655863971` bytes inside a reduced `8589934592`-byte floor
that matches the sibling scGPT Windows CPU target. Compact artifact `8895358103`
has digest
`sha256:4d30dc73a743178db8c73533d5be6408bece11fc4af0570f12a57a3130fd85fc`;
preflight artifact `8894675619` has digest
`sha256:48a8dc44ae7cf84946cd92943f5575d7cfb78f868e69aff3ceef15d452665f55`.
The runner deregistered, its marked root was removed, diagnostics were retained
and the repository self-hosted inventory is empty. This target is complete; the
remaining block-2 work was UCE, closed on 2026-08-06, and the CUDA identity
decision stays in block 3.
No production signing, publication, promotion or mutation of the published
`1.0.0-beta.1` objects occurred.

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

### Geneformer CUDA — resolved 2026-08-04: both targets removed, no successor

The maintainer confirmed Liatir is **not released**, which removes the
constraint this section was built around. With no shipped client, neither CUDA
12.4 identity has installed users to protect, so the frozen-legacy design — a
new catalog status meaning "still installable but no longer buildable" — is
unnecessary. Both targets are deleted outright:

- `linux-x86_64-cuda12.4` (was `published`);
- `windows-x86_64-cuda12.4` (was `buildable`, never built or dispatched).

**No CUDA successor is introduced for Geneformer.** The decision rests on the
only direct CPU-versus-CUDA comparison this repository holds, from the recorded
evidence of the same validator on the same model:

| Target | `scientific.elapsedMs` |
| --- | --- |
| `linux-x86_64-cpu` | 11 073 |
| `linux-x86_64-cuda12.4` | 15 104 and 14 573 |
| `windows-x86_64-cpu` | 16 292 |

CUDA was **slower**. At 10M parameters the GPU never earns back its
initialisation cost, so a CUDA box for this model would add a runner class, a
recipe, a licence audit and a paid validation run in exchange for a regression.
CUDA capability itself is unaffected: scGPT keeps `linux-x86_64-cuda12.9` and
`windows-x86_64-cuda12.8`, both natively proven, so the GPU path stays
exercised. This is exactly the per-model judgement the CPU-gating policy in
`current-project-status.md` prescribes.

**The residual gap, stated honestly.** Those timings come from the pinned
4-cell by 128-gene validator fixture, so they measure fixed overhead, not
throughput on a realistic dataset. They prove CUDA does not help at that scale;
they do not by themselves prove CPU stays comfortable on a large study. The
repository's own CPU-gating rule already demands "a realistic reference dataset
within an acceptable wall-clock threshold" measured from amortized throughput,
and that measurement has never been recorded for Geneformer.

Therefore: **before Geneformer is presented to users as CPU-only, a zero-cost
local CPU throughput measurement on a realistic cell count is required.** If it
lands within the UX threshold, this decision stands unchanged. If it does not, a
CUDA successor is added then — and because both 12.4 identities are gone, that
addition is purely additive, with a fresh target ID and no identity conflict.
The decision is cheap to reverse by construction.

#### The measurement was taken on 2026-08-05, and it fails

**The no-successor decision above does not survive it.** Measured on Apple
Silicon against a locally built, locally signed v2 box — the real
`geneformer-v1-10m/macos-aarch64-metal` scroll on pixi `0.73.0`, verified with
`verify --self-test` — running the shipped product script
(`frontend/src/lib/tools/ai/python-scripts/geneformer-embedding.ts`) under
`LIATIR_AI_FORCE_CPU=1`, batch size 16, 1024 genes per cell:

| Cells | Wall clock | Per cell | Peak RSS |
| --- | --- | --- | --- |
| 500 | 74.8 s | 149.6 ms | 3.9 GB |
| 2000 | 321.9 s | 160.9 ms | 4.2 GB |

Cost is linear in cells at roughly **160 ms per cell**, so a realistic study
extrapolates to about **27 minutes for 10 000 cells** and **2.2 hours for
50 000**. The CPU-gating policy in `current-project-status.md` says in terms:
"When CPU execution would take hours, or is otherwise too slow to be useful, the
CPU box is not shipped for that model."

This also retires a claim the repository has been repeating without evidence.
"Geneformer V1 10M remains CPU-supported because it is trivially fast on CPU" is
true only of the 4-cell validator fixture. At realistic scale it is false, and
the earlier CPU-beats-CUDA reading (11 073 ms against 15 104 ms) measured
nothing but fixed startup overhead — exactly the residual gap recorded above,
now fired.

**Consequences, none of which this section may decide on its own:**

1. Geneformer must not be presented to users as CPU-only. Either a CUDA
   successor is built, or the product states honestly that Geneformer needs
   Metal or a GPU for realistic datasets;
2. the same question is open for the *published* CPU targets
   `linux-x86_64-cpu` and `windows-x86_64-cpu`. They are natively proven and
   scientifically valid; the doubt is whether they are *useful*, which is a
   product decision, not a validation one;
3. the Metal number is unmeasured. It is the obvious comparison and would say
   whether macOS is fine while CPU-only platforms are not;
4. a Geneformer CUDA successor is still purely additive, since both 12.4
   identities were deleted. Nothing about the deletion needs reversing — only
   the "no successor" half of the decision.

Measurement caveat, stated so it is not over-read: this is one Apple Silicon
host with a synthetic 1024-gene fixture and batch size 16. It establishes the
order of magnitude, not a tuned figure. A batch-size sweep or a real reference
dataset could move it by a factor, but not by the factor of ten that would be
needed to rescue the CPU-only claim.

Removed together with the two targets: their catalog entries, uv recipes,
licence audits, evidence records, signer-policy entries, release-workflow
options, `@liatir/core` published-target candidates, and the legal record's CUDA
sections. The generic CUDA cases in `target-id-contract.json`,
`runtime_boxes.rs` tests, signer policy tests and cost-control tests are
**kept**: they exercise the CUDA target-ID rule itself, not a Geneformer target.
The two catalog-reading tests were repointed at scGPT's real
`linux-x86_64-cuda12.9`, preserving GPU runner-contract and driver-floor
coverage rather than deleting it.

#### The CUDA successors were added 2026-08-05, and Linux is validated

Consequence 1 above is now acted on: Geneformer has two additive CUDA
successors, `linux-x86_64-cuda12.9` (commit `d47f277`) and
`windows-x86_64-cuda12.8` (commit `53c3a21`). Neither reuses a deleted 12.4
identity. Both carry a reviewed v2 scroll, a resolved pixi lock and a licence
audit, and the caller workflow accepts both target IDs. The accelerator split
recorded in `current-project-status.md` holds: conda-forge `pytorch 2.8.0` is
`cuda129` on linux-64 and `cuda128` on win-64, because win-64 has no 12.9 build.
Both locks were checked statically before any runner was allocated —
`pytorch-2.8.0-cuda129_mkl_py311_h974e97e_302` for Linux and
`pytorch-2.8.0-cuda128_mkl_py311_h889696f_302` for Windows, with no `cpu_mkl`
build in either — so the "system-requirements did not bite" failure mode was
excluded at zero cost rather than discovered on a GPU runner.

**Linux CUDA 12.9 passed the complete native lifecycle** in run `31048217909`,
preflight job `92448923182` and native job `92449033200`, on runner
`liatir-linux-cuda-selfhosted-1785964781-457` at commit
`53c3a215e0b6aab32965273a1d755b86c0a3a198`. The pixi lock stayed byte-identical
at SHA-256
`2f2e22e0dedbde6a2fdfa02f52c048f61b585351b2eb3a752e8c79b1bab35ae4`.
The RTX 4060 Ti build (compute capability `8.9`, driver `610.62`, reported CUDA
compatibility `12.9`) ran on pixi `0.73.0` and Python `3.11.15` and produced
archive SHA-256
`2065bf14c7c6e0121ae1806716558d42e6c7137b307acbfca75386f18ac66819`,
archive size `17118987830` bytes and installed size `28120935919` bytes.
Scientific parity passed against the same-lock CPU baseline at minimum cosine
`0.9999999403953552` and maximum absolute difference `6.593763828277588e-7`
(CPU baseline `8.67992639541626e-7`), with peak VRAM `106767872` bytes, finite
values, and output and provenance contracts green. Build took `1617893` ms and
the scientific forward `16863` ms. Compact artifact `8948374199` and preflight
artifact `8947316103` preserve the proof.

**The disk plan was estimated wrong by a wide margin, and is now measured**
(commit `9063053`). The authored placeholders were `12000000000` installed and
`5000000000` archive; the real figures are `28120935919` and `17118987830`, so
the conda CUDA substrate dominates rather than the 10M-parameter weights, and
this target sits in the same size class as scGPT's `linux-x86_64-cuda12.9`, not
near Geneformer's own Metal target. Substituting the measurements raises the
calculated peak to `48504658717`, which the previous `25769803776` floor could
not hold: the build actually consumed `45849923584` additional bytes and
survived only because the host had far more free. The floor is now
`60129542144`, matching scGPT's Linux CUDA 12.9 target on the same runner
profile and staying under that profile's `68719476736` bootstrap requirement.
This is the same hazard the UCE scoping below warns about — re-measure the plan
from the native run instead of adjusting an estimate by hand.

**What this run does and does not settle.** It settles that Geneformer has a
working, scientifically valid CUDA path on Linux. It does *not* re-open the
CPU-versus-CUDA throughput comparison: the `16863` ms scientific figure comes
from the same pinned 4-cell by 128-gene fixture that measures fixed overhead, so
it is not comparable to the `~160` ms per cell CPU throughput measured on a
realistic cell count. That CPU measurement, not this run's elapsed time, is what
justifies a CUDA box for this model.

**The Linux-first gate does not read run results, only catalog status.**
`validateWindowsCudaPrerequisite` checks the Linux target's `status` field, and
no run updates that field automatically, so a passing Linux run does not open the
gate on its own: `nativeCiEnabled` could not go true on
`windows-x86_64-cuda12.8` while Linux was still recorded `buildable`. Recording
Linux as `native-lifecycle-validated` — the status its run had earned, and the
one all four proven scGPT targets carry with no `publication` object — is what
opened it (commit `5960026`). `resolve --native-requested true` then reported
`native_eligible` for Windows, checked locally before any runner was allocated.

**Windows CUDA 12.8 then passed the complete native lifecycle** in run
`31057320891`, preflight job `92477540997` and native job `92477608909`, on
runner `liatir-windows-cuda-selfhosted-1785973279-480` at commit
`5960026f93a65d59a493942d46a620fd48920dd9`, with its lock byte-identical at
SHA-256
`ce2e51ed2985b58607f84082ae7362811b9adc613b4d311e171f5fb06b92b5ec`.
The backend resolved to `transformers-4.44.2-cu128`, confirming the per-OS pin:
win-64 has no 12.9 build. On the same RTX 4060 Ti, pixi `0.73.0` and Python
`3.11.15` produced archive SHA-256
`cee651ca0b30f4d6a9b7329dbddc247412c98db199ba3ef0d63a7d86ade2e0c2`,
archive size `4304659539` bytes and installed size `7398569837` bytes. Parity
passed at minimum cosine `1` and maximum absolute difference
`1.4901161193847656e-6`, peak VRAM `106767872` bytes — identical VRAM to Linux,
as the same model and fixture should give. Build took `1263921` ms and the
scientific forward `59881` ms. Compact artifact `8951371593` and preflight
artifact `8950746395` preserve the proof.

**Windows needed no floor change, and that asymmetry is the point.** Its
measured `7398569837` installed and `4304659539` archive put the plan at
`14967964344`, inside the retained `25769803776` floor with `10801839432` bytes
spare, against a real peak of `11986161664`. Linux needed `60129542144` for the
same model: the win-64 conda CUDA substrate is roughly a quarter the size of the
linux-64 one, which is why one estimate held and the other missed by a wide
margin. Neither number was predictable from the other, so both had to be
measured rather than shared.

One operational hazard is worth carrying forward: the Windows launcher rejects a
runner root whose relocatable conda prefix would exceed 150 characters, and the
natural name `C:\liatir-runners\geneformer-win-cuda128` overflows it at 152. This
run used `C:\liatir-runners\gf-win-cuda128` (prefix 144). That limit is the same
one an earlier scGPT Windows attempt hit after a full build.

Both CUDA targets are now `native-lifecycle-validated` and **unpublished**. No
production signature, publication, channel promotion or release occurred for
either; `published` remains a state neither has reached, held only by
`macos-aarch64-metal`, which this work did not touch. Both ephemeral runners
deregistered and both marked runner roots were removed, with diagnostic logs
retained beside them.

### UCE migration scoping — measured 2026-08-05

`uce-4layer-macos-arm64-metal` is the last block-2 target and is still the only
schema-v1 uv recipe left in `runtime-boxes/recipes/`. Everything else in that
directory is now gone; three empty leftover directories were removed. Measured
inputs before starting:

- 6 assets totalling `9.12 GB`, dominated by `4layer_model.torch` (3.40 GB),
  `all_tokens.torch` (2.98 GB) and `protein_embeddings.tar.gz` (2.74 GB);
- catalog disk plan: `10142871337` installed, `8862120348` archive,
  `3221225472` margin — about 22 GB before the pixi environment and the
  conda-pack intermediate.

**A local build is not viable on the maintainer's machine.** Free space measured
26–28 GiB during this session, against ~22 GB of plan plus the packing
intermediate. UCE keeps its `macos-arm64-heavy` self-hosted runner, whose Gate 9
record required a 35 GiB bootstrap floor. Preparation — v2 scroll, `pixi.toml`,
resolved lock, licence audit — is local and cheap because `pixi lock` resolves
metadata without downloading packages.

Three migration hazards this target carries that earlier ones did not:

1. **12 `venv/` prune paths.** `ensurepip`, `distutils`, `idlelib`, `lib2to3`,
   `pydoc_data`, `tkinter`, `pip`, `pkg_resources`, `setuptools` and
   `torch/include`. This is exactly the inherited prune list that removed locked
   `sympy` from scGPT macOS and failed the real forward after build, self-test
   and archive verification had all passed. The cross-target regression added
   then already forbids `venv/` prune paths, so they must all go — which will
   grow the payload past the current `10142871337`-byte plan. Re-measure the
   disk plan from the native run rather than adjusting the estimate by hand.
2. **`assetArchives` with `removeAfterExtract`.** The source zip and the
   protein-embedding tarball expand in place. `0.7.0` added `uncompressedPaths`
   precisely for trees an `assetArchives` entry expanded into, but Liatir is
   pinned at `0.4.11`, so on the current pin those expanded bytes are deflated
   again at no benefit. That is a P5.4V argument, not a blocker here.
3. **PyTorch moves from `2.1.1` to the conda-forge `2.8.0` substrate.** Every
   other migrated target held its scientific baseline because the version was
   already aligned; UCE's is not. Treat its Metal parity as a fresh baseline
   requiring review, not as a reproduction of the published `1.0.0-beta.1`
   numbers.

The published `1.0.0-beta.1` UCE objects, their evidence record and the beta
channel stay immutable. Per the immutable-version rule, a pixi rebuild cannot
replace those bytes under the same version.

#### UCE authoring is done (2026-08-06, `4f84c34`)

Authored directly on `0.7.1`, not migrated to `0.4.11` and rebuilt — that
inversion is the whole point of running P5.4V first. UCE is now a single v2
scroll at `runtime-boxes/scrolls/uce-4layer/macos-aarch64-metal/`, and the uv
recipe is gone: the resolver refuses a target that has both authoring inputs, so
this is one commit, not two.

Lock SHA-256
`a539412003c6ac355da2ce1dca05b7aa76ef3274a71150839c0b3396ae824a98`, 194 conda
packages, all conda-forge, no PyPI or source-build escape hatch. Python resolves
to `3.11.15`, matching the sibling macOS targets. The 194-package licence audit
has no undeclared licence, and its copyleft set is the class the two proven
macOS boxes already ship — `libgcc`/`libgfortran` under GPL-3 with the GCC
runtime exception, `readline`, `mpfr` — plus `gmp`, `gmpy2` and `mpc`, which are
LGPL-3 or dual-licensed. No new exposure.

All three hazards above are resolved rather than deferred:

1. **The 12 `venv/` prune paths are gone**, leaving only the seven `source/UCE`
   ones. The regression that forbade them was scoped to scGPT; it is now
   cross-model, so the next box cannot pay a native run to rediscover the rule.
2. **`uncompressedPaths` now names
   `model-cache/uce/model_files/protein_embeddings`** — this is the argument that
   was "a P5.4V argument, not a blocker", and P5.4V has since happened. The
   float tensors inside the 2.74 GB tarball are stored rather than deflated a
   second time. `source/UCE` keeps deflating, because it is Python.
3. **PyTorch moves to `2.8.0`.** conda-forge has no `2.1.1` for this substrate,
   and the lock resolves the same
   `pytorch-2.8.0-cpu_generic_py311_hf0c13c8_2` build that carries Metal for
   scGPT and Geneformer. Metal parity for UCE is therefore a fresh baseline
   requiring review, not a reproduction of the published `1.0.0-beta.1` numbers.

The scientific pins carry over exactly: numpy `1.26.4`, scipy `1.14.1`, pandas
`2.2.2`, tqdm `4.66.5`, scanpy `1.10.2`. `accelerate`, `requests` and `urllib3`
are left to the solver — their uv pins (`0.24.0`, `2.25.1`, `1.26.6`) predate
this framework by years and would constrain the solve without protecting a
result. They resolve to `1.14.0`, `2.34.2` and `2.7.0`.

#### UCE is natively proven (2026-08-06, run `31070450837`)

**Passed on the first dispatch**, every step, at clean commit `07e01f6` on
ephemeral self-hosted runner `liatir-macos-heavy-1785989332-65951`: frozen build,
signature and archive verification, self-test, the real Metal scientific
validator, and the Rust install/activate/rollback/removal lifecycle. Preflight
job `92517133620`, native job `92517203321`, compact artifact `8955681270`,
preflight artifact `8955434558`. The runner deregistered and its marked root was
removed.

Archive SHA-256
`d08f7c80e00ee82686b5d5f1b5863f650cc8281b9a217928c095ea26699fe29f`. The whole
job took 16 minutes.

**Metal parity on the fresh 2.8.0 baseline is excellent.** torch `2.8.0`, backend
`cpu-reference-and-metal` on an Apple M1, finite `[10, 1280]` embeddings, minimum
cosine similarity `0.9999999999904319` and maximum absolute difference
`4.0046870708465576e-7` against a `0.999` threshold — with the CPU baseline and
the accelerator forward both passing, and the output and provenance contracts
green. Moving off torch `2.1.1` cost nothing measurable.

**Both disk estimates were low, not high** (`2bbb40d`): installed `11169027146`
against `10142871337`, archive `9899283947` against `8862120348`. The calculated
peak rose to `33411870225` and no longer fit the `32212254720` floor, which is
now `36507222016`. It cannot be the round 35 GiB that would match the runner's
bootstrap floor, because the catalog requires a target's build floor to be
strictly under its runner's — otherwise a target could be registered that its own
runner may never accept. A regression pins that relationship now.

So the uncertainty this section refused to resolve by inference resolved against
the smaller payload: **dropping the twelve `venv/` prune paths grew the box more
than carried links and stored weights shrank it.** Real peak additional disk was
`22328135680` against `37116641280` free, so the plan remains conservative by
roughly half.

Status stays `published` against the immutable `1.0.0-beta.1` uv objects,
matching the two proven macOS siblings. Nothing was signed, published or
promoted.

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

## P5.4R — Adopt `scrollcase-consumer` in the Rust bridge

Recorded 2026-08-04. **Not started.** This phase splits
`src-tauri/src/bridge/runtime_boxes.rs` along the line the architecture table
already draws: **format verification** is delegated to the published crate,
**product lifecycle** stays in Liatir. It is implementation work, not a
dependency bump, and it is separate from P5.4V.

### Why it can precede the npm upgrade

`scrollcase-consumer` versions the *consumer* independently of the npm
*builder*. The crate reads schema v2, which is what pinned `scrollcase@0.4.11`
produces, and a release built before payload digests existed still prepares
normally — `src/prepare.rs:585` refuses a missing digest only inside the
explicit `verify_extracted_payload` operation, never on the install path. So
P5.4R runs against today's boxes and today's pin.

It also **de-risks P5.4V rather than depending on it**. The `0.6.0` payload-link
rule is the part of the upgrade that would otherwise require Liatir to
hand-write security-critical extraction logic; the crate already implements it
in `src/contract/links.rs` and `filesystem::validate_extracted_tree`. Adopting
the crate first means the pin upgrade stops being a Rust rewrite.

Sequencing is therefore a recommendation, not a constraint: prefer P5.4R before
P5.4V, and neither before P5.4 closes.

### Selected version

`scrollcase-consumer 0.1.2`, read from the sparse index on 2026-08-04. It adds
what `0.1.1` lacked for Liatir: `errorPatterns` now carries 28 contractual
strings including `unsupported-schema-version` → `"Unsupported schemaVersion 1"`,
with a matching `prepare` conformance case expecting `rejected` and
`destinationExists: false`. The suite is 66 cases. Re-read the exact immutable
identity immediately before adding the dependency, per the P5.2V.0 rule.

### The split

Replace — these are generic format rules with no Liatir behavior:

| `runtime_boxes.rs` today | Crate item |
| --- | --- |
| `trusted_keys` (420) | `trust::load_trusted_keys` → `Vec<TrustedKey>` |
| `verify_signed_payload` (462) | `trust::verify_signed_document`, `verify::inspect_release_document_with_keys` |
| `target_id` (745) | `contract::targets::box_target_id` |
| `safe_relative_path` (798) | `path::safe_relative_path` |
| `sha256_hex` (409) over files | `filesystem::sha256_file` |
| `verify_release_identity` (969) | `verify::inspect_box_archive`, `verify::inspect_archive_for` |
| `validate_extracted_box` (1077) | `verify::assert_box_manifest_agreement`, `contract::targets::assert_python_entry_point` |
| `extract_zip_with_expected_size` from `managed_bins` | `prepare::verify_and_extract_box`, `filesystem::validate_extracted_tree` |
| *(absent today)* | `prepare::attach_extracted_box`, `prepare::verify_extracted_payload`, `prepare::verify_required_assets` |

Keep — these are product decisions the crate explicitly disclaims ("selects no
channel, downloads nothing, updates nothing, knows about no registry"):

- `validate_control_url` (520), `fetch_control_document` (539),
  `select_channel_release` (943), `ensure_not_revoked` (1039), `installation_id`
  (923) and persisted anti-replay state;
- `current_host_capabilities` (575), `select_target_candidate` (604),
  `check_compatibility` (845) with `minLiatirVersion`, and the version helpers
  (592, 819, 831, 836);
- `dir_size` (1187), `runtime_box_disk_plan` (1210), `existing_dir_size` (1233),
  `validate_runtime_box_disk_plan` (1241), `ensure_runtime_box_disk_space` (1255);
- `activate_runtime` (1337), `rollback_root` (1281), `newest_rollback` (1288),
  `prune_rollbacks` (1311), `rollback_runtime` (1606), `remove_runtime_files`
  (1654);
- the three `#[tauri::command]` entry points and all Jobs/Results/provenance
  integration.

Two items need a decision rather than a mechanical move:

1. **`run_self_test` (1118).** Execution belongs to `run::run_extracted_box`,
   but Liatir's version captures self-test stderr specifically because opaque
   `exit code 1` failures cost roughly nine Windows release runs during Gate 8.2.
   Do not lose that diagnostic. Evaluate whether `RunOptions` stdio capture
   covers it before deleting anything.
2. **`runtime-boxes/target-id-contract.json`.** P5.1 keeps it as a tracked
   compatibility fixture with the Rust mirror checked against it. Once Rust calls
   `box_target_id`, that check becomes a drift check between the crate and the
   fixture, exactly as the TypeScript side already works. Keep the file; change
   what the test asserts.

### Ordering rule inside the install path

The crate makes verification callable before extraction, and the install path
must use that ordering: parse and verify the signed release, **then** run
Liatir's revocation and anti-replay checks, **then** check the disk plan,
**then** extract. Do not extract a revoked or replayed box and reject it
afterwards.

Schema-v1 detection stays Liatir's, from the product-owned installed-state
record as an integer, per P5.2V.2. The crate's pinned
`unsupported-schema-version` string is the last line of defence, not the
detector, and Liatir must not branch on error text.

### P5.4R work order

1. add exact `scrollcase-consumer = "=0.1.2"` to `src-tauri/Cargo.toml`; confirm
   resolution and that the transitive licence footprint passes audit;
2. add integration regressions for the **call order** Liatir owns — verify,
   then revocation and anti-replay, then disk plan, then extract — since that
   ordering is Liatir's responsibility and no upstream test covers it;
3. replace the table's left column one row at a time, keeping
   `cargo test runtime_box` green between rows;
4. delete the superseded Liatir implementations only once no caller remains, and
   never in the same commit that first exercises the crate path;
5. re-run the Rust archive, activation, rollback, removal and explicit
   v1-rejection regressions.

#### The conformance suite is not a Liatir gate

Recorded 2026-08-04. `consumer-conformance.json` ships inside the crate but is
reachable only from the crate's own `tests/` through
`include_str!("../fixtures/…")`. There is no public Rust accessor, and a
downstream crate cannot `include_str!` from a dependency's source tree.

This does not matter, because the reasoning that made the suite valuable stops
applying at the moment of delegation. While Liatir owned a second
implementation, the suite was the cheap oracle proving the two agreed. Once
`runtime_boxes.rs` calls the crate, running those 66 cases in Liatir would test
upstream code that upstream CI already tests, and would prove nothing about
Liatir.

What Liatir must test after delegation is its own integration: the call order in
step 2, the product lifecycle, and explicit v1 rejection. Do **not** vendor a
copy of the fixture to satisfy a gate that no longer earns its place. If a
future need for the suite appears, the vendor-neutral upstream request is a
public accessor for the fixture bytes, not a copy in this repository.

### P5.4R step 1 record — 2026-08-04

Exact `scrollcase-consumer = "=0.1.2"` is in `src-tauri/Cargo.toml`. `cargo
fetch` resolved and `cargo check` compiled the whole tree with it; the 56
warnings are pre-existing and unrelated.

**The "no duplicate majors" adoption condition is not met, and cannot be.** The
crate requires `zip ^8.6`, `ed25519-dalek ^3.0`, `sha2 ^0.11` and `base64
^0.23`, while `src-tauri` uses `zip 2.4.2`, `ed25519-dalek 2.1.1`, `sha2 0.10`
and `base64 0.22.1`. Those are incompatible semver majors, so Cargo now builds
both copies of each, plus the transitive `digest 0.10/0.11` and `crypto-common
0.1/0.2` pairs.

Aligning them is not available as a fix inside P5.4R. Liatir's own copies are
not Runtime Box code and survive the migration: `zip` is used by `quenta`,
`lia_plugins`, `snpeff`, `diagnostics` and `managed_bins`; `ed25519-dalek` by
`lia_plugins` for signed `.lia` bundle verification; `sha2` by `managed_bins`
and `lia_plugins`; `base64` by `fs`, `plugin_files`, `diagnostics` and
`lia_plugins`. Upgrading them would mean touching plugin signature verification,
which is a separate dependency task with its own risk.

The condition is therefore **waived for P5.4R** with the cost stated: a larger
binary carrying two ZIP, two Ed25519 and two SHA-2 implementations. The tree
already carried duplicate `zip` (2.4.2 and 4.6.1) and `rustix` (0.38 and 1.1)
before this change, so this is a larger instance of an existing condition, not a
new principle. Measure the release-binary delta before deciding whether a later
dependency-alignment task is worth its own risk; do not infer the cost.

### P5.4R step 3 record — 2026-08-04, first slice

The security core is delegated. Replaced in
`src-tauri/src/bridge/runtime_boxes.rs`:

- the local `TrustedKey`/`SignedDocument`/`DocumentSignature` structs are gone;
  the crate's types are used directly. Liatir's checked trust roots already
  carry `publicKeyPem` beside `publicKeyBase64`, so they deserialize into
  `trust::TrustedKey` unchanged, and `trusted_keys()` keeps every Liatir-owned
  rule — production anchors, debug-only development key and env-var key file,
  compile-time `option_env!` rotation, and fail-closed on an empty set;
- `verify_signed_payload` now calls `trust::verify_signed_document`. This also
  strengthens the check: the crate uses `verify_strict`, which additionally
  refuses small-order keys and non-canonical signatures;
- `RuntimeBoxTarget` is a type alias for `contract::targets::BoxTarget`, which
  carries `deny_unknown_fields` — closing one of the three unknown-field gaps
  recorded above;
- `target_id` delegates to `box_target_id`, and `safe_relative_path` to the
  crate's rule, which also covers Windows prefix and drive-relative cases a
  `Component::Normal` walk does not see on Unix. Both keep Liatir's product
  wording, because these messages can reach a non-technical user;
- the now-dead local `sha256_hex` was removed. `base64`, `ed25519_dalek` and the
  `Component` import are no longer needed by this module.

**Schema-version detection stays Liatir's.** `verify_signed_payload` compares
the parsed `schemaVersion` integer against `RUNTIME_BOX_SCHEMA_VERSION` *before*
handing the document to the crate, so the unsupported-format state that drives
product-owned cleanup never depends on matching an upstream error string — even
now that `unsupported-schema-version` is a pinned pattern.

Green: `cargo check`, `cargo clippy` with no new `runtime_boxes.rs` finding,
`cargo test runtime_box` at 14 passed / 2 ignored, `runtime-box:test:foundation`,
`runtime-box:catalog:check`, `runtime-box:signer:check` at 15/15, and
`test:verify` at 6/6 suites with 227 unit tests. The changed surface is directly
covered by `accepts_scrollcase_contract_compatibility_fixtures` (real Liatir
signed fixtures), `matches_shared_runtime_box_target_id_contract`,
`rejects_schema_v1_release_manifests` and the large-archive foundation fixture.

### P5.4R step 3 record — 2026-08-04, second slice

Extraction now goes through `archive::extract_zip_archive`. This closes the gap
recorded above as "hostile-archive defense is generic, not box-specific": the
package refuses encrypted entries, special entries, entry collisions, links that
do not resolve to a file inside the payload, and entries written through a link.
`managed_bins::extract_zip_with_expected_size` is off the Runtime Box path and
now serves only its original managed-binary callers.

Both Rust archive fixtures were repointed at the production path. The
large-archive fixture mattered most: it sits on the 4 GiB Zip64 boundary, and
the largest published box is a `17098121591`-byte CUDA archive, so Zip64 has to
be proven through Scrollcase rather than only through the helper.

**Behavioural change, stated rather than buried.** The old helper rejected a
declared-size mismatch *before* writing anything; the check is now
`dir_size` *after* extraction. The archive is hash-verified before extraction
and the disk plan is enforced beforehand, so a hash-matching archive whose
extracted size disagrees with its own signed release is an internal
inconsistency rather than an attack. The cost is that such a box is written out
before being rejected. The corresponding pre-extraction assertion was removed
from the large-archive fixture rather than left testing a helper the path no
longer uses.

**`verify_and_extract_box` is deliberately not adopted.** Its signature takes a
release-document path and a trust-key file path, while Liatir holds the verified
release in memory and compiles its trust anchors into the binary precisely so a
user-editable key cannot defeat signing. Satisfying that signature would mean
writing trust keys to disk, which inverts the intent. The same reasoning applies
to `attach_extracted_box`; adopting it would require the same on-disk trust
file. This is a genuine boundary mismatch, not a deferral — if it is ever worth
closing, the vendor-neutral upstream shape is an entry point accepting
already-verified release bytes and an in-memory key set, and that is a
maintainer decision, not a P5 dependency.

Green on this slice: `cargo clippy` with no new `runtime_boxes.rs` finding,
`cargo test runtime_box` 14 passed / 2 ignored, `runtime-box:test:foundation`
(the Zip64 fixture, now through Scrollcase),
**`runtime-box:test:native` end to end** — real key generation, two builds,
external signer, separate verify with self-test, Node consumer extraction and
execution, Rust archive and activation/rollback/removal, and explicit v1
rejection — plus `runtime-box:catalog:check` and `test:verify` at 6/6.

The native fixture reproduced `installedSizeBytes` `257776217` exactly against
the pre-change baseline, which is the meaningful invariant: the extracted tree
is byte-identical. The archive SHA-256 differs between the two runs only because
each build stamps the current commit into provenance.

The local toolchain was installed for this slice: pinned pixi `0.73.0` and
conda-pack `0.9.2` under `.scrollcase/toolchain`, now git-ignored. The
`toolchain` block that `scrollcase init` offers to write into
`scrollcase.config.json` was **not** taken: it records a host-specific asset
checksum, while CI provisions its own pixi from the scroll's `pixiVersion`
under the workflow pin `runtime-box-ci.mjs` already enforces. Note that
`scrollcase init --help` runs `init` rather than printing help; the example
scroll, `SCROLLCASE.md`, `box-entrypoints/` and `consumer-templates/` it created
were reverted, and `--no-example` avoids them.

**Still open after both slices:**

1. `prepare::verify_extracted_payload` and `verify_required_assets` remain
   unused. The first needs a release carrying `payloadDigest`, which only
   `0.7.0` builds emit, so it belongs to P5.4V rather than here;
2. the call-order regression pinning verify → revocation/anti-replay → disk →
   extract. The ordering is already correct in the install path, but nothing
   fails if a later change reorders it;

**Superseded, from the first slice:**

1. the extraction path. `verify_release_identity`, `validate_extracted_box` and
   `managed_bins::extract_zip_with_expected_size` are unchanged, so
   `prepare::verify_and_extract_box`, `attach_extracted_box`,
   `verify_extracted_payload` and `verify_required_assets` are not yet used.
   That is the structural half and it carries the install-path reordering, so it
   gets its own slice — the plan forbids first exercising a new path and
   deleting the old one in one change;
2. `runtime-box:test:native` could not run on this host: it builds a real box
   and requires pixi 0.73.0, which is not installed. It exercises the extraction
   path, which this slice did not touch, so it does not gate what changed here —
   but it must pass before the extraction slice closes;
3. the call-order regression from step 2 belongs with the extraction slice,
   since the order it pins is verify → revocation/anti-replay → disk → extract.

### P5.4R exit gate

- `runtime_boxes.rs` contains no local signature verification, target-ID
  computation, safe-path rule, archive-identity check or extraction primitive;
- the product lifecycle listed above is unchanged and still Liatir-owned;
- the call-order regression from step 2 is green, and no conformance fixture was
  vendored into this repository;
- `managed_bins::extract_zip_with_expected_size` is no longer on the Runtime Box
  path, and its remaining callers are unaffected;
- one already-proven target reinstalls and runs from its existing evidence
  bytes, proving the swap changed no observable behavior;
- no recipe, catalog identity, trust root, published object or channel changed.

Native re-validation is **not** required to close P5.4R: the crate changes how a
box is verified, not how it is built. If a native run is wanted for confidence,
prefer the cheapest already-approved foundation fixture and keep its explicit
allocation boundary.

## P5.4V — Scrollcase version delta (`0.4.11` → current line)

Recorded 2026-08-04 from npm and the published `0.7.0` tarball, when this phase
was scheduled after P5.4. **That order was inverted by the maintainer on
2026-08-06 and the pin is now raised** — see the execution record at the end of
this section. The delta below is kept as written because it is what the decision
was made against.

### Why this is a phase and not a dependency bump

Liatir pins exact `scrollcase@0.4.11`. The npm `latest` tag is `0.7.0`, published
`2026-08-03`, with `0.5.0`, `0.6.0` and `0.6.1` in between. Two of those releases
change **archive bytes and payload layout**, so raising the pin invalidates the
recorded archive SHA-256, measured archive/installed sizes and catalog
`diskPlan` floors of every target already natively proven on `0.4.11` — the five
scGPT targets, Geneformer macOS Metal and Linux CPU, and the three foundation
fixtures. That is a re-proof decision per target, not a lockfile change.

Read the published tarball, not the changelog heading: `0.7.0` again files its
new work under `Unreleased`, exactly as `0.4.11` did. Version selection follows
the P5.2V.0 immutable-identity readback procedure.

### Delta the pin is missing

Confirmed absent from installed `0.4.11` (`rg` over the tarball returns nothing
for the first three):

- `payloadDigest` on the release manifest, the canonical `payload-digest.v1`
  list inside the archive, and the `verifyExtractedPayload` /
  `scrollcase verify --extracted <dir>` integrity operation;
- `attachExtractedBox`, which mints a fresh process-bound `PreparedBox` after an
  application restart without retaining or re-extracting the archive — the exact
  shape Liatir's install-then-run-later lifecycle needs;
- the optional `environment` declaration on scrolls, `box.json` and signed
  release manifests, with precedence `signed release > caller > inherited host`,
  and the structured environment report with masked/revealed values;
- **`0.6.0` payload symbolic links.** A link that provably resolves inside the
  payload to a regular file is now carried instead of materialised. Linux example
  box: 483 → 228 MB extracted; macOS: 126 → 94 MB. `schemaVersion` is unchanged,
  and a consumer predating this **rejects a link entry**. The rule lives in the
  package's `src/contract/links.mjs`: relative targets only, resolved inside the
  payload, ending at a regular file, no cycles, directory links refused outright;
- **`0.7.0` stored-not-deflated paths** for `assets` and the new optional
  `uncompressedPaths`, which changes archive size again;
- `0.6.1` fixes a Node/Python consumer divergence on exactly the accepting side
  of the link rule. Treat the link path as delicate, not routine.

### Rust consumer gaps that are already real on `0.4.11`

These do not need the upgrade. They are current defects against the pinned
contract and may be fixed independently, before or during P5.4V:

1. **No struct rejects unknown fields.** `rg deny_unknown_fields src-tauri/src`
   returns nothing. `ReleaseManifest` and `ExtractedBoxMetadata` in
   `src-tauri/src/bridge/runtime_boxes.rs` therefore accept and silently discard
   any field the pinned schema adds. This is what makes a silent divergence
   possible rather than loud.
2. **`execution` is not interpreted.** It is held as
   `Option<serde_json::Value>`, while `0.4.11` already publishes
   `contract/schema/execution.schema.json` as a closed `oneOf` over
   `python-script` and `python-module` with `additionalProperties: false`.
3. **`assets` and `weights` are not interpreted**, so on-demand asset
   descriptors carry no Rust-side size/hash enforcement.
4. **Hostile-archive defense is generic, not box-specific.**
   `runtime_boxes.rs` imports `extract_zip_with_expected_size` from
   `managed_bins`, a helper shared with managed binaries. Link entries, special
   and encrypted entries, extraction collisions and file/directory collisions are
   handled there, outside the Runtime Box security boundary and outside the
   conformance cases that name them.

### The conformance matrix is the lever

`scrollcase/contract/fixtures/consumer-conformance.json` in `0.7.0` is a
**language-neutral** declarative matrix: 65 cases over five actions —
`prepare` (25), `attach` (13), `verify-payload` (12), `run-prepared` (12),
`run-box` (3) — each an `id` plus `action`, `fixture` and `expected`. It already
names the cases that matter here: `altered-environment-metadata`,
`altered-execution-metadata`, `release-box-disagreement`, `link-entry`,
`linked-interpreter`, `special-entry`, `encrypted-entry`, `traversal-entry`,
`absolute-entry`, `extraction-collision`, `file-directory-collision`, the
`on-demand-asset-*` triple and the `payload-verification-*` group.

Liatir's own Rust consumer can be driven against this matrix directly, without
adopting anything upstream. Doing so converts "the Rust drifted from the
contract" from a finding that costs a self-hosted native run into a cheap
failure inside `cargo test`. It is also the oracle that would make a later swap
to `scrollcase-consumer` verifiable rather than assumed, so it is worth doing
either way.

### The published Scrollcase Rust consumer

`scrollcase-consumer` is on crates.io. Read from the sparse index and the
`0.1.1` crate on 2026-08-04:

- versions `0.1.0` and `0.1.1`, neither yanked; Apache-2.0; `rust-version 1.88`;
  `unsafe_code = "forbid"`, `missing_docs = "warn"`, clippy pedantic;
- dependencies are `ed25519-dalek` (pkcs8, pem), `sha2`, `zip` (deflate only,
  `default-features = false`), `serde`, `serde_json`, `base64`, and `rustix` on
  Unix only. **No async runtime, no TLS stack, no HTTP client** — it is
  synchronous and offline, so a Tauri command wraps it in `spawn_blocking`
  without dragging Tokio or OpenSSL into the desktop binary;
- its own crate docs state it is "deliberately not a distribution system: it
  selects no channel, downloads nothing, updates nothing, and knows about no
  registry", which is exactly the boundary this plan already assigns to Liatir;
- `PreparedBox` has private fields and no public constructor, so a receipt
  proving verification can only come from a function that performed it;
- `tests/conformance.rs` runs the same 65-case shared suite as the Node and
  Python consumers, from the same `consumer-conformance.json`.

Its public surface is already decomposed the way Liatir's lifecycle needs:

| Step | Crate item |
| --- | --- |
| Verify the signed release without extracting | `verify::inspect_release_document{,_with_keys}` |
| Load a trust-key set | `trust::load_trusted_keys` → `Vec<TrustedKey>` |
| Check archive identity | `verify::inspect_box_archive`, `verify::inspect_archive_for` |
| Extract | `prepare::verify_and_extract_box` |
| Re-identify after an app restart | `prepare::attach_extracted_box` |
| Re-check installed payload integrity | `prepare::verify_extracted_payload` |
| Execute | `run::run_extracted_box`, `run::run_box` |

Because verification is callable before extraction, Liatir can still run
revocation and anti-replay between the two, and still own the staging → atomic
activation → rollback-retention sequence. Adopting the crate does **not**
replace `src-tauri/src/bridge/runtime_boxes.rs` wholesale. Adopt it as a
**bounded inner layer**, never as the lifecycle owner:

- in scope for delegation: signed-envelope and trust verification, safe
  extraction including the link rule, payload-digest verification, attach,
  execution-model resolution, on-demand asset checks — the part where a subtle
  divergence is a security bug and where a shared implementation is worth more
  than local control;
- permanently Liatir-owned: Registry/channel fetch and control-document
  validation, trust roots, revocation and persisted anti-replay state, host
  capability matching and target selection, `minLiatirVersion` and product
  compatibility, disk planning, activation, rollback retention and pruning,
  removal, Jobs/Results/provenance.

Adoption conditions. Four are already satisfied by inspection above — published
immutable version, no network/registry/download layer, no async-runtime or TLS
conflict, and the shared conformance suite. Still to check before adopting:

- an exact-version pin and a clean `cargo` resolution against the existing tree,
  with no duplicate or conflicting `zip`/`sha2`/`ed25519-dalek` major versions
  already used elsewhere in `src-tauri`;
- the transitive licence footprint passes the existing audit;
- the crate's supported schema version matches the pinned npm builder version,
  since builder and consumer are released independently.

If adopted, the two implementations must not both remain live — one owns the
boundary, the other is deleted, per the P5.5 no-parallel-implementation rule.

Losing the current cross-implementation check is a real cost of adopting it:
today a Rust/Node disagreement on a real box surfaces in native validation. Keep
the conformance matrix as the replacement oracle before removing anything.

#### Open point: schema-version rejection is not a pinned error pattern

Scrollcase deliberately exposes **one opaque error struct, not an enum**;
`src/error.rs` argues that matching on variants would let a caller invent its own
equivalence between rejections, and that each new variant would be a breaking
change to a security-relevant API. The shared fixture compensates by pinning
error substrings: `consumer-conformance.json` carries an `errorPatterns` map of
27 contractual strings — `invalid-signature`, `archive-hash`, `link-entry`,
`payload-mismatch` and so on — enforced across all three implementations.

`Unsupported schemaVersion` is **not** among those 27, and no conformance case
covers it, even though the crate emits a stable message from three sites
(`src/verify.rs`, `src/contract/documents.rs`, `src/release.rs`). Matching that
string would therefore be matching an unpinned implementation detail: a reworded
message in a later release would break Liatir's v1 detection **silently**,
falling through to the generic-error branch rather than failing loudly.

This does not block adoption, because Liatir must not depend on the crate for
this decision anyway. P5.2V already requires installed-v1 cleanup to key off the
**product-owned installed-state record and filesystem identity**, never the
interpretation of a v1 document. Liatir therefore reads its own recorded
`schemaVersion` as an integer before calling the crate; the crate stays the last
line of defence, not the detector.

The vendor-neutral upstream request, if it is ever wanted, is small and preserves
the existing design: add `unsupported-schema-version` to `errorPatterns` with a
matching conformance case. That pins the string as a contract without
introducing an error variant. It is a maintainer decision, not a P5 dependency.

### P5.4V entry conditions

Four conditions were written for this phase. Three held at entry; the first was
deliberately overridden.

- ~~P5.4 is complete on `0.4.11`, including Geneformer Windows CPU, UCE and the
  CUDA identity decision~~ — **overridden by the maintainer, 2026-08-06.** UCE is
  the one target left, and it is the largest and most expensive build in the
  matrix. Building it on `0.4.11` would have meant either rebuilding it
  immediately on the new pin or freezing the whole model on a builder generation
  nothing else in the matrix used. Liatir is unreleased, so the condition was
  protecting evidence that no user depends on. The order was inverted:
  raise the pin first, then author UCE against it once.
- The immutable identity of the selected version was read back from npm
  immediately before the change — `0.7.1`, published `2026-08-05T17:27:42.996Z`,
  integrity `sha512-xVeJkv4J…yjQQ==`, which the lockfile now records.
- The Rust consumer can read a `≥0.6.0` box. `scrollcase-consumer 0.1.2` carries
  `contract/links.rs` and `contract/payload_digest.rs`; all three crate versions
  were published on 2026-08-05, after the `0.7.0` format work, so the pin was
  already ahead of the boxes and did not move.
- Per-target rebuild-or-freeze is decided: **every proven target rebuilds.**
  Nothing stays on `0.4.11`.

No published object, channel, trust root or protected release changed.

### Execution record (2026-08-06)

**The pin is raised and locally proven** (`b5434e9`, `5aaecc6`, `e76ed23`,
`fe3f41a`). Exact `scrollcase@0.7.1` in the root package, in `@liatir/core` and
in the surface test that guards all three.

The JavaScript surface turned out to be **purely additive** across the four
intervening releases: export map, bin entry and the three runtime dependencies
are byte-identical to `0.4.11`, and the only new files are `contract/links`,
`contract/payload-digest`, `environment` and the payload-digest fixture. No
Liatir build, sign, contract or consumer call site had to change.

`0.7.1` itself changes **no archive byte**. Diffed against the `0.7.0` tarball it
touches only `CHANGELOG`, `README`, `package.json` and
`consumer-conformance.json`, where it adds the 66th case and the 28th error
pattern, both `unsupported-schema-version`. That is exactly the upstream request
the "schema-version rejection is not a pinned error pattern" section above
described as small and vendor-neutral, now shipped. Liatir's detector does not
move: it still reads its own `schemaVersion` as an integer before calling any
verifier, and the pinned string only makes the last line of defence auditable.

**Two real defects surfaced, both of which only a native build could find.**

1. `runExtractedBox` now returns an `environmentReport` beside the exit code, and
   the native fixture compared the whole result with `deepEqual`. Fixed by
   asserting the report on its own terms rather than loosening the comparison:
   this box declares no environment, so the run must reveal no host values, carry
   no release variables, report no conflicts and name no dangerous host
   variables. A box that silently began inheriting the host environment is a
   provenance change and should fail here.
2. **`dir_size` under-counted an installed box.** Since `0.6.0` a payload carries
   links instead of materialising them, and the builder sizes the payload with
   `lstat` — a link costs its own few bytes. Liatir counted only regular files,
   so every link fell out of the total: 15638 bytes against a declared
   146593318 on the macOS fixture, enough to reject an entirely valid box at the
   declared-size check right after extraction. The walk still does not follow
   links; links are simply counted at their own size. A unit test pins it, so the
   next occurrence of this class costs a `cargo test` rather than a native run.

**Native proof.** The macOS foundation fixture rebuilt and passed end to end on
the new pin: frozen build, local signing, signature and archive verification,
self-test, extraction and run through `scrollcase/consumer`, the Rust archive
fixture, the activation/rollback/removal transitions and the schema-v1
rejection. New archive SHA-256
`c437c2d7e34d86153fede63a30f46575fb0692d47058773b4370544521c9a8ba`.

**The measured format delta is large.** Installed `146593318` against
`257776217`, archive `54172964` against `96979089` — the payload is 43% smaller
because links are carried rather than materialised, and the archive is smaller
again because already-compressed paths are stored rather than deflated. The
macOS fixture's catalog plan now carries the measurement (`fe3f41a`). The Linux
and Windows fixture plans held `0.4.11`-era numbers at this checkpoint:
overstatements, which are safe because a plan only reserves space, but stale.
Both were corrected by their own native runs rather than inferred from this one
— see the rebuild table below.

The same is true of every model target. `assets` are stored automatically, so no
scroll needed a `uncompressedPaths` declaration; scGPT's one `assetArchives`
entry expands into Python source, which compresses well and should keep
deflating.

#### Rebuilds: every non-GPU target is done, the four GPU targets remain (2026-08-07)

A target proven on `0.4.11` describes bytes this builder no longer produces.
Nothing is published, so no identity breaks — this is runner time, not a
migration. Every rebuild replaces the target's archive SHA-256, measured sizes
and `diskPlan`.

| Target | State | Archive SHA-256 | Installed | Δ |
| --- | --- | --- | --- | --- |
| UCE macOS Metal | done, run `31070450837` | `d08f7c80…fe29f` | `11169027146` | +10% |
| scGPT macOS Metal | done, run `31103405667` | `638f02a8…d21b` | `1372956773` | −26% |
| Geneformer macOS Metal | done, run `31104336539` | `4d591de9…f92a` | `1538447044` | −29% |
| scGPT Linux CPU | done, run `31140132988` | `dc931489…0d6b` | `2415353627` | −32% |
| scGPT Linux CUDA 12.9 | done, run `31142985671` | `467bd4c9…8f23` | `13278575284` | −52% |
| scGPT Windows CPU | done, run `31141105901` | `c8ee79c3…f3b8` | `1481631149` | +0.2% |
| scGPT Windows CUDA 12.8 | done, run `31145063888` | `548135c1…1323` | `7056692402` | +0.05% |
| Geneformer Linux CUDA 12.9 | pending, GPU | | | |
| Geneformer Windows CUDA 12.8 | pending, GPU | | | |
| Fixture Linux CPU | done, run `31114218644` | `357a385e…fced` | `239853779` | −53% |
| Fixture Windows CPU | done, run `31115179668` | `ccc5f563…2c79` | `126577170` | +0.3% |

**The format's size effect is measured, and it is a POSIX effect.** scGPT and
Geneformer each lost roughly a quarter on macOS with no scroll change, from
carried links and stored assets alone; the Linux fixture lost 53% and the macOS
fixture 43%, the largest deltas in the set, because a fixture is almost entirely
the conda prefix that the link rule stops materialising, with no weights to
dilute it. UCE gained 10% because its migration also dropped twelve `venv/`
prune paths; the two effects are separable, and only UCE paid the second one.

**The Windows fixture did not shrink at all** — `126224685` to `126577170`
installed, `+0.3%`. That is the expected result, not an anomaly: conda
materialises files on Windows instead of linking them, so a Windows payload has
no link entries for `0.6.0` to carry, and this fixture declares no `assets` for
`0.7.0` to store rather than deflate. The small increase is the new
`payload-digest.v1` list the archive now carries. **Predict no size win for
either Windows model target**, and treat a large Windows delta as a signal to
stop and look rather than as good news.

**scGPT Windows CPU confirmed that prediction** at `+0.2%` installed, against
`−32%` for the same model on Linux. It also separated the two format effects
cleanly, because its archive grew `+3.1%` while its payload grew `+0.2%`: the
`0.6.0` link rule is pure saving and Windows collects none of it, while the
`0.7.0` stored-not-deflated path is a pure *cost* on a box carrying 218 MB of
source assets. On Linux that cost is buried under the link saving; on Windows
nothing hides it. Both mechanisms are now measured independently.

**Geneformer's Metal parity reproduced its `0.4.11` figures exactly** — maximum
absolute difference `8.121132850646973e-7`, minimum cosine
`0.9999999403953552`, CPU baseline exact. The archive changed and the science
did not, which is the assurance the whole rebuild set rests on.

**scGPT Linux CUDA reproduced its own figures exactly too**, and it is the
stronger evidence of the two because a CUDA target compares the accelerator
against the CPU baseline and therefore produces real numbers, where a CPU target
leaves them `null` by construction: maximum absolute difference
`8.940696716308594e-8`, mean `1.208566402510769e-8`, minimum cosine
`0.99999999999994`, peak VRAM `219378688` — every digit identical to the
`0.4.11` run on a box whose archive SHA-256 changed completely.

The four GPU runs are paid and need explicit authorization per `AGENTS.md`. The
maintainer gave it explicitly on 2026-08-07, after every non-GPU target was
green, and the catalog `linuxCudaBeforeWindowsCuda` rule fixes their order:
scGPT Linux CUDA, scGPT Windows CUDA, Geneformer Linux CUDA, Geneformer Windows
CUDA, one at a time.

**Operating hazard, learned by losing a run.** The model workflows trigger on
push for paths including `scripts/runtime-box-ci.mjs`, and their concurrency
group is `runtime-box-<model>-<target>-<ref>` with `cancel-in-progress: true`.
A push touching a shared path therefore **cancels an in-flight dispatched native
run** for that model. Run `31102785007` died seven minutes in exactly this way.
Do not push anything matching a model workflow's path filters while its native
run is in flight.

#### Upstream gap: payload verification needs a key file

`verify_extracted_payload` and `attach_extracted_box` take
`AttachOptions.public_key_path`, a **trust file on disk**. Liatir compiles its
trust anchors into the binary with `include_str!` precisely so a user-editable
key cannot defeat signing, so neither is adoptable as written — the same reason
`verify_and_extract_box` was left unadopted in P5.4R.

`verify::inspect_release_document_with_keys` already shows the shape that works:
the same operation taking `&[TrustedKey]` directly. The vendor-neutral request is
to add the matching `_with_keys` variants for attach and payload verification.
Until then the P5.4R remainder stays open — not for want of `payloadDigest`,
which `0.7.1` now emits, but because the entry point cannot be called without
writing a trust key to disk.

The order question this section left open — P5.4V before or after P5.5 — is
answered by the same decision. P5.4V ran first, so P5.5 will delete the legacy
builder against `0.7.1`, the pin the remaining work is authored on.

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
