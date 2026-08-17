# Gate 7 Beta 1 — macOS arm64 evidence and cross-platform handoff

Status: **macOS local implementation and non-release evidence complete and fully
executed on 2026-08-17; public signing/notarization and Windows/Linux evidence
remain open.**

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
into a release claim.

## Windows native plus WSL2 continuation

Start from a clean checkout of the commit containing this document. Read
`AGENTS.md`, this file, `current-project-status.md`, `beta-readiness.md`, the
canonical workbench plan and `testing/overview.md` completely before editing.

The Windows session must:

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

## Gate 7 close condition

Gate 7 can be marked complete only when the claimed Beta platform matrix has
repeatable signed installer/update evidence, migration/recovery/uninstall
evidence, both lighthouse regressions, final quality gates and accurate public
documentation. Until then Gate 8 MCP must remain queued after Gate 7.
