# Gate 7 Beta 1 — macOS arm64 evidence and cross-platform handoff

Status: **macOS local implementation and non-release evidence complete and fully
executed, and re-executed in full on 2026-08-20 against the shared changes the
Windows and Linux slices introduced. The Windows x86_64 and Linux x86_64 slices
are also complete and executed; their evidence lives in
[Gate 7 Beta 1 — Windows and Linux evidence](./gate-7-beta1-windows-linux.md).
Public signing, notarization and every clean-machine release check remain open
on all three platforms.**

This is the authoritative Gate 7 handoff. Gate 7 is not closed until every
platform claimed by Beta 1 has its own installer, updater, migration, recovery
and uninstall evidence. Local packaging is not evidence of a publishable
release.

## macOS slice implemented

- Production builds now bundle `frontend/dist` and use the local capability.
  Running the app or an installed workflow does not depend on a hosted UI.
- `scripts/build-desktop-release.mjs` requires an exact semantic version and
  Git revision, HTTPS updater endpoint, updater signing keys, platform signing
  inputs and Apple notarization credentials before it will build. It verifies
  updater signatures and macOS release artifacts but never publishes them.
- `scripts/build-desktop-macos-adhoc.mjs` builds a visibly non-publishable,
  ad-hoc-signed macOS app and DMG, verifies the code signature and disk image,
  mounts it and checks the packaged executable. It disables updater artifacts
  so the result cannot be confused with a public release.
- Settings exposes an explicit, user-triggered update check. The native bridge
  serializes update operations, delegates signature verification and install
  to Tauri Updater, and refuses install or restart while a scientific Job is
  running. A shared read/write guard closes the final-check race by preventing
  new Jobs from registering during native replacement or restart. Development
  builds explain that no update feed is configured.
- Startup storage migration is no longer best-effort. Failure keeps data in
  place and opens a recovery screen with retry and troubleshooting actions.
- A two-process native test copies the app into a temporary Applications
  directory, migrates legacy workspace state once, recovers it after restart,
  retains existing and newly created Results, removes only the app bundle and
  confirms application data still exists.
- Unreadable workspace indexes are no longer replaced with a new empty index.
  Startup leaves the file intact, exposes recovery and resets the initialization
  latch so retry can actually reopen the restored data. A dedicated native E2E
  is present in `startup-recovery.e2e.mjs`.
- Public installation, first-analysis, limitations, update, recovery,
  uninstall and support documentation is now present under
  `docs/getting-started/`.

## Evidence recorded on macOS arm64

- `npm run desktop-beta:package:macos`: passed; produced and mounted
  `Liatir_0.2.1_aarch64.dmg`, verified by `codesign` and `hdiutil`. The artifact
  is ad-hoc signed, not notarized and must not be published.
- Focused native updater gate: 1/1 passed. Explicit checks remain offline until
  requested and restart is refused while one logical Job is running.
- Gate 5 single-cell lighthouse regression: 1/1 passed.
- Real Gate 6 Nextflow regression with `LIATIR_E2E_NEXTFLOW=1`: 3/3 passed,
  including standalone and pipeline reuse, failure/cancellation isolation and
  interrupted-run reconciliation.
- `npm run desktop-beta:test:macos`: both native processes passed; migration,
  restart recovery and uninstall retention were verified.

- `npm run test:verify`: passed after the documentation realignment with 52
  test files / 305 tests, generated SDK types, core build, Svelte check,
  frontend production build and root TypeScript compile all green.
- `cargo test`: 54 passed / 2 intentional Runtime Box fixture tests ignored.
- `cargo clippy --tests`: exited successfully on the repository's existing
  warning baseline; no Gate 7 updater warning was introduced.
- `npm run docs:all:build`: both public and internal VitePress sites built.

Final gates re-run on 2026-08-17 against a debug binary rebuilt from the current
worktree, after the suite-ownership and spec fixes below:

- `npm run test:verify`: passed with 52 test files / 306 tests, generated SDK
  types, core build, Svelte check, frontend production build and root TypeScript
  compile all green.
- `cargo test`: 54 passed / 2 intentional Runtime Box fixture tests ignored,
  unchanged.
- `npm run desktop-beta:test:macos`: both native processes passed 1/1.
- Focused regressions against the rebuilt binary: Gate 5 single-cell lighthouse
  1/1, the Gate 7 updater/Job-safety gate 1/1 and the scientific-artifact
  regression 1/1.

The real Gate 6 Nextflow regression was not re-run on 2026-08-17. No application
code changed after its recorded 3/3 run; only test specs, the test matrix and
the matrix runner did. Treat the earlier 3/3 as still current for this revision
and re-run it if application code changes again.

## Evidence completed on 2026-08-17

The two previously deferred macOS proofs have now been executed on a debug
binary rebuilt from the current worktree, and both open items are closed.

