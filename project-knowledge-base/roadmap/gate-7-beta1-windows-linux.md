# Gate 7 Beta 1 — Windows and Linux evidence

Status: **Windows x86_64 and Linux x86_64 local implementation and non-release
evidence complete and fully executed on 2026-08-19; code signing and every
public release check remain open on both platforms.**

This is the Windows/Linux half of the Gate 7 handoff and is the sibling of
[Gate 7 Beta 1 — macOS evidence](./gate-7-beta1-macos.md). Local packaging is
not evidence of a publishable release, and nothing here upgrades a platform to
"released".

Starting revision: `594bde20c575f0e7d13fff16a2f8e81ff8b7df27`.

## What was added

- `scripts/build-desktop-windows-adhoc.mjs` (`npm run desktop-beta:package:windows`)
  builds the real NSIS installer from a production-shaped configuration,
  requires the installer, the packaged executable and the installed executable
  to report Authenticode `NotSigned`, then silently installs into a test-owned
  directory and lets the generated uninstaller remove it again. Updater artifact
  generation is disabled and `webviewInstallMode` is `skip`, so the gate can
  never install a system-wide runtime as a side effect.
- `scripts/build-desktop-linux-adhoc.mjs` (`npm run desktop-beta:package:linux`)
  builds the `.deb`, `.rpm` and AppImage the product claims, checks the ELF
  class and machine of the packaged executable and of the AppImage, reads the
  Debian package contents and declared version, checks the RPM lead and AppImage
  type 2 magic, and requires that no updater signature was produced.
- `scripts/desktop-beta-lifecycle.mjs` owns the two-process data lifecycle proof;
  `scripts/run-desktop-beta-windows-e2e.mjs` and
  `scripts/run-desktop-beta-linux-e2e.mjs` are the platform entry points behind
  `npm run desktop-beta:test:windows` and `npm run desktop-beta:test:linux`.
  Both refuse to run off their own platform and architecture. macOS keeps its own
  orchestrator: it drives the build output rather than the installed copy,
  because re-signing a debug WebDriver bundle changes how macOS launches it.
- `desktop-beta-windows-lifecycle-e2e` and `desktop-beta-linux-lifecycle-e2e`
  are declared suites in `tests/test-matrix.mjs`, in the `ui` and `all` profiles,
  each carrying `platforms` so the matrix runner skips them off-platform instead
  of failing them. All four lifecycle specs declare
  `requiredEnv: ['LIATIR_DESKTOP_BETA_LIFECYCLE']`, which
  `tests/unit/e2e-spec-loading.test.ts` enforces.
- `scripts/build-desktop-release.mjs` now implements the Windows release
  contract. `validateReleaseEnvironment` accepts `win32` and requires a
  40-character `WINDOWS_CERTIFICATE_THUMBPRINT` or a `WINDOWS_CERTIFICATE` plus
  its password, and an HTTPS `WINDOWS_TIMESTAMP_URL`; a countersignature is
  required rather than optional because Windows has no notarization step and an
  untimestamped signature dies with its certificate. `requireArtifacts` requires
  a current-version NSIS installer and a new `.nsis.zip` updater artifact, and
  runs `Get-AuthenticodeSignature` over both the installer and the executable it
  packages, demanding `Valid` plus a real RFC 3161 countersignature. Linux is
  still deliberately unimplemented and rejected by the same contract.

## Verified platforms and toolchains

| Product path | Host/runtime evidence | Toolchain |
| --- | --- | --- |
| Native Windows app | Windows 11 Pro x86_64 `10.0.26200` (build `26200.9168`) | Node `22.14.0`; npm `11.6.1`; Rust/Cargo `1.95.0`; Git for Windows shell `MINGW64_NT-10.0-26200` (msys `3.5.7`); `jq 1.8.2` |
| Windows app to WSL2 Nextflow | WSL `2.7.10.0`; WSLg `1.0.73.2`; kernel `6.18.33.2-2`; Ubuntu 26.04 LTS; Linux `x86_64` | Nextflow `26.04.6 build 12646`; OpenJDK `21.0.11` |
| Native Linux in WSL2 | Checkout `/home/lorenzo/liatir-stack-gate7` on the Linux filesystem, not `/mnt/c`; `uname -m` = `x86_64`; freshly built `src-tauri/target/debug/liatir` = `ELF 64-bit LSB pie executable, x86-64` | Ubuntu 26.04 LTS; Node `22.14.0`; npm `10.9.2`; Rust/Cargo `1.95.0`; Nextflow `26.04.6 build 12646`; OpenJDK `21.0.11`; `jq 1.8.1` |

