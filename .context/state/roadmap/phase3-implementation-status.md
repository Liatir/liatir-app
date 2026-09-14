# Phase 3 implementation evidence and remaining work

The full scope is [Phase 3 of the integration plan](./new-ai-models-integration-plan.md#fase-3--strutture-affinità-e-simulazione).
Status on 2026-09-06: in progress; no Phase 3 component is published or in the normal product catalog.

## GitHub audit (2026-09-07)

Read-only GitHub inspection for exact commit `82137e7706ecd783590fc321dd2c392b85dcdfdd`:

| Workflow | Run | Observed result |
| --- | --- | --- |
| OpenMM | [34063716252](https://github.com/Liatir/liatir-stack/actions/runs/34063716252) | Ubuntu 24.04 preflight passed; native job skipped |
| MHCflurry | [34063716199](https://github.com/Liatir/liatir-stack/actions/runs/34063716199) | Ubuntu 24.04 preflight passed; native job skipped |
| pVACtools | [34063716260](https://github.com/Liatir/liatir-stack/actions/runs/34063716260) | Ubuntu 24.04 preflight passed; native job skipped |
| UCE | [34063716348](https://github.com/Liatir/liatir-stack/actions/runs/34063716348) | Ubuntu 24.04 preflight passed; native job skipped |
| SDK sync | [34063715872](https://github.com/Liatir/liatir-stack/actions/runs/34063715872) | Passed |
| Phase 3 dependency authoring | [34063715213](https://github.com/Liatir/liatir-stack/actions/runs/34063715213) | Invalid workflow on push; zero jobs |
| Scheduled CI | [34098675990](https://github.com/Liatir/liatir-stack/actions/runs/34098675990) | Overall success; verify/Rust passed, advisory ESLint failed |

The dependency workflow's `jobs.lock.env` uses <code v-pre>${{ runner.temp }}</code> at lines 32 and 34.
GitHub's [context availability rules](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
do not permit `runner` in job-level `env`; it is available in step-level `env` and `run` instead.
The API exposes no jobs/logs for this rejected definition; `gh run view` reports a workflow-file issue.
This is a workflow-definition defect, not a failed dependency solve. The file is now on main, but
its presence there does not make it ready to dispatch. No retry or code correction occurred here.

The scheduled advisory ESLint job reports one error and 48 warnings. The error is the redundant
`as LiatirInputFieldSchema` assertion in `external-workflows.ts:300-306`; `continue-on-error: true`
explains the overall green CI result. Its install log also reports npm advisories (root: 12,
including nine high); package identities and shipped impact were not assessed by this audit.

Runner inventory from `gh api repos/Liatir/liatir-stack/actions/runners` was zero. The existing
untracked `AGENT-POLICY.md` was read without modification; the requested plural filename is absent.
No workflow dispatch, GPU execution, signer deployment, upload or publication was initiated.

Local audit verification passed `npm run test:verify`: six suites, 76 files / 567 tests, zero
failures; report `2026-09-07T14-45-29-324Z`. This does not validate
GitHub expression contexts or run advisory ESLint, so it does not close either diagnosed defect.
`test:ui` was not repeated because only memory documents changed; no UI or lifecycle code changed.

Remaining bounded actions:

- Done. `phase3-dependency-lock.yml` no longer names `runner` in job-level `env`: the resolver's
  paths are exported from `$RUNNER_TEMP` inside the install step, through `$GITHUB_ENV` for the later
  steps. `tests/unit/workflow-context-placement.test.ts` scans every workflow for a context GitHub
  does not allow in `jobs.<id>.env`, and was observed failing on the exact rejected file (reporting
  `lock.PIXI_HOME` and `lock.PIXI_CACHE_DIR`, and nothing else across the other 22 workflows) before
  the correction. It still carries the rejected snippet as a fixture, so the guard cannot silently
  stop detecting it. This proves the definition is valid locally, not that the solve succeeds:
  one initial CPU-only dispatch per component is still the next step, and any different failure must
  be diagnosed before a retry. Inspect resulting locks before committing them.
- Done. The advisory lint error is corrected: the redundant `as LiatirInputFieldSchema` assertion in
  `external-workflows.ts:300-306` is removed and `npm run lint:ts` now reports 0 errors and 48
  pre-existing warnings. A green advisory workflow still does not mean a clean lint result, because
  `continue-on-error: true` hides a real error. Dependency advisories remain unreviewed.
- Boltz-2 and both Protenix components still need verified official assets, redistribution review,
  complete scrolls, offline product runners, validators, measured hardware bounds and real per-target
  product lifecycles. None is in the distribution catalog or release-workflow choices yet.
- OpenMM still needs remaining target validation and full legal review. Its Dynamics product
  lifecycle is done as of 2026-09-10, and the CUDA envelope now covers real proteins. Production
  scientific/product tests must exercise the production artifact rather than borrow evidence from
  any development archive.
- Both OpenMM Linux targets now declare `hostEnvironments: ["native", "windows-wsl2"]` in catalog and
  scroll, following the 2026-09-09 decision that deleted every native Windows target. The declaration
  is the authorization, not the proof: the WSL2 proof workflow still selects no Phase 3 component, so
  Windows support stays unclaimed until a real product lifecycle passes inside the Windows app.
  The three AI Model manifests target Linux CUDA only; macOS is out of scope for them by the
  2026-09-07 decision.
- After owner approval and scientific/product readiness, the OpenMM production sequence is: deploy
  the signer policy, enable that one target's `nativeCiEnabled` on clean committed main, then
  dispatch `runtime-box-release.yml`. **No self-hosted runner is involved any more**: the macOS
  target moved from `macos-arm64-heavy` to the GitHub-hosted `macos-arm64-standard` (`macos-15`) —
  see [the decision](../../decisions/runtime-box-publication-runs-on-hosted-ci.md). The heavy profile
  had been copied from pVACtools, a far larger box; OpenMM's real footprint is ~2.3 GB payload plus
  ~0.55 GB archive. Every R2 upload runs in GitHub Actions; the workflow verifies public signatures
  and complete bytes, and promotes beta only after its real app test. The dispatch stays manual on
  purpose: an immutable upload cannot be withdrawn.
  Note that a production build produces a **different archive** from any development one, so the
  workflow re-measures and re-exercises it; the local evidence does not transfer to it.

## OpenMM CUDA is built, self-tested and measured on a real GPU (2026-09-09)

The first GPU execution in this project's history. Everything OpenMM had before this was Apple M1
CPU. Built and measured locally inside WSL2 on the host described below — local execution is not CI,
and no workflow was dispatched.

**Build and signature.** `openmm-linux-x86_64-cuda12.9` built with pixi 0.73.0 and conda-pack 0.9.2,
channel `beta`, weights `embed`. Its build-time self-test reported
`{"platform": "CUDA", "status": "passed"}` — the CUDA platform, not a Reference or CPU fallback.
Archive `54d8e87d8e026638ab23b4c4feb6cb9d3df25a58e200c1f436ac64464e929cbc`, 1,272,963,609 bytes;
release document `e29d1caf3102bd252e1c29d4e06e48f47879400ce95eef2c4660af9a79079ecc`. An independent
`runtime-box verify --self-test` on a fresh extraction passed. Lock
`0bf2cb447cde30e8ee2ca1b262c88fec72c890519728ed52588a0c59c2afb39f`, matching the catalog entry.

**Scientific validation: 18 cases, all passed** — 13 scientific runs and 5 required refusals. The
validator verified the signed payload it measured, so the scientific evidence and the signed archive
are one artifact (`signedPayloadVerified: true`). Reference-platform parity passed with a maximum
absolute difference of 0.00017122510064382368 kJ/mol against a 0.01 limit, on both the CPU baseline
and the accelerator. Retained: `openmm-linux-x86_64-cuda12.9-development-2026-09-09.json`.

| fixture | atoms | peak RAM | peak VRAM | elapsed |
| --- | ---: | ---: | ---: | ---: |
| `official-protein-relaxation` | 33 | 268.5 MiB | 122.0 MiB | 1.8 s |
| `multi-residue-relaxation` | 407 | 305.0 MiB | 121.0 MiB | 2.0 s |
| `dhfr-protein-relaxation` | 2,489 | 312.1 MiB | 123.0 MiB | 4.1 s |
| `dhfr-drug-ligand-relaxation` | 2,530 | 856.7 MiB | 123.0 MiB | 9.8 s |
| `dhfr-solvated-relaxation` | 29,419 | 456.1 MiB | 169.0 MiB | 14.1 s |
| `dhfr-solvated-dynamics-10ps` | 29,419 | 462.1 MiB | 185.0 MiB | 13.7 s |

Two results worth stating plainly. **The GPU is roughly nine to fourteen times faster** on the real
production shape: solvated DHFR relaxation went from 121.5 s to 14.1 s and its 10 ps of dynamics from
197.1 s to 13.7 s against the retained M1 CPU figures. And **VRAM is not the constraint anyone
feared** — the heaviest case peaked at 185 MiB on an 8,188 MiB card, because OpenMM's cost here is
dominated by the CUDA context itself rather than by the system size. That is a measured fact about
OpenMM on this hardware, and says nothing about Boltz-2 or Protenix, which have not run.

### The first CUDA run found a defect in how VRAM is measured

`scripts/runtime-box/measure-python.py` is shared by every validator, and its CUDA path had never
executed. It sums `nvidia-smi --query-compute-apps` rows matching its own PID. **Under WSL2 that
query returns nothing at all** — empty output, exit code 0, no error — verified here against a live
CUDA context, not inferred. So a real GPU run was indistinguishable from one that touched no GPU
memory, and the `RuntimeError` written for incapable drivers never fired, because it only triggers on
a malformed row for a PID that is present. The validator then failed on a misleading assertion, `No
measured per-process CUDA memory`.

The correction keeps per-process measurement exactly as it was wherever the driver reports it, so
the existing native-host CUDA evidence for scGPT and Geneformer stays valid and comparable. Only
when per-process yields nothing does it fall back to a **device-wide delta**: total card usage minus
a baseline read before the workload creates its context. The method travels with the sample as
`vramMeasurementMethod` and `vramDeviceBaselineBytes`, because a device-wide number must never be
compared against a per-process one. The measurement also now records `gpuName` and
`gpuDriverVersion`, which the validator writes into `evidence.accelerator` — previously `null`, so
the project's first GPU evidence would not have named the card that produced it.

A second, smaller defect surfaced on the way: `nvidia-smi` costs about 80 ms per call here, so two
calls plus the old 200 ms wait sampled under three times a second and missed the whole GPU window of
a short case. The wait is now 50 ms. **This is an improvement for native hosts too**, not a WSL2
workaround — per-process sampling was equally coarse there, and only long workloads hid it.

**Confirmed by the owner on 2026-09-09**, so the CUDA envelope is registered:
`openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09` is now in
`LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES`, transcribed from the retained measurement. Its peak of
193,986,560 bytes publishes a minimum of 242,483,200 and a recommended 290,979,840 under the
standing ×1.25 / ×1.5 rule — roughly 231 and 278 MiB. A device-wide delta can only over-state, which
for a minimum asks the user for more headroom than needed rather than less; the method label travels
with the sample so the figure is never silently compared against a per-process one. Practically,
solvated DHFR at 29,419 atoms is now inside a measured envelope on GPU, so it runs with no
acknowledgement. `tests/unit/phase3-hardware-profiles.test.ts` pins the transcription and the three
published figures, and both were observed failing on a single altered byte.

**What this is not.** A development-key build from a dirty tree (`sourceTreeDirty: true`), so it is
not publication evidence. A production CI build produces a different archive and must be re-measured
and re-exercised there. The product lifecycle for CUDA in the real app has not run, and Molecular
Dynamics still has no product lifecycle on any target.

## OpenMM CUDA passes its product lifecycle in the real app, through WSL2 (2026-09-10)

The first GPU product evidence in this project, and the first Windows-through-WSL2 proof for a
Phase 3 component. `npm run runtime-box:product-lifecycle` ran
`runtime-box-release-candidate.e2e.mjs` and `runtime-box-openmm-native.e2e.mjs` against a
release-candidate binary and a loopback candidate registry: **2 passed, 0 failed**.

| | |
| --- | --- |
| Host environment | `windows-wsl2` — the Windows app, the payload executing in Linux |
| Target / accelerator | `linux-x86_64-cuda12.9` / **CUDA** |
| Energy | −1.6910709302007945 → −119.11212442123042 kJ/mol, a reduction of 117.42105349102962 |
| Hardware evidence | `openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09` |
| Archive / installed | `5f0a7a5cdde058cba877c1b1de017dd002ac93b4f6a85964204a79884ca62970`, 1,272,963,604 → 3,753,506,056 bytes |
| Retained | `openmm-linux-x86_64-cuda12.9-product-lifecycle-development-2026-09-10.json` |

It proves install, killed-Job cancellation, both reachable hardware states on the same input, a real
CUDA relaxation of the box's own `test-ala-3.pdb`, the Job, the finalized Result with four
artifacts, provenance, navigation back, removal, and result artifacts surviving removal.

**Molecular Dynamics has its own product lifecycle too, on the same install** (2026-09-10). It was
the last Phase 3 tool with none, and it is a second product rather than a variant of the first: it
writes a trajectory, a resumable checkpoint and an energy series that relaxation has no equivalent
of. Job `job_3`, run `40a90eb1-f463-40e8-a3a7-00fc94e1e53b`, **10 result artifacts**, 33 prepared
atoms, **10 saved frames**, and `trajectoryFiniteCoordinates: true` — a trajectory that blew up
into NaN would still leave files behind, so the finite check is what separates a physical result
from a plausible-looking one. Both Results survived removal of the box.

It runs with hydrogens off, deliberately. The page adds them by default and the preflight then
bounds the input at five atoms per input atom — 165 here. Relaxation absorbs that because this
target measured DHFR at 2,489 atoms, but every retained *dynamics* sample without solvent sits at
exactly 33, so 165 is honestly beyond evidence and the page is right to hold Run closed. Ticking the
acknowledgement instead would have made the leg green while quietly running a dynamics simulation
outside every measurement; the acknowledgement path is already proven by the relaxation leg on the
same component. Reusing one install rather than taking a second keeps a multi-gigabyte download out
of the gate.

The archive differs from the one the scientific validator measured on 2026-09-09
(`54d8e87d…`): this build points its release document at the loopback registry so the app can
actually download it. Same scroll, lock and version; different bytes. Scientific and product
evidence therefore sit on two development archives, as they briefly did on macOS, and a production
CI build must be measured and exercised again regardless.

### Five gates stood between a working GPU and a working product, and every one was real

Nothing here was a test-harness artifact. Each was a genuine refusal that a Windows user with an
NVIDIA card would have hit, invisible until a machine existed that could reach this path at all.

1. **`select_target_candidate` routed only CPU payloads through WSL2.** The comment said CUDA stayed
   native-only "until it has separate product proof" — a gate whose unlock condition could not be
   met, because producing the proof required passing the gate. Lifted together with the proof.
2. **The GPU probe asked Windows, not the distribution.** Windows reporting a driver says nothing
   about whether the GPU is reachable from WSL2, and a machine can have one without the other. The
   app now probes inside WSL2, and when Windows sees a GPU that WSL2 cannot, it says exactly that
   and names `wsl --update` instead of blaming a current driver. Without this the app would have
   downloaded gigabytes before failing.
3. **The probe itself was wrong in a way that reads as correct.** `wsl.exe --exec` runs a program
   with no shell, so it never searches `/usr/lib/wsl/lib`, where WSL2 keeps `nvidia-smi`. The
   failure — "No such file or directory" — is indistinguishable from an absent GPU on a machine
   whose GPU works perfectly. Verified against a live CUDA context rather than inferred; the probe
   now goes through `/bin/sh -c`, the idiom the WSL helper already uses.
4. **The WSL2 consumer hardcoded `linux-x86_64-cpu`.** `tools/native-tools-box-consumer` pinned the
   accepted target to a constant, so no GPU box could ever install through WSL2 whatever the catalog
   published. The target now comes from the app, which has already selected and signature-checked
   it, and the consumer still compares it against the signed release — the caller says which release
   it approved, it is not believed about what the release contains. The Native Tools check keeps the
   constant, because that box genuinely is CPU-only.
5. **A validator rejected the target's own name.** Introduced in this session: `identifier()` allows
   no underscore, and every target id carries one in `x86_64`. Target ids now have their own shape
   check rather than a loosened shared one.

Two gaps in the test harness itself surfaced while adding the Dynamics leg, and both are the kind
that fail late and expensively — after a real build and a multi-gigabyte install. `setAppInputValue`
drove every control through `HTMLInputElement`'s value setter, so on a `<select>` it silently did
nothing and the spec would have "chosen" a duration it never chose; it now uses the right prototype,
dispatches `change` as well as `input`, and throws when a value is rejected rather than passing on a
default. And Liatir's deliberately small WebDriver client had no `isSelected`, so the spec died with
`is not a function` mid-lifecycle — the same way a missing `isEnabled` once cost a remote run. The
endpoint is added, and the guard that used to check two named oncology specs for one named method
now scans every routed spec for every element-state method it calls and names any the client lacks.
It was observed failing on exactly `isSelected` before being accepted.

A further failure was a test, not a product defect, and it is worth recording because it will bite
again: `native-tools-scrollcase.test.ts` anchors on multi-line source snippets with `\n`, while
`.gitattributes` gives `.rs` and `.ts` no `eol=lf` rule, so a Windows checkout (`core.autocrlf=true`)
holds CRLF and the substring silently stops matching. The assertion then fails for the platform
rather than for the thing it guards. Those source reads now normalise line endings, which keeps the
exact argument-order guard intact and makes it work on any checkout.

The consumer's `runtime-install` argument list changed, so `src-tauri/resources/native-tools/native-tools-box-consumer`
had to be rebuilt for Linux musl inside WSL2. It is a build artifact and is not committed; the app
verifies it against a hash `src-tauri/build.rs` computes at compile time, so nothing is pinned by
hand. Rebuilding it needs `rustup target add x86_64-unknown-linux-musl` in the distribution.

Signing used the machine's local development key through `LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE`,
which only debug builds honour. The trust roots in `runtime-boxes/trust/` were not touched, and a
distributed build has no such escape hatch.

## The Linux CUDA authoring and measurement host (2026-09-08)

Boltz-2, Protenix v2 and Protenix Mini target Linux x86_64 with NVIDIA. Until now no machine in this
project could run any of them: the previous development host was an Apple M1. The maintainer's
Windows 11 desktop, through WSL2, is the first one that can, and it is therefore both the authoring
host for their locks and the host every hardware measurement for these three will be taken on. Its
exact figures matter, because a measured envelope is only meaningful against the machine that
produced it.

| | |
| --- | --- |
| Host OS | Windows 11 Pro 26200, WSL2 |
| Guest | Ubuntu 26.04 LTS, `x86_64`, 6 logical CPUs |
| GPU | NVIDIA GeForce RTX 4060 Ti, **8188 MiB VRAM** |
| NVIDIA driver | 610.62 (minimum required for CUDA 12.9 is 525.60.13) |
| Host RAM | 32 GiB, of which **24 GiB** is the WSL2 ceiling plus 16 GiB swap |
| Free space, Linux filesystem | 893 GiB of 1007 GiB |

WSL2's memory ceiling was raised from its 50 % default through `%USERPROFILE%\.wslconfig`
(`memory=24GB`, `swap=16GB`, `autoMemoryReclaim=gradual`) so real workloads are not limited by the
default split. **VRAM is not configurable**: 8 GiB is physically on the card, and it is the binding
constraint for these three models, not system RAM. Whether an 8 GiB card is enough for a realistic
Boltz-2 or Protenix complex is an open question to be answered by measurement, not by estimate. If
it is not, that is a fact about this host, not about the component, and it belongs in the published
minimum/recommended VRAM figures.

Everything for these components stays in the Linux filesystem under `~`. Cross-filesystem I/O over
`/mnt/<drive>` is far too slow for a multi-gigabyte conda prefix, and it is the same boundary the
Windows-through-WSL2 product proof will have to exercise deliberately.

## Two defects the Windows host exposed, both now closed (2026-09-08, resolved 2026-09-09)

`npm run test:verify` on the WSL2 host's Windows side failed for the first time: 1 file failed,
76 passed; 9 tests failed, 582 passed — every failure inside `tests/unit/openmm-product-script.test.ts`.
Neither failure was caused by the Boltz-2 lock, which adds one untracked file that no test in that
suite reads. Both were pre-existing and invisible until then, because every previous `test:verify`
in this project ran on macOS.

**1. `socket.AF_UNIX` does not exist on Windows — closed on 2026-09-09, unreachable rather than
fixed.** `deny_network()` in `frontend/src/lib/tools/molecular-simulation/python-scripts/openmm.ts`
compares `sock.family` against `socket.AF_UNIX` in three interceptors (`blocked_connect`,
`blocked_connect_ex`, `blocked_sendto`). Python on Windows has no such attribute, so the first
intercepted socket call would raise `AttributeError` instead of the intended clean refusal. Its only
reachable scope was OpenMM's two native Windows targets, and the owner's decision of 2026-09-09
deleted them: [no native Windows Runtime Box targets](../../decisions/no-native-windows-runtime-box-targets.md).
The script now only ever runs on macOS, Linux, or Linux inside WSL2, all of which define the
attribute. No correction is owed, and the class of defect is gone rather than patched.

**2. The test harness passes a 48 KB script on the command line — a test defect, closed by skipping
the suite on Windows.** The suite's own `run()` helper spawns `python -c OPENMM_SCRIPT`. Windows caps
a command line at 32,767 characters, so the spawn failed outright: `status` `null` and `stderr`
`undefined`, which is what the other eight failures were. **The product never does this** —
`runToolRuntimePython` hands the script to the bridge, and `src-tauri/src/bridge/python_env.rs`
writes it to a file and executes it with `runpy.run_path`, feeding stdin from a second file.

The fix is a platform skip rather than a rewrite, and for the same reason as defect 1: the installed
OpenMM box is macOS, Linux, or Linux inside WSL2, never native Windows, so a native Windows
interpreter is a configuration the product does not have. `describe.skipIf(process.platform ===
'win32')` states that contract at the top of the suite, which still runs in full on both platforms
the box targets. Evidence: `npm run test:verify` on this Windows host now passes all six suites —
76 files passed, 1 skipped; 581 tests passed, 10 skipped, zero failed; report
`2026-09-09T12-09-33-168Z`.

## Current evidence

- **Boltz-2's dependency lock is resolved** — the first Phase 3 AI Model to get one, and the step
  that was impossible on macOS because `fairscale==0.4.13` ships only an sdist. Resolved locally on
  the WSL2 host above with pixi 0.73.0, running the same `pixi lock` / `pixi lock --check` pair as
  `.github/workflows/phase3-dependency-lock.yml`; the check reported the lock already up to date.
  `pixi.lock` is `f1e4a595010fe5c2d98e103c0b6b77ee8a80408ea80e25c661df29b2c4a1e88f` against manifest
  `9a9ce69316b8b122288bfca10d4c397ca7bf096b5c2c64b05e088690cdacc6ec`, unchanged from the reviewed
  candidate. Resolution only: nothing installed, no weights, no GPU execution, no workflow dispatch.
  The inspected graph, the three findings it raised — Boltz hard-requires `wandb` and `sentry-sdk`,
  the loose `pandas>=2.2.2` bound resolved to `pandas 3.0.5`, and `fsspec` no longer has the `http`
  extra — and the remaining gates are in the [Boltz source review](./phase3-boltz-source-review.md).
  Boltz-2 still has no scroll, self-test, legal record, catalog entry, runner or measurement.
- **OpenMM is measured on real proteins with a real drug, not toys.** The macOS arm64 CPU validator
  runs a size ladder whose structures and molecules all ship inside the signed payload — OpenMM's
  published benchmark set and the OpenFF toolkit's test molecules — so the envelope grew without a
  downloaded asset or an unchecked hash. All 18 cases passed (13 successes, 5 required refusals):

  | fixture | atoms | peak RAM | elapsed |
  | --- | ---: | ---: | ---: |
  | `official-protein-relaxation` | 33 | 80.0 MiB | 0.5 s |
  | `multi-residue-relaxation` (`test-aa`) | 407 | 85.8 MiB | 0.6 s |
  | `dhfr-protein-relaxation` (5dfr, DHFR) | 2,489 | 110.3 MiB | 10.7 s |
  | `dhfr-drug-ligand-relaxation` (DHFR + ruxolitinib) | 2,530 | 576.3 MiB | 27.4 s |
  | `dhfr-solvated-relaxation` | 29,419 | 343.2 MiB | 130.1 s |
  | `dhfr-solvated-dynamics-10ps` | 29,419 | 348.9 MiB | 218.8 s |

  Dihydrofolate reductase is the standard molecular-dynamics benchmark protein; the solvated cases
  are the real production shape, periodic with PME rather than the all-pairs path every smaller
  fixture uses. Ruxolitinib is an approved JAK inhibitor, 41 atoms of which 23 are heavy — inside the
  drug-like range that the 9-atom ethanol fixture never reached — and it shows what the ligand path
  actually costs: **5.2× the memory of the same protein alone** (576 MiB against 110 MiB), because
  parameterizing an arbitrary molecule loads the NAGL charge model. It needs no new legal record: it
  is OpenFF Toolkit 0.17.1 test data, MIT, already inside the payload and its licence inventory.
  Host: Apple M1, 16 GiB. Retained:
  `runtime-boxes/measurements/openmm-macos-aarch64-cpu-development-2026-09-09.json`, and the
  registered profile `openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-09` is transcribed
  from it. The Reference-platform parity difference is unchanged at 0.0000231632 kJ/mol.
- **What is still not measured**, stated plainly so nobody reads the ladder as complete:
  *duration* — 10 ps is a verification run and production dynamics is nanoseconds, so one nanosecond
  of solvated DHFR would be roughly 5.5 hours on this CPU, a projection and not a measurement;
  *size above ~30,000 atoms* — large complexes reach 50,000–200,000 atoms and land in the
  beyond-evidence path; *GPU* — every figure above is CPU, and no CUDA target has ever been built.
  See the [Linux + NVIDIA handoff](./phase3-linux-nvidia-handoff.md).
- Scientific and product evidence now share **one** archive,
  `e5e1f3ba48bb0e2affe006b0b2cbbc793ee4b7af2475589e6f047d827b8c97d1`: the validator verified the
  signed payload it measured, and the product lifecycle installed that same box. Previously the two
  sat on different development builds.
- Consequence for the product: a real protein is now inside the envelope and runs with no
  acknowledgement at all. The end-to-end spec had to change to keep covering the beyond-evidence
  path — it now exceeds the measured 5,000 minimization steps instead of relying on the atom count,
  because the old oversized case became a measured one. That is the intended direction: measurements
  move the boundary.
- `apoa1`, OpenMM's 92,224-atom benchmark, is **not** a size limit but a chemistry limit: it contains
  POPC lipids, and the reviewed amber19 protein force field has no parameters for them. Membranes are
  outside what this Tool Runtime can prepare, whatever the machine.

- Operational lesson, learned by losing a day's artifact: **never put a Runtime Box build workspace
  or its signing key under `/tmp`.** macOS cleared `/tmp/liatir-openmm-phase3.*` overnight, taking
  the development key pair with it. The signed archive itself survived in `.runtime-box-dist`, but a
  box whose key is gone can never be verified again — the release document carries only a key id and
  a signature, not the public key, and `runtime-boxes/trust/development-public.json` holds a
  different key (`liatir-runtime-box-development-2026`). The archive was therefore dead weight and
  the box had to be rebuilt. Use the workspace defaults, which are gitignored and durable:
  `.runtime-box-local` for keys and `.rb` for build scratch.

- The retained macOS arm64 CPU measurement is a real run envelope. `LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES`
  carries one profile, `openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-09`, whose thirteen
  samples `tests/unit/phase3-hardware-profiles.test.ts` compares byte-for-byte against
  `runtime-boxes/measurements/openmm-macos-aarch64-cpu-development-2026-09-09.json`; an edited
  literal fails the suite, and the literal itself is emitted from that record rather than typed.
  Boltz-2, Protenix v2 and Mini Default still have no profile and therefore still fail closed. A
  different release or target of OpenMM also resolves to no profile. The corrected hardware policy of
  2026-09-07 is implemented (commit `56d6377`): inside the envelope the run uses measured figures,
  past it the engine requires one explicit confirmation, and the only refusal is a floor above the
  host's installed memory. The earlier note that the envelope was a hard ceiling no longer holds.
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
  - `test:verify` — six suites, 76 files, 567 tests: report `2026-09-06T22-09-00-118Z`.
  - `test:ui` — seven applicable suites, zero failed, two platform-only skips, 35 native scenarios:
    report `2026-09-06T22-00-35-399Z`. The candidate-only specs skip here by
    design, so each was run against its own candidate binary instead:
  - OpenMM candidate binary: release-candidate plus `runtime-box-openmm-native` — 2 passed, 0 failed.
  - Boltz-2 candidate binary (`LIATIR_STRUCTURE_EDITOR_E2E=1`): release-candidate plus
    `structure-prediction-editor` — 2 passed, 0 failed, including the new affinity leg.
- **The OpenMM macOS CPU product lifecycle passed in the real app, with the corrected hardware rule.**
  `npm run runtime-box:product-lifecycle` ran `runtime-box-release-candidate.e2e.mjs` and
  `runtime-box-openmm-native.e2e.mjs` against a release-candidate test binary and a loopback
  candidate registry: 2 passed, 0 failed. It proves install, killed-Job cancellation, a real
  relaxation of the box's own official `test-ala-3.pdb`, the Job, the finalized Result with four
  artifacts, the provenance rows, energy reduction, navigation back to the Result, removal, and
  result artifacts surviving removal. Re-run on 2026-09-09 against the drug-ligand envelope, so the
  Result's `Hardware evidence` row names the current profile rather than a deleted one: 2 passed,
  0 failed, 14 assertions, 33 prepared atoms, −1.691218992097177 → −119.59347627898691 kJ/mol, a
  reduction of 117.90225728688974 kJ/mol. Retained record:
  `runtime-boxes/measurements/openmm-macos-aarch64-cpu-product-lifecycle-development-2026-09-09.json`.
  Both reachable hardware states are exercised on the same input: with hydrogens on, the 33-atom
  fixture reaches a 165-atom preflight bound, the page says the run is larger than anything measured
  and keeps Run closed until the acknowledgement is ticked, and closes it again when the tick is
  withdrawn; with hydrogens off the run is inside the envelope and no acknowledgement appears at all.
  The Result records `Within measured evidence: Yes`.
- **Running that lifecycle locally needs its full environment, and silently targets production
  without it.** `npm run runtime-box:product-lifecycle` starts the loopback registry, but the app
  only reaches it when the spec is told to: with no `LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL` the
  install goes to `https://models.liatir.com/v1` and fails as *No beta Runtime Box is available*,
  which reads like a broken box rather than a missing variable. The working local invocation, after
  `VITE_LIATIR_RUNTIME_BOX_RELEASE_CANDIDATE_ID=openmm-openmm npm run test:tauri:prepare`:

  ```sh
  LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL=http://127.0.0.1:8790/v1 \
  LIATIR_RUNTIME_BOX_RELEASE_CANDIDATE_ID=openmm-openmm \
  LIATIR_RUNTIME_BOX_MODEL_ID=openmm-openmm \
  LIATIR_RUNTIME_BOX_TARGET_ID=macos-aarch64-cpu \
  LIATIR_RUNTIME_BOX_EXPECTED_VERSION=8.5.1-beta.1 \
  LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE="$PWD/.runtime-box-local/signing-public.json" \
  LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE=.runtime-box-ci/product-lifecycle-openmm-macos-aarch64-cpu.json \
  LIATIR_E2E_REPORT=.runtime-box-ci/product-lifecycle-e2e.json \
  npm run runtime-box:product-lifecycle
  ```

  The trusted-key file is the local development public key and is honoured only in a debug build;
  CI needs none of it, because there the archive carries a production signature already in
  `runtime-boxes/trust/`. The candidate id must be present twice — once with the `VITE_` prefix when
  the binary is compiled, once without it when the spec runs — and a binary built without it renders
  no runtime controls at all.
- That lifecycle used a **development** build whose release document points at the loopback registry
  (`--asset-base-url http://127.0.0.1:8790/objects` then; since Scrollcase 1.2.0 the flag is
  `--publish-base-url`, and the old one is silently ignored) — the same scroll, version and lock as the
  scientific measurement, but a different archive:
  `e5e1f3ba48bb0e2affe006b0b2cbbc793ee4b7af2475589e6f047d827b8c97d1`, 580872708 bytes, installed
  1945943501 bytes, signed `liatir-openmm-development`. Its own build self-test passed. So macOS CPU
  has scientific evidence on one development archive and product evidence on another; a production CI
  build must be measured and exercised again before publication. Neither archive is publishable:
  dirty tree, development key.
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
  passed all six suites: report `2026-09-06T21-24-16-023Z`. The following serial
  `test:ui` passed seven applicable suites, zero failed, two platform-only skips:
  report `2026-09-06T21-25-49-220Z` — 37 native scenarios passed, 0 failed,
  including both previously failing checks (`structure-prediction-editor.e2e.mjs` and
  `runtime-box-release-candidate.e2e.mjs`). No process from either run remained on recovery.
- The earlier serial `test:verify` passed six suites / 75 files / 561 tests:
  report `2026-09-06T21-15-33-748Z`.
- The serial full verification passed all six suites / 74 files / 555 tests:
  report `2026-09-06T20-47-52-355Z`. Session `71498` was terminal on recovery,
  confirmed by that completed report and absence of any remaining build process.
- Recovered native UI baseline: session `40812` completed successfully at 20:53:10 UTC.
  `tests/.artifacts/reports/2026-09-06T20-49-14-363Z/report.json` proves seven applicable suites
  passed, zero failed, two platform-only skips. No replacement baseline was launched. This does
  not cover the unmounted complex editor or prove any Phase 3 model execution.

- Boltz-2 immutable source/model inputs and offline-cache requirements are recorded in the
  [source review](./phase3-boltz-source-review.md). Its Linux CUDA candidate manifest and, since
  2026-09-08, its resolved lock both exist. No completed box, downloaded weights or GPU execution is
  claimed.
- `.github/workflows/phase3-dependency-lock.yml` prepares a manual Linux CPU-only authoring path
  using Pixi 0.73.0 for Boltz-2 and both Protenix components, with source/manifest/lock receipts and
  no production environment, signer, R2 upload or GPU job. It has not been dispatched and does not
  yet prove a resolved lock.
- [Protenix source review](./phase3-protenix-source-review.md) records exact commit
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

Continuation prerequisites were rechecked on 2026-09-07; see the GitHub audit above. Phase 3 is
committed on main as `82137e7`. The earlier claim that the catalog push starts heavy builds was
incorrect: all four callers set `native_requested` only for `workflow_dispatch`, and the shared
native job requires `native_eligible == 'true'`. Their actual push runs passed only the hosted CPU
preflight and skipped native work. The manual dependency workflow now needs its invalid job-level
context corrected before dispatch, not another initial landing on main. Preserve the owner's
untracked `AGENT-POLICY.md`. No GPU workflow, R2 upload, signer deploy or publication is authorized
by this audit; production actions require the owner's separate confirmation.

- [ ] OpenMM: actual source layout and pruned payload verified, dedicated scientific validator,
  retained CPU measurements, real local build, per-target CI/lifecycle and publication.
  Done locally for **two** targets — macOS arm64 CPU natively, and Linux x86_64 CUDA 12.9 through
  WSL2 on Windows: build, self-test, scientific validation, retained measurement, registered run
  envelope, and a passing real product lifecycle covering **both** Molecular Relaxation and
  Molecular Dynamics. The CUDA envelope reaches solvated DHFR at 29,419 atoms, so realistic inputs
  are inside measured evidence there. Still open: the remaining `linux-x86_64-cpu` target, CI builds
  on production keys from a clean tree, a signer redeploy, and publication.
- [ ] Boltz-2: official source and structure/affinity checkpoints, legal review, reproducible Linux
  CUDA box, real product runner and validator. Done locally for Linux x86_64 CUDA 12.9 through WSL2:
  lock, scroll, legal record pinned to the exact source revision, build, self-test, scientific
  validation (1UBQ at 1.99 Å, correct on 8 of 8 seeds), retained measurement and hardware profile,
  catalog entry, and on 2026-09-14 a passing real product lifecycle — install, killed-Job
  cancellation, measured estimate, a real ubiquitin prediction at pLDDT 0.92, Job, Result,
  provenance, offline, navigation back, and removal with the artifacts surviving. Retained record:
  `runtime-boxes/measurements/boltz-2-linux-x86_64-cuda12.9-product-lifecycle-development-2026-09-14.json`.
  Still open: affinity has **no** measurement and no product lifecycle, so every affinity run asks
  for confirmation; CI builds on production keys from a clean tree, a signer redeploy, and
  publication. macOS is out of scope by the owner's 2026-09-07 decision, so no Metal feasibility
  review is owed.
- [ ] Protenix: ships as **base v1.0.0** (`protenix_base_default_v1.0.0`) on Linux x86_64 CUDA 12.6
  while v2 and Mini wait — [Protenix ships v1 while v2 waits](../../decisions/protenix-ships-v1-while-v2-waits.md);
  Mini must still never install ESM2-3B when it comes. Done locally through WSL2: build, self-test,
  scientific validation (1UBQ at 2.151 Å, deterministic, five competing seeds), retained measurement
  and hardware profile, and on 2026-09-13 a passing real product lifecycle — install, killed-Job
  cancellation, measured estimate, a real ubiquitin prediction at pLDDT 0.93, Job, Result,
  provenance, offline, navigation back, and removal with the artifacts surviving. Retained record:
  `runtime-boxes/measurements/protenix-base-v1-0-0-linux-x86_64-cuda12.6-product-lifecycle-development-2026-09-13.json`.
  Local alignments and templates are refused rather than supported. Still open: CI builds on
  production keys from a clean tree, a signer redeploy, and publication.
- [ ] Structure/affinity pages: simple complex builder, advanced contract input, file validation,
  explicit single-sequence choice, 128-atom refusal and 56-atom warning, distinct affinity values,
  structures/confidence/PAE/PDE/table/3D output. Proven in the real app for **structure prediction
  only**, with both Boltz-2 and Protenix base v1.0.0 through WSL2 (2026-09-13/14): the builder input,
  the explicit single-sequence choice, a measured run estimate, the run itself, and a Result with the
  structure, confidence and provenance. The affinity page, the atom limits and the advanced input
  have not been exercised in the app.
- [ ] Per-run Jobs/Results/provenance/cancellation/navigation/restart/offline isolation and complete
  runtime install/update/rollback/remove/revocation lifecycle on **each declared host environment**,
  not each payload: native Linux and Windows-through-WSL2 are two proofs of one signed box. For
  Boltz-2 and Protenix, Windows-through-WSL2 now proves install, cancellation, Jobs, Results,
  provenance, navigation, offline execution and removal; native Linux, update, rollback, restart and
  revocation are still unproven for both.
- [x] Hardware gate reworked to the corrected rule of 2026-09-07, and proven in the real app.
  `estimateHardwareResources` now returns three outcomes: `measured` (real figures from the smallest
  dominating sample), `beyond-evidence` (`confirmationRequired`, carrying no invented estimate — only
  the heaviest measured point the request already exceeds, as a floor), and a single size refusal,
  `impossible`, when that floor exceeds the host's installed memory. An unknown host figure never
  refuses. The acknowledgement is enforced in `runOpenMMWithRuntime`, not only in the screen, so a
  pipeline step cannot start an unmeasured run silently; the Result records
  `Within measured evidence`. Host memory comes from the existing `ensureHardwareInfo` probe, so no
  new bridge command was needed. Still open: measurements including preparation and simulation
  duration, published VRAM ×1.25/×1.5, and larger retained samples — which now move the warning
  boundary rather than gate the tool.
- [ ] Final `test:verify`, applicable Rust tests/clippy and real `test:ui`; reviewed commit/push and
  independent signed public readback for each released component.

## Corrected defects and remaining bounded rechecks

Closed. Candidate editor UI run `2026-09-06T21-17-57-201Z` passed 35 native scenarios and failed the
two new candidate/editor checks. The retained screenshot showed `Loading saved predictions…`
indefinitely: the page captured `workspaceStore.activeId` once in `onMount`, before the app restored
its workspace after full navigation, and returned without scheduling a load. The load now follows the
workspace identity reactively in a `$effect`, and the draft child snapshots reactive state before
`structuredClone`. The single allowed retry passed both checks
(report `2026-09-06T21-25-49-220Z`), so no further rebuild was spent. The same
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
report `2026-09-06T20-32-27-656Z`. This is input-contract proof, not model execution.

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
   report `2026-09-06T12-18-33-156Z`. No test was weakened. Validator provenance
   fields were added afterward; the subsequent full gate also passed all six suites / 530 tests:
   report `2026-09-06T20-29-50-330Z`. Real product UI/lifecycle proof remains open.

Each scientific failure permits one retry after a diagnosed correction and cheap regression checks;
a distinct failure must be recorded before another retry. GPU CI remains manual and requires its
separate owner authorization. All R2 uploads must use GitHub Actions. Build artifacts and temporary
environments are reproducible caches, never tracked evidence or committed model payloads.