- `npm run desktop-beta:package:macos`: passed on the current revision, after
  the CSP and release-input hardening. It produced
  `src-tauri/target/release/bundle/dmg/Liatir_0.2.1_aarch64.dmg`; `codesign
  --verify --deep --strict` reported the bundle valid on disk and satisfying its
  Designated Requirement, `hdiutil verify` reported a valid checksum, and the
  mounted image contained the packaged executable. The artifact remains ad-hoc
  signed and not notarized, and must not be published. The script restored every
  generated configuration file afterwards; no signing identity or updater-artifact
  override leaked into the worktree.
- `node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/startup-recovery.e2e.mjs`:
  1/1 passed. The corrupt workspace index is left byte-for-byte intact, recovery
  is offered, and a real retry after restoring the file reopens the workspace.

Running that recovery spec for the first time exposed a defect in the spec
itself, not in the application. `WebDriverElement` caches an element id once
resolved, so asking the already-resolved recovery banner whether it is displayed
after a successful retry queries a removed node and raises a stale element
reference instead of reporting absence. The failure screenshot confirmed the app
had recovered correctly while the assertion reported failure. The spec now
re-queries the element on each poll and asserts absence through `isExisting`.

## Suite ownership defect found and fixed on 2026-08-17

`desktop-beta-macos-install.e2e.mjs` and `desktop-beta-macos-recover.e2e.mjs`
shipped without `requiredEnv`. The native runner globs the whole spec directory
when given no spec arguments, so both would have run inside `npm run test:ui`
against an unseeded home and failed, while the orchestrated Gate 7 proof passed.
Every other orchestrator-owned spec already declared `requiredEnv` for exactly
this reason.

Both specs now require `LIATIR_DESKTOP_BETA_LIFECYCLE`, which
`scripts/run-desktop-beta-macos-e2e.mjs` sets. Verified in both directions: the
specs are skipped when invoked without the orchestrator, and the orchestrated
run passes 1/1 in each of its two native processes.

The lifecycle proof is now a declared suite, `desktop-beta-lifecycle-e2e`, in
`tests/test-matrix.mjs` and part of the `ui` and `all` profiles, matching the
existing settlement-restart and Runtime Box security orchestrators. Suites may
now declare `platforms`; the matrix runner skips a suite whose host platform
does not match instead of failing, so one profile name stays usable on every
host and the Windows session can add its own package/lifecycle suite the same
way. `tests/unit/e2e-spec-loading.test.ts` now discovers every spec named by an
orchestrator script and fails if one does not declare `requiredEnv`.

## macOS re-verification of the shared Windows and Linux changes (2026-08-20)

The Windows and Linux session changed code shared with macOS — the WASI host
directory mount and the Python environment id in the Rust bridge, three Svelte
routes, the shared E2E support module, eight specs, the test matrix and the conf
shell resolver — and could not execute any of it on POSIX. Every macOS gate
predating those commits was therefore re-run on revision
`5d35592f2572a1c73b97283648b1c8fd98485238` with a clean worktree.

| Host | Toolchain |
| --- | --- |
| macOS `14.4.1` (`23E224`), `arm64` | Node `v26.4.0`; npm `11.17.0`; Rust/Cargo `1.95.0`; Nextflow `26.04.6.12646` |

Everything passed on the first attempt; no macOS fix was required. The shared
changes are inert on POSIX in practice, not only by construction.

- `npm run test:ui`: **green**, exit 0. The `tauri-e2e` suite is 31 passed, 0
  failed, 24 skipped and the profile is 5 passed / 0 failed / 2 skipped — the
  same counts Windows reports. The two off-platform lifecycle suites are skipped
  by their `platforms` declaration rather than failed. This is the first
  execution of the complete `ui` profile on macOS: earlier macOS evidence ran
  individual specs and the orchestrated lifecycle gate, never the whole profile.
  `tauri-prepare` recompiled the binary from the current worktree (`Compiling
  liatir v0.2.1`, dev profile finished in 37.61s), so no result came from a stale
  artifact.
- `npm run test:verify`: 6 of 6 suites passed; 53 test files / 318 tests,
  matching Windows exactly.
- `cargo test`: 58 passed, 0 failed, 2 intentionally ignored Runtime Box
  fixtures — up from 54 by exactly the four tests the shared commits added
  (three WASI mount tests and the Windows path-budget assertion).
- `cargo clippy --tests`: exit 0 on the existing warning baseline (121 warnings
  on this host, against 122 on Windows).
- Real Gate 6 Nextflow regression with `LIATIR_E2E_NEXTFLOW=1`: 3 passed, 0
  failed, 0 skipped. This had to be re-run: the earlier macOS 3/3 was recorded
  under the rule that it stands until application code changes again, and the
  Rust bridge and three routes have since changed.
- `npm run desktop-beta:package:macos`: passed, and with it the darwin path of
  the new `confShellInvocation` resolver, which
  `scripts/build-desktop-macos-adhoc.mjs` now uses to run `prod-conf.sh`.

  | Artifact | Bytes | SHA-256 |
  | --- | --- | --- |
  | `src-tauri/target/release/bundle/dmg/Liatir_0.2.1_aarch64.dmg` | `19718711` | `5910d1964d71ce404629f280278e69bfd18ee5e8af4d7728111406e9d0c72e51` |
  | `src-tauri/target/release/liatir` | `42365888` | `14965507c51a614790acbf0717c63b3eb697e0656f925fd4ce35b59f4c754651` |

  `codesign` reported the bundle valid on disk and satisfying its Designated
  Requirement, `hdiutil verify` reported the checksum VALID, and the image was
  mounted, inspected and ejected. Notarization was explicitly skipped for want
  of credentials, no `.sig` or updater artifact was produced, and the worktree
  was clean again afterwards. **The artifact is ad-hoc signed and must not be
  published.**