`jq` is a new Windows host prerequisite for the package gate, because
`prod-conf.sh` uses it. See the conf-shell defect below for why that only
surfaced now.

## Windows evidence

### Package gate

`npm run desktop-beta:package:windows` passed. The Rust release profile built in
16m58s and produced exactly one bundle:

| Artifact | Bytes | SHA-256 | Authenticode |
| --- | --- | --- | --- |
| `src-tauri/target/release/bundle/nsis/Liatir_0.2.1_x64-setup.exe` | `17127278` | `801c5d555967a830fba79753e58f3d0d6e2de9d821f0aef01f59b9fd4f6e4461` | `NotSigned` |
| `src-tauri/target/release/liatir.exe` | `47984128` | `8b5c8e2e48f8ad4d45d653a307685234d2cb63997549226af91c68fadc434e1c` | `NotSigned` |

The installer carries the `MZ` image header and the NSIS `NullsoftInst` first-
header magic, and its name identifies both the version and the architecture. It
then performed a real silent per-user installation into a test-owned temporary
directory with `/S /D=`, where `Liatir.exe` and `uninstall.exe` were both present
and the installed executable also reported `NotSigned`. `uninstall.exe /S`
removed the directory again.

Checked after the run: no `Liatir` entry remained under
`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall`, no Start Menu
shortcut remained, no temporary install directory remained, and every generated
configuration file was restored to its local-development state.

**This artifact is unsigned and must not be published.**

### Native application tests

- `npm run desktop-beta:test:windows`: both native processes passed 1/1. One-time
  migration of legacy workspace state, restart recovery in a second process,
  retention of both the pre-existing and the newly created Result, and retention
  of migrated state after the installed application directory was removed.
- `node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/app-update.e2e.mjs`: 1/1.
  Explicit update checks stay offline until requested, and restart is refused
  while one logical Job is running.
- `node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/single-cell-lighthouse.e2e.mjs`:
  1/1, after the reload defect below was fixed.
- `LIATIR_E2E_NEXTFLOW=1 node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs`:
  3 passed, 0 failed, 0 skipped.
- `npm run external-workflow:test:wsl-restart`: both native-app phases passed
  1/1.

### Quality gates

- `npm run test:verify`: 6 of 6 suites passed; 53 test files / 318 tests.
- `cargo test`: 55 passed, 0 failed, 2 intentionally ignored Runtime Box
  fixtures.
- `cargo clippy --tests`: exit 0 on the repository's existing warning baseline
  (122 warnings on this host).
- `npm run test:ui`: the broad `tauri-e2e` suite is **not green** on Windows —
  19 passed, 17 failed, 19 skipped. It is not green on macOS either; see the
  breakdown below.
- The complete `ui` profile, run with `--continue-on-failure` so that a failing
  suite does not hide the ones after it, is 4 passed / 1 failed / 2 skipped:

  | Suite | Result |
  | --- | --- |
  | Tauri test binary prepare | passed |
  | Native Tauri E2E | failed (the pre-existing breakdown below) |
  | Pipeline settlement restart lifecycle | passed |
  | Runtime Box security lifecycle | passed |
  | Desktop Beta install lifecycle | skipped — runs only on darwin |
  | **Desktop Beta install lifecycle (Windows)** | **passed** |
  | Desktop Beta install lifecycle (Linux) | skipped — runs only on linux |

  The new suite runs and passes inside the profile rather than being skipped,
  and the two off-platform suites are skipped by their `platforms` declaration
  instead of failing.

The `tauri-e2e` suite's `timeoutMs` was raised from 300s to 900s. It runs the
whole spec directory in about seven minutes on Windows, so the old five-minute
budget reported a timeout on a suite that had in fact completed and printed its
result — which hid the real failures behind an infrastructure error.

### What the broad UI suite still fails, and what is new

Eleven failures are the categories the Gate 3 record already lists: three stale
AI-catalog expectations, the intentionally hidden Dependencies sidebar route, and
seven Quenta cases. Six are not in that record and are open work rather than
Gate 7 evidence:

