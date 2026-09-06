# Phase 3 implementation evidence and remaining work

The full scope is [Phase 3 of the integration plan](new-ai-models-integration-plan.md#fase-3--strutture-affinità-e-simulazione).
Status on 2026-09-06: in progress; no Phase 3 component is published or in the normal product catalog.

## Current evidence

- The retained macOS arm64 CPU measurement is now a real run envelope. `LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES`
  carries one profile, `openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-06`, whose samples
  `tests/unit/phase3-hardware-profiles.test.ts` compares byte-for-byte against
  `runtime-boxes/measurements/openmm-macos-aarch64-cpu-development-2026-09-06.json`; an edited
  literal fails the suite. Boltz-2, Protenix v2 and Mini Default still have no profile and therefore
  still fail closed. A different release or target of OpenMM also resolves to no profile.
  Consequence worth knowing: the measured relaxation envelope is small. Without added hydrogens the
  official 33-atom fixture is accepted; with the page default (hydrogens on, a five-atoms-per-input
  preflight bound) the same file is refused at 165 atoms. Practical public limits still need larger
  measurements, which is exactly the open item below.
- OpenMM is now a `runtime-boxes/catalog.json` component with all five authored targets at
  `planned` / `nativeCiEnabled: false`, plus `.github/workflows/runtime-box-openmm.yml` and an
  `openmm` entry in `services/runtime-box-signer/policy.json`. `validateRuntimeBoxCiCatalog` passes
  with `requireWorkflows: true`. The signer policy change authorizes nothing by itself: the deployed
  signer keeps its current policy until `runtime-box-signer-deploy` is run, which was not done.
  The catalog entry also cannot expose an install button, because the core Tool Runtime catalog
  still omits `openmm-openmm` and `runtime-box-ci-catalog.test.ts` enforces that pairing.
- The catalog entry made the OpenMM scroll reachable from the cost-control gate, which found a real
  defect: `self-test.py`, `python-startup.py` and `liatir-openmm.pth` are byte-pinned into the signed
  box but had no Git checkout policy, so a Windows checkout would have broken their SHA-256 before a
  build started. `.gitattributes` now pins `runtime-boxes/scrolls/**/*.py` and `**/*.pth` to LF.
- The affinity one-protein/one-ligand rule was duplicated in `StructurePredictionDraft.svelte` and in
  core. It is now one exported `validateProteinLigandAffinityComplex(spec)` used by both, split from
  `validateProteinLigandAffinityRequest` because the editor can apply it while the user types while
  the 56/128 atom rules need the ligand parsed inside the installed box. Covered by a unit
  regression and by the affinity leg added to `structure-prediction-editor.e2e.mjs`.
- Final serial gates, run one at a time and never overlapping:
  - `test:verify` — six suites, 76 files, 567 tests: `tests/.artifacts/reports/2026-09-06T22-09-00-118Z/`.
  - `test:ui` — seven applicable suites, zero failed, two platform-only skips, 35 native scenarios:
    `tests/.artifacts/reports/2026-09-06T22-00-35-399Z/`. The candidate-only specs skip here by
    design, so each was run against its own candidate binary instead:
  - OpenMM candidate binary: release-candidate plus `runtime-box-openmm-native` — 2 passed, 0 failed.
  - Boltz-2 candidate binary (`LIATIR_STRUCTURE_EDITOR_E2E=1`): release-candidate plus
    `structure-prediction-editor` — 2 passed, 0 failed, including the new affinity leg.
- **The OpenMM macOS CPU product lifecycle passed in the real app.** `npm run runtime-box:product-lifecycle`
  ran `runtime-box-release-candidate.e2e.mjs` and the new `runtime-box-openmm-native.e2e.mjs` against
  a release-candidate test binary and a loopback candidate registry: 2 passed, 0 failed, twice
  (22:00 UTC on 2026-09-06, ~102 s for the OpenMM spec). It proves install, killed-Job cancellation,
  explicit refusal of an unmeasured preparation, a real relaxation of the box's own official
  `test-ala-3.pdb`, the Job, the finalized Result with four artifacts, the provenance rows, energy
  reduction, navigation back to the Result, removal, and result artifacts surviving removal.
  Measured: 33 prepared atoms, −1.691218992097177 → −119.53121642948675 kJ/mol, a reduction of
  117.83999743738957 kJ/mol. Retained record:
  `runtime-boxes/measurements/openmm-macos-aarch64-cpu-product-lifecycle-development-2026-09-06.json`.
  The refusal case is the page's own default: hydrogens on takes the 33-atom fixture to a 165-atom
  preflight bound, outside every retained sample, and the Run button stays closed.
- That lifecycle used a **second** development build, rebuilt only so its release document points at
  the loopback registry (`--asset-base-url http://127.0.0.1:8790/objects`). It is the same scroll,
  version and lock as the scientific measurement, but a different archive:
  `c78db875fb91c8be0088a22547062af3ed40efb614f88f23ee056d94ce2b23a6`, 580872984 bytes, installed
  1945943879 bytes, signed `liatir-openmm-development`. Its own build self-test passed. So macOS CPU
  now has scientific evidence on one development archive and product evidence on another; a
  production CI build must be measured and exercised again before publication. Neither archive is
  publishable: dirty tree, development key.
- `.github/workflows/phase3-dependency-lock.yml` replaces the Boltz-only authoring workflow and
  resolves any of Boltz-2, Protenix v2 or Protenix Mini Default on `ubuntu-24.04`, manual only, with
  no GPU, no weights, no signer and no R2 write. It has not been dispatched: `workflow_dispatch`
  needs the file on the default branch, so dispatching requires a reviewed commit and push first.

- `ComplexInputEditor.svelte` now implements parent-owned simple/advanced molecular input, copies,
  shared Data file pickers for local alignments/templates and explicit single-sequence acknowledgement.
  The advanced JSON parser lives in core, rejects malformed nested data, unknown instructions and
  numeric overflow without throwing, and preserves valid input unchanged. Nineteen parser regressions
  pass. It is now mounted on candidate-only `/tools/structure/prediction` and
  `/tools/structure/affinity` routes. Drafts are owned by workspace and draft ID, persist unfinished
  simple input and malformed advanced text, and serialize writes to avoid navigation races.
  Four storage/restore regressions pass; full model execution and rendered evidence remain required.
- The corrected serial pair is green and closes the candidate/editor recheck below. `test:verify`
  passed all six suites: `tests/.artifacts/reports/2026-09-06T21-24-16-023Z/`. The following serial
  `test:ui` passed seven applicable suites, zero failed, two platform-only skips:
  `tests/.artifacts/reports/2026-09-06T21-25-49-220Z/` — 37 native scenarios passed, 0 failed,
  including both previously failing checks (`structure-prediction-editor.e2e.mjs` and
  `runtime-box-release-candidate.e2e.mjs`). No process from either run remained on recovery.
- The earlier serial `test:verify` passed six suites / 75 files / 561 tests:
  `tests/.artifacts/reports/2026-09-06T21-15-33-748Z/`.
- The serial full verification passed all six suites / 74 files / 555 tests:
  `tests/.artifacts/reports/2026-09-06T20-47-52-355Z/`. Session `71498` was terminal on recovery,
  confirmed by that completed report and absence of any remaining build process.
- Recovered native UI baseline: session `40812` completed successfully at 20:53:10 UTC.
  `tests/.artifacts/reports/2026-09-06T20-49-14-363Z/report.json` proves seven applicable suites
  passed, zero failed, two platform-only skips. No replacement baseline was launched. This does
  not cover the unmounted complex editor or prove any Phase 3 model execution.

- Boltz-2 immutable source/model inputs and offline-cache requirements are recorded in the
  [source review](phase3-boltz-source-review.md). Its Linux CUDA candidate manifest exists;
  resolving source-only dependencies requires a Linux authoring host. No lock, completed box,
  downloaded weights or GPU execution is claimed.
- `.github/workflows/phase3-dependency-lock.yml` prepares a manual Linux CPU-only authoring path
  using Pixi 0.73.0 for Boltz-2 and both Protenix components, with source/manifest/lock receipts and
  no production environment, signer, R2 upload or GPU job. It has not been dispatched and does not
  yet prove a resolved lock.
- [Protenix source review](phase3-protenix-source-review.md) records exact commit
  `2475421477ab414b571149ad4a875c390ff8a35d`, two independent candidate asset lists and Linux
  dependency manifests. Mini excludes all ESM2-3B weights and the large v2 checkpoint. The official
  v2 URL returned HTTP 403 for both HEAD and a one-byte GET; Mini/common metadata was readable.
  No Protenix weights were downloaded, and no asset SHA-256 or redistributable box is claimed.

- Shared identities, structure input adapters, resource-envelope contracts and candidate-only metadata
  exist for Boltz-2, Protenix v2, exact Mini Default v0.5.0 and OpenMM 8.5.1.
- OpenMM product adapters and Molecular Relaxation/Dynamics pages exist. Their focused tests and
  frontend check passed before the interruption, but this is not final product or platform evidence.
- Five OpenMM scrolls and Pixi 0.73.0 dependency locks exist: macOS arm64 CPU, Linux/Windows x86_64
  CPU and Linux/Windows CUDA 12.9. Generated dependency licence inventories are retained; full legal
  and payload review remains required before publication.
- The dedicated macOS scientific validator passed protein/ligand relaxation, 10 and 100 ps dynamics,
  missing-hydrogen preparation and exact checkpoint continuation with 974 solvent-containing atoms.
  The Reference-platform initial-energy difference was 0.0000231632 kJ/mol (limit 0.01). This was a
  development environment. The final pruned, development-signed payload subsequently passed all 13
  cases (eight scientific successes and five required refusals), including corrupted checkpoint XML.
  Retained evidence: `runtime-boxes/measurements/openmm-macos-aarch64-cpu-development-2026-09-06.json`.
  Its verified release SHA-256 is `7ebdd89d1a4f179cf409e3ceca4bc399a26f8a28acb424b0470bfb87d2b67d86`;
  archive SHA-256 is `c1a52a1a6fa5ae46fbb5d0e6546ceba3aa0a281ad8fea965e96845c134a3f48e`.
  The measurement host was Apple M1 / 16 GiB; peak observed RAM was 581861376 bytes. This dirty-tree,
  local-key build is not production publication evidence or proof for other operating systems.
- Independent `runtime-box verify` of that exact archive with its development public key and
  `--self-test` also passed after fresh extraction. Sandbox-only Matplotlib/fontconfig cache warnings
  did not affect the CPU self-test. No production trust key or remote service was changed.
- All five locks now pin CPU PyTorch 2.10.0 for NAGL, including the OpenMM CUDA targets. Their updated
  licence inventories contain 167 macOS, 183 Linux and 165 Windows packages. No CUDA PyTorch stack
  is installed. The 32 focused Phase 3 tests passed after refreshing authored local-file hashes.

## Living implementation checklist

Continuation prerequisites: read the current `AGENTS.md`; `AGENTS-POLICY.md` is absent from this
checkout (including ignored-file discovery). Preserve all existing Phase 3 worktree edits. Nothing
is committed yet, and the next step needs an owner decision, because **pushing this work to `main`
fires four Runtime Box caller workflows** — `runtime-box-mhcflurry-class1-presentation.yml`,
`runtime-box-pvactools-pvacseq.yml`, `runtime-box-uce-4layer.yml` and the new
`runtime-box-openmm.yml` all list `runtime-boxes/catalog.json` in their `push:` path filters, and
each defaults to a `build` job on a heavy or self-hosted runner. Opening a pull request triggers the
same four through their `pull_request` filters. A branch push with no PR triggers nothing.
`.github/workflows/phase3-dependency-lock.yml` is `workflow_dispatch` only and never self-triggers,
but GitHub will not offer it until the file exists on the default branch. So the cheap sequence is:
land the lock workflow on `main` on its own first, dispatch it for `boltz-2`, `protenix-v2` and
`protenix-mini-default-v0-5-0`, and land the catalog change separately once the four builds are
wanted. No GPU workflow, R2 upload, signer deploy or publication is authorized by this increment.

- [ ] OpenMM: actual source layout and pruned payload verified, dedicated scientific validator,
  retained CPU measurements, real local build, per-target CI/lifecycle and publication.
  Done locally for macOS arm64 CPU: build, self-test, scientific validation, retained measurement,
  registered run envelope and a passing real product lifecycle. Still open: larger measured
  workloads so the tool accepts realistic inputs, Molecular Dynamics through the same product
  lifecycle (only relaxation is covered), the other four targets, CI builds on production keys from
  a clean tree, a signer redeploy, and publication.
- [ ] Boltz-2: official source and structure/affinity checkpoints, legal review, reproducible Linux
  CUDA box, real product runner and validator, bounded Windows/Metal feasibility review.
- [ ] Protenix: separate v2 and Mini Default boxes, local MSA/templates, real runners, validators and
  hardware measurements; Mini must never install ESM2-3B.
- [ ] Structure/affinity pages: simple complex builder, advanced contract input, file validation,
  explicit single-sequence choice, 128-atom refusal and 56-atom warning, distinct affinity values,
  structures/confidence/PAE/PDE/table/3D output.
- [ ] Per-run Jobs/Results/provenance/cancellation/navigation/restart/offline isolation and complete
  runtime install/update/rollback/remove/revocation lifecycle on each published target.
- [ ] Measurements: reject unmeasured workloads, include preparation and simulation duration,
  publish measured VRAM times 1.25/1.5 and retain the exact release/target evidence.
- [ ] Final `test:verify`, applicable Rust tests/clippy and real `test:ui`; reviewed commit/push and
  independent signed public readback for each released component.

## Corrected defects and remaining bounded rechecks

Closed. Candidate editor UI run `2026-09-06T21-17-57-201Z` passed 35 native scenarios and failed the
two new candidate/editor checks. The retained screenshot showed `Loading saved predictions…`
indefinitely: the page captured `workspaceStore.activeId` once in `onMount`, before the app restored
its workspace after full navigation, and returned without scheduling a load. The load now follows the
workspace identity reactively in a `$effect`, and the draft child snapshots reactive state before
`structuredClone`. The single allowed retry passed both checks
(`tests/.artifacts/reports/2026-09-06T21-25-49-220Z/`), so no further rebuild was spent. The same
native navigation/editor scenarios remain the regression coverage.

Native UI build correction: the first run (`20896`) rendered a blank window and was stopped through
its SIGTERM cleanup. Native diagnostics proved that HTML defined `__sveltekit_14ppvy7` while the
client required `globalThis.__sveltekit_6nqr4r.data`. Two overlapping builds wrote the same frontend
output directory; this was agent orchestration error, not missing source modules. Never run
`test:verify` concurrently with `test:ui`/frontend builds. Serial verification has now passed;
the corrected UI retry passed and demonstrated successful workspace chooser rendering.
Original native log: `tests/.artifacts/tauri-logs/tauri-2026-09-06T20-42-59-306Z.log`.

Input-adapter correction: invalid copy counts reached array allocation even after validation failed,
and a copied entity `A` could generate the same chain identity as a separate entity `A_1`.
Both adapters now reject invalid requests before translation; shared validation rejects ambiguous
identities without expanding copy arrays. Six regressions cover Boltz-2, Protenix v2 and Mini Default,
including non-colliding suffixes. Full verification passed six suites / 536 tests:
`tests/.artifacts/reports/2026-09-06T20-32-27-656Z/`. This is input-contract proof, not model execution.

1. Corrected ligand duplication: SDF parameterizes the existing residue. The real 33-atom protein
   plus 9-atom ligand stayed at 42 atoms; an absent ligand is rejected.
2. Corrected checkpoint preparation drift: metadata retains exact topology, system and integrator,
   with byte hashes and configuration identity. Solvated continuation preserved all 974 atoms and
   the same system; changed release, target and temperature were rejected. Final-payload validation
   also checks tampered XML rejection and exact resumed frame counts.
3. Corrected incomplete resource estimates: accepted estimates include output count, workload kind,
   preparation growth and step count. Tests cover the TypeScript-to-Python accepted path. Hardware
   samples record actual prepared atoms, never the conservative preflight bound as measured data.
   Larger workload measurements are still needed before exposing practical public input limits.
4. Corrected OpenMM seed range in the shared contract and Python: explicit integers 1..2147483647.
   Zero/overflow regressions and actual offline DNS/TCP/UDP-denial tests pass.
5. The first real macOS package build reached ligand parameterization but failed its native
   self-test because the relocated OpenMM installation did not register the CPU platform. The
   upstream `version.py` contains the conda build prefix, which no longer exists after packaging;
   OpenMM consequently searched `/usr/local/openmm/lib/plugins`. A signed, standard Python `.pth`
   startup hook now selects the installed prefix and keeps Windows DLL handles alive. It loads no
   scientific package. The existing pruned payload passed its real CPU self-test with this startup
   configuration. Two regressions prove relocation, host-path override and retained Windows handles;
   the full rebuilt retry passed its CPU self-test and signed-payload scientific validation.
   No Reference fallback or accelerator change was made.
   The initial `sitecustomize.py` approach was rejected: a host Python may resolve its own module
   earlier than the environment copy, as the real relocation test demonstrated.
6. The full verification passed 73 files / 523 tests before the startup-hook change. Its next run
   passed 529 of 530 tests but the existing pVACseq multiprocessing fixture could not bind its local
   socket (`PermissionError: Operation not permitted`). The identical full gate with local IPC
   permission passed all 74 files / 530 tests and all six verification suites. Retained report:
   `tests/.artifacts/reports/2026-09-06T12-18-33-156Z/`. No test was weakened. Validator provenance
   fields were added afterward; the subsequent full gate also passed all six suites / 530 tests:
   `tests/.artifacts/reports/2026-09-06T20-29-50-330Z/`. Real product UI/lifecycle proof remains open.

Each scientific failure permits one retry after a diagnosed correction and cheap regression checks;
a distinct failure must be recorded before another retry. GPU CI remains manual and requires its
separate owner authorization. All R2 uploads must use GitHub Actions. Build artifacts and temporary
environments are reproducible caches, never tracked evidence or committed model payloads.
