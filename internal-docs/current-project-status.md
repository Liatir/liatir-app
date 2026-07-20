# Current project status

Last updated: 2026-07-20 (branch `main`, up to date with `origin/main` at `35be12a`).

This file is the quick handoff snapshot. The canonical detailed plans are:

- [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md) —
  the overall product direction and phase gates.
- [Runtime Box cross-platform CI foundation](./roadmap/runtime-box-ci-foundation.md) —
  the active engineering gate ledger. Read it before touching any Runtime Box
  CI gate; it holds the authoritative status table, execution records, and
  incident ledger.

## Where the project is

All current engineering effort sits inside Phase 1 of the Scientific AI
Workbench plan (finishing the Runtime Box CI foundation).

Runtime Box CI foundation gate summary (see the ledger for evidence IDs):

- Gates 0–7 and Gate 8.1 (Geneformer Linux CPU + CUDA pilot): **complete**.
- **Gate 8.2 Windows CPU: complete.** Release run `29706828552` (commit
  `f067482`) passed the full protected release on `windows-x86_64-cpu`: signed
  build, native self-test, scientific validation, immutable publication with
  public hash verification, the complete product lifecycle E2E (install,
  interrupted-download resume, real Geneformer inference with a finite 256-dim
  CPU embedding, Jobs/Results/provenance, replacement, rollback, cleanup), and
  beta promotion. The `beta` channel now serves the Windows CPU box.
- Gate 8.2 Windows CUDA: **not started.** Unblocked by the CPU evidence, but
  still requires same-model Linux CUDA evidence for the exact commit, explicit
  cost approval, and a manual GPU runner. **Do not dispatch without approval.**
- Gates 8.3, 9, 10: not started.

## How Gate 8.2 Windows CPU was closed (2026-07-19/20)

The Windows product lifecycle had never run end to end before, so each release
run surfaced the next Windows-only defect. The turning point was capturing the
self-test's stderr, which replaced opaque `exit code 1` failures with real
errors. Seven real causes were fixed (not symptom patches); the two marked
**PRODUCT** would have hit real Windows users, not just the test:

1. `scripts/runtime-box/heartbeat.mjs` spawned `npm` shell-free → ENOENT on
   Windows; now routed through the shared `npmInvocation` (unblocked the free
   foundation Windows validation).
2. **PRODUCT** — staging dir renamed from `.{runtime_id}.{uuid}.staging` to a
   short `.stg-{uuid}`: the long path pushed the box's nested `torch\lib\*.dll`
   past the Windows MAX_PATH (260) the DLL loader enforces (`WinError 206`).
3. **PRODUCT** — `venv_python` now resolves both interpreter layouts: a managed
   venv uses `Scripts\python.exe`, but the standalone box ships `venv\python.exe`
   (Unix layouts coincide on `bin/python`, so only Windows diverged).
4. E2E WebDriver script timeout raised to the app-side 600s Python job limit
   (cold torch/scipy imports exceeded the W3C 30s default).
5. E2E `navigate` uses client-side SvelteKit routing instead of a hard
   `window.location.href` reload, which dropped the WebDriver connection on
   Windows.
6. **PRODUCT** — reactive `$effect` in the root layout finalizes completed
   direct AI runs on any jobs-list change; previously finalization only ran
   while a job was polling or was triggered incidentally by a reload-remount
   (exposed when #5 removed the reload).
7. `rename_with_retry` (bounded backoff on transient Windows sharing/lock
   violations) on the activation, rollback, and download-rename paths; plus the
   diagnostic self-test stderr capture (`run_self_test`).

Commit trail on `main`: `69b7df2`, `657a52b`, `94d93e8`, `c6eba27`, `6534f1b`,
`4f82542`, `3503920`, `f067482`, then `35be12a` (docs). Roughly nine remote
Windows release runs were spent isolating these one at a time, because the
Windows lifecycle E2E cannot be reproduced on the macOS dev host.

## Next steps (await maintainer instruction before any paid run)

1. Windows CUDA: obtain same-model Linux CUDA evidence for the current commit,
   state the expected GPU runner/timeout/cost, get explicit approval, then run.
2. After Windows CUDA closes: Gate 8.3 cross-platform closure, then Gates 9–10.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see CLAUDE.md and the Runtime Box
  plan's operating rules). GPU runners are manual-only and need explicit cost
  approval.
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box ledger whenever a gate changes state.