1. three `00-pipeline-lifecycle` cases — native child Job attribution, the
   cancel button, and the scientific alignment artifact;
2. the standalone Native Tool FastQC Job;
3. the Python `.lia` plugin build, which fails on a `plugin-runtimes` path under
   the isolated Windows home;
4. `single-cell-lighthouse`, which passes 1/1 when run on its own — as recorded
   above and on macOS — but fails inside the full suite with "The Result did not
   render the embedding preview".

Item 4 is the one worth acting on: the whole suite shares one isolated home for
the entire run, so it points at state contamination between specs rather than at
the product path the focused Gate 5 gate proves. It is recorded here rather than
smoothed over, because "passes in isolation" is not the same claim as "passes in
the suite". None of these six is caused by this gate's changes; all of them
predate it and none is claimed as Gate 7 evidence.

## Linux evidence

The checkout is an independent clone inside the WSL2 Linux filesystem, not a
view of the Windows worktree through `/mnt/c`, and its application binary was
compiled there. No Windows executable is used as Linux evidence.

### Package gate

`npm run desktop-beta:package:linux` passed and produced all three claimed
formats:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `bundle/deb/Liatir_0.2.1_amd64.deb` | `22580678` | `46c63db636db056d2e482a2e848a0dd12b37e9971e35210e769aee476edb349a` |
| `bundle/rpm/Liatir-0.2.1-1.x86_64.rpm` | `22583464` | `6778f5c04d11284d7b5f273cf4f89cd4968d9c648a8782b3d3656b7276e28c25` |
| `bundle/appimage/Liatir_0.2.1_amd64.AppImage` | `99641848` | `470ea8b501bd7618729a4b8ef58204279d57fc88811408450ea6865165ff5926` |

`src-tauri/target/release/liatir` is a 64-bit x86-64 ELF image. `dpkg-deb`
reports `usr/bin/liatir` inside the Debian package and `Version: 0.2.1` in its
control fields; its declared dependencies are `libwebkit2gtk-4.1-0` and
`libgtk-3-0`. The RPM carries the `edabeedb` lead magic and the AppImage is an
x86-64 ELF carrying the AppImage type 2 magic. No `.sig` file was produced in
any bundle directory, which is what keeps these distinguishable from a release.

**These artifacts are unsigned and must not be published.**

### Native application tests

All run under `xvfb-run -a` against the freshly compiled Linux binary.

- `npm run desktop-beta:test:linux`: both native processes passed 1/1, with the
  same migration, restart-recovery, Results-retention and uninstall-retention
  assertions as Windows.
- `app-update.e2e.mjs`, `single-cell-lighthouse.e2e.mjs` and
  `startup-recovery.e2e.mjs` in one run: 3 passed, 0 failed, 0 skipped.
- `LIATIR_E2E_NEXTFLOW=1 ... external-workflow-nextflow.e2e.mjs`: 3 passed,
  0 failed, 0 skipped, on the native POSIX backend.

### Quality gates

- `npm run test:verify`: 6 of 6 suites passed; 53 test files / 318 tests.
- `cargo test`: 54 passed, 0 failed, 2 intentionally ignored. One fewer than
  Windows because the Windows-only Runtime Box path tests are compiled out.
- `cargo clippy --tests`: exit 0 on the existing warning baseline (122
  warnings).

## Defects found and fixed

Each of these was found by running something for the first time on Windows, and
none of them was visible from a successful build.

### The webview reload deadlocked WebView2

`tests/e2e/specs/single-cell-lighthouse.e2e.mjs` did not fail on Windows; it
hung. `browser.execute(() => window.location.reload())` tears the document down
before WebView2 sends the script's response, so the WebDriver command never
completes and the run sits on the harness's 600-second script timeout. Two specs
already carried a private deferred-reload workaround naming WebView2, which is
why the Nextflow and startup-recovery proofs were unaffected.

`reloadLiatirApp` now lives in `tests/e2e/support/liatir-app.mjs`, defers the
reload by one turn and confirms it against a new `performance.timeOrigin`. Every
spec that reloaded the webview uses it: the pipeline lifecycle, execution spine,
scientific artifacts, settlement restart, single-cell lighthouse, startup
recovery, Quenta and Nextflow suites. The behaviour is correct on every platform,
so it is shared rather than branched.