- `npm run desktop-beta:test:macos` as a standalone gate: both native processes
  passed 1/1, in addition to the same suite passing inside the `ui` profile.

One behaviour on macOS did change, in the safe direction. A host directory is
now preopened under the raw path the caller supplied rather than its
canonicalized form, because `wasm_guest_mount` is derived from the raw string.
On macOS these differ whenever a path crosses a symlink — `/var/...` against
`/private/var/...` — and the mount now matches the path the plugin is actually
handed instead of the resolved one. The plugin execution specs cover it and pass.

### Stale count in the Linux evidence

`.context/history/gate-7-beta1-windows-linux.md` records Linux `cargo test` as 54 passed and
explains it as "one fewer than Windows". That figure was written in `e4c5263`,
before `40491ce` and `5d35592` added the four new Rust tests, so it is stale
rather than platform-conditional — and 54 was never one fewer than 58. macOS now
measures 58, the same as Windows, which shows the delta was not a compiled-out
platform difference at all. Re-measure it on Linux and correct that line; it is
recorded here rather than edited blind because no Linux host was available.

## Deliberately unclaimed macOS evidence

No Developer ID identity or Apple notarization credentials were available on
this machine. Therefore the following release blockers remain:

1. build the exact clean revision with the real updater and Apple signing
   credentials;
2. verify Developer ID signatures and Apple notarization/stapling;
3. install the DMG on a clean macOS arm64 user/machine;
4. perform a real signed Beta A to Beta B update through the configured HTTPS
   feed and confirm the old scientific data reopens;
5. repeat uninstall/reinstall recovery with that public-shaped package.

Do not weaken signature or notarization requirements to turn local packaging
into a release claim. These five items are now tracked in
[Release gate — signed public distribution](../state/roadmap/release-signed-distribution.md).

## Windows native plus WSL2 continuation — completed 2026-08-19

All seven items below were executed. The exact commands, package identities,
test counts, defects found and residual limitations are recorded in
[Gate 7 Beta 1 — Windows and Linux evidence](./gate-7-beta1-windows-linux.md).
The Gate 6 `liatir.exe -> wsl.exe -> Nextflow` backend was preserved unchanged
and re-proven on this revision; no native-Windows Nextflow was added and no
shared External Workflow contract changed.

The original brief was:

1. preserve the completed `liatir.exe -> wsl.exe -> Nextflow` Gate 6 backend;
   do not add native-Windows Nextflow or change shared External Workflow
   contracts;
2. add and verify a Windows x86_64 local package gate for the actual installer
   format, keeping unsigned/local artifacts visibly separate from a signed
   release;
3. run the updater/Job-safety E2E in the native Windows app;
4. prove migration, two-process recovery, Results retention and uninstall on
   Windows using isolated test-owned application data;
5. rerun the native Windows single-cell lighthouse and the real Windows-app to
   WSL2 Nextflow Gate 6 suite;
6. inside a separate checkout in the WSL Linux filesystem, build an x86_64 ELF
   app, package the claimed Linux formats, run the applicable lifecycle under
   Xvfb, and rerun native Nextflow;
7. record OS, architecture, package identities, commands, exact test counts and
   limitations here and in the synchronized readiness/status documents.

If Windows code-signing credentials are unavailable, stop at local package and
lifecycle evidence and leave the public signed-installer item open. The same
rule applies to a real signed updater A-to-B proof. Do not create a release,
publish artifacts, dispatch GPU workflows or run heavy AI tests without a new
explicit authorization.

## Gate 7 close condition, and how it was met (2026-08-20)

Gate 7 originally required both the local desktop matrix and repeatable signed
installer and update evidence. Those two halves have different blockers: the
first is engineering, the second is credentials, money and a distribution
decision. Keeping them together meant finished, fully executed work stayed open
indefinitely behind a purchase.

**Gate 7 is therefore closed at the local layer, and re-scoped to it.** Every
platform claimed by Beta 1 — macOS arm64, Windows x86_64, Linux x86_64 — has its
own package gate, its own two-process migration, recovery, Results-retention and
uninstall proof, updater and Job-safety coverage, both lighthouse regressions,
green final quality gates and accurate public documentation, all executed and
cross-verified rather than inferred from a build.

Signing, notarization, the Microsoft Store decision, a clean-machine install and
a real signed A-to-B update moved to
[Release gate — signed public distribution](../state/roadmap/release-signed-distribution.md).
That gate is open and deliberately not started. The re-scope changes what Gate 7
claims; it does not upgrade any artifact. Everything this document calls
unsigned and unpublishable stays unsigned and unpublishable.

Gate 8 MCP is no longer queued behind a purchase and may proceed.
