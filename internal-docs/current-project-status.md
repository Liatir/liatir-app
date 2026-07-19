# Current project status

Last updated: 2026-07-19 (branch `main`, up to date with `origin/main` at `e4ca5a6`).

This file is the quick handoff snapshot. The canonical detailed plans are:

- [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md) —
  the overall product direction and phase gates (committed 2026-07-19).
- [Runtime Box cross-platform CI foundation](./roadmap/runtime-box-ci-foundation.md) —
  the active engineering gate ledger. Read it before touching any Runtime Box
  CI gate; it holds the authoritative status table, execution records, and
  incident ledger.

## Where the project is

The product direction is now fixed by the Scientific AI Workbench plan
(Phases 1–8, with Phase 1 = finishing the Runtime Box CI foundation). All
current engineering effort sits inside that Phase 1.

Runtime Box CI foundation gate summary (see the plan for evidence IDs):

- Gates 0–7 and Gate 8.1 (Geneformer Linux CPU + CUDA pilot): **complete**.
- Gate 8.2 (Geneformer Windows pilot): **in progress, CPU incomplete**. The
  final capped Windows CPU release run `29658451796` published and
  hash-verified the immutable candidate, but the resumed product installation
  ended with status `error`; the lifecycle assertion discarded the underlying
  install error, so the run left no root-cause evidence. The remote-attempt
  cap for Windows CPU is **exhausted** — do not dispatch another paid Windows
  runner under this cap. Windows CUDA remains blocked behind CPU.
- Gates 8.3, 9, 10: not started.

## Working tree (uncommitted)

Two modified files carry the candidate fix for the Windows install failure
class observed in run `29658451796`:

- `src-tauri/src/bridge/managed_bins.rs` — new `rename_with_retry` helper with
  bounded backoff over transient Windows rename locks (ERROR_ACCESS_DENIED /
  ERROR_SHARING_VIOLATION from antivirus scans or lingering child-process
  handles), used by the download finalization path; plus unit tests.
- `src-tauri/src/bridge/runtime_boxes.rs` — activation and rollback now use
  `rename_with_retry` instead of bare `std::fs::rename`, since the self-test
  executes the staged interpreter immediately before the activation rename;
  plus a `#[cfg(windows)]` regression that holds an exclusive lock on a staged
  file and requires activation to ride it out.

Local evidence on macOS (2026-07-19): the three cross-platform focused tests
pass (`rename_with_retry_moves_a_directory_tree`,
`rename_with_retry_reports_a_permanent_error_without_looping_forever`,
`is_transient_rename_lock_classifies_windows_sharing_violations`). The
Windows-only lock regression cannot execute on this machine and has **not**
been proven on a real Windows host yet.

Caveat: because run `29658451796` discarded the real install error, the
transient-rename-lock hypothesis behind this fix is plausible but not
evidence-confirmed. Treat it as a candidate correction, not a verified root
cause.

## Next steps

1. Commit the rename-retry fix from a clean technical index after passing the
   usual cheap gates (catalog validation, signer policy, focused regressions,
   root verification profile) per the checklist in the Runtime Box plan.
2. Decide with the maintainer how to obtain fresh Windows CPU authorization:
   the current remote cap is exhausted, so any new paid Windows run (smoke or
   release) requires an explicit new approval and its own bounded cap.
3. Only after Windows CPU closes with full lifecycle, beta promotion, evidence,
   and cleanup: start Windows CUDA, then Gate 8.3 cross-platform closure.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see CLAUDE.md and the Runtime
  Box plan's operating rules).
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box plan whenever a gate changes state.