### Generating a Windows build's configuration ran inside WSL

The `bash` that npm's `cmd.exe` finds first on Windows is `System32\bash.exe`,
the WSL launcher. The `*conf.sh` scripts survived that because WSL sees the
checkout through `/mnt/c` and their relative paths still resolve — which is
exactly why nobody noticed that generating a Windows build's configuration
depended on a Linux distribution and on the tools installed inside it.
`prod-conf.sh` needs `jq`, which is in neither shell here, so a Windows
production build would have failed there rather than on Windows.

`scripts/run-conf.mjs` now resolves the Git for Windows shell explicitly, and
`devconf`, `localdevconf` and `prodconf` all route through it. It refuses to fall
back to the WSL launcher. `tests/unit/conf-shell-resolution.test.ts` pins the
resolution order, the explicit `LIATIR_BASH` override, the loud failure and the
fact that all three npm entry points use it.

### A Python discovery test asserted more than the product relies on

`import_check_script_runs_with_json_null_and_bool_when_python_is_available`
failed with "Python was not found; run without arguments to install from the
Microsoft Store". Windows 11 ships a zero-length `python3.exe` App Execution
Alias in `WindowsApps` (present on this host since 2024-06-28), and the test
selected an interpreter with `first_available(&["python3", "python"])`, which
searches name-first and therefore reaches the alias before the real
`C:\Python313\python.exe`.

The product is not affected: `preferred_python_matching` validates every
candidate with `--version` through `command_stdout`, which rejects the alias's
non-zero exit and moves on. The test now selects its interpreter the same way,
reusing `python_candidates` and `command_stdout` instead of keeping a second,
weaker rule. No product behaviour changed.

### Quenta hard-navigated with `window.location.href`

The same deadlock had a second, much more expensive form. `quenta.e2e.mjs`
changed route twelve times by assigning `window.location.href` inside
`browser.execute`, so each one cost the full 600-second script timeout on
Windows — up to two hours for a single `npm run test:ui`, which is why the broad
profile looked like it was hanging rather than failing. `navigateInApp` already
carried the rule in its own documentation ("never by assigning
`window.location.href`"), but that spec predated it.

`hardNavigateInApp` now sits beside `reloadLiatirApp` in shared support and both
delegate to one `replaceDocument` helper, so a deliberate cold load of a URL
keeps its semantics without deadlocking. All twelve call sites use it and no
`location.href` assignment remains in any spec.

### The Debian content assertion was stricter than `dpkg-deb`

The first complete Linux package run failed on the gate, not on the package:
the assertion required `./usr/bin/liatir` while `dpkg-deb --contents` prints
`usr/bin/liatir` here. The three packages were correct and complete. The gate now
accepts both spellings rather than pinning one writer's formatting.

## Deliberately unclaimed Windows and Linux evidence

No Windows code-signing certificate and no Linux package-signing key were
available on this machine, so the following release blockers remain open on both
platforms:

1. build the exact clean revision with the real updater and platform signing
   credentials;
2. verify Authenticode signatures and RFC 3161 countersignatures on the Windows
   installer and executable, and equivalent signatures for the Linux packages;
3. install the signed package on a clean machine for each platform;
4. perform a real signed Beta A to Beta B update through the configured HTTPS
   feed and confirm that the old scientific data reopens;
5. repeat uninstall/reinstall recovery with those public-shaped packages.

Do not weaken a signature requirement to turn local packaging into a release
claim.

## Residual limitations

- The lifecycle proof drives the debug WebDriver binary copied into an
  installer-shaped directory. The real NSIS installer and the Linux packages
  carry the release binary, which has no embedded WebDriver and cannot be driven
  by these tests; that is why packaging and lifecycle are separate gates.
- The Windows package gate performs a real per-user install and uninstall, but
  into a test-owned directory. It is not a clean-machine installation test.
- Nextflow support on Windows remains the `liatir.exe -> wsl.exe -> Nextflow`
  backend proven by Gate 6. Native-Windows Nextflow, WSL1 and WSL ARM64 remain
  unsupported and unchanged by this gate.
- Existing Clippy warnings remain technical debt; both platform runs completed
  with exit status 0.
