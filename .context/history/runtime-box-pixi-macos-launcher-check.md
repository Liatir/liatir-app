# macOS verification — self-hosted launcher + pixi box (handoff prompt)

This is a **self-contained prompt** to run in a Claude Code session **on the maintainer's macOS
(Apple Silicon) machine**. It closes the one macOS gap left by the pixi migration's Phase 3–5 work,
which was done entirely on Windows and Linux/WSL.

**Why this is needed.** Phase 3 replaced the macOS-only heavy-runner launcher
(`scripts/run-runtime-box-macos-heavy-runner.sh`, now deleted) with the cross-OS
`scripts/run-runtime-box-selfhosted-runner.sh`. The shared launcher has run on Linux (WSL) and
Windows but **never on Darwin**, so its macOS branch — the `shasum -a 256` path (Linux uses
`sha256sum`), the `Darwin:arm64` host/target guard, and the cleanup contract — is unproven on a
real Mac. This is the check the maintainer gated the protected release on.

Status: **done** (2026-07-25). Executed locally on the maintainer's Apple-Silicon Mac. **Part A**
passed: `Self-hosted runner preflight passed for liatir-macos-arm64-heavy with 45410160640 free
bytes`, exit 0, no runner root created, runner inventory empty. **Part B** (optional) also run: the
scGPT `0.2.5-beta.1` macos-aarch64-metal box built and dev-signed on the pixi substrate and
`verify --self-test` passed (`Verified scgpt-whole-human 0.2.5-beta.1 (macos-aarch64-metal)`),
loading `best_model.pt` on torch 2.8.0 Metal; measured archive **655,752,216 B (≈0.61 GB)**;
`.runtime-box-build`/the gitignored `.runtime-box-dist` build output cleaned up. No production code changed; no defect found.
Linux CPU and Windows CPU are fully validated on self-hosted CI (build + scientific +
native-lifecycle). The scGPT macOS box itself was already built end-to-end on the pixi substrate in
Phase 1.

Related: [pixi migration plan](./runtime-box-pixi-migration.md),
[Phase 0 macOS spike](../decisions/runtime-box-pixi-phase0-spike.md),
[Runtime Box CI foundation](../state/roadmap/runtime-box-ci-foundation.md) (the Gate 9 heavy-runner contract this
launcher preserves).

---

## PROMPT

You are on the maintainer's macOS Apple-Silicon machine, in a checkout of `Liatir/liatir-stack` on
`main`. This is a **local, zero-cost verification**. Do not dispatch any paid or remote job, do not
sign, publish, or promote anything, and change no production code unless a defect is found. Read
`.context/history/runtime-box-pixi-migration.md` (the Phase 3 and Phase 5 sections)
first.

### Part A — shared launcher preflight (required, ~30 s, registers nothing)

The launcher's `--preflight-only` mode resolves the target from the catalog, checks the host and
disk, and confirms no runner is already registered, then exits **without registering a runner or
downloading anything**.

```bash
# gh must be authenticated with access to the repo, and Node must be installed.
gh auth status
node --version

# Runner root must be an absolute path OUTSIDE the checkout, not a symlink, with >= 35 GiB free.
npm run runtime-box:runner:macos-heavy -- --runner-root "$HOME/liatir-runner" --preflight-only
```

**Expected:** `Self-hosted runner preflight passed for liatir-macos-arm64-heavy with <N> free bytes`
and exit 0. This exercises the macOS branch of the launcher: the `Darwin:arm64` host detection, the
`shasum -a 256` tooling, the catalog resolve, the host/target-OS guard, the disk floor, and the
"refuse if a runner with this label already exists" check.

**If it fails**, capture the exact message and report it. Likely culprits and fixes:
- `Missing required command: gh` → the launcher checks local tools before `gh`; install/authenticate
  the GitHub CLI.
- `Target runner is macos/aarch64 but this host is …` → you are not on Apple-Silicon macOS.
- `The runner root must be outside the repository checkout` / `must be an explicit absolute path`
  → pass a different `--runner-root`.
- A disk-floor failure → free space or point `--runner-root` at a volume with ≥ 35 GiB.

### Part B — native pixi box build on Darwin (optional but recommended, ~10 min)

Confirms the pixi substrate builds a relocatable scGPT box natively on macOS, the same proof already
done on Linux and Windows. The scGPT macOS recipe is already pixi
(`runtime-boxes/recipes/scgpt-whole-human-macos-arm64-metal`).

```bash
# Contained pixi + conda-pack (no system changes); pin the version the recipe declares.
export PIXI_HOME="$HOME/.local/liatir-pixi" PIXI_NO_PATH_UPDATE=1 PIXI_VERSION=v0.73.0
curl -fsSL https://pixi.sh/install.sh | bash
"$PIXI_HOME/bin/pixi" global install conda-pack
export LIATIR_RUNTIME_BOX_PIXI="$PIXI_HOME/bin/pixi"
export LIATIR_RUNTIME_BOX_CONDA_PACK="$PIXI_HOME/bin/conda-pack"

# Build + independently verify with the in-box self-test (dev-signed; nothing is published).
node scripts/runtime-box.mjs build scgpt-whole-human-macos-arm64-metal --allow-dirty
node scripts/runtime-box.mjs verify \
  .runtime-box-dist/scgpt-whole-human-0.2.5-beta.1-macos-aarch64-metal.release.json --self-test
```

**Expected:** the build ends with `Signed release:` / `Signed channel:`, and verify prints
`Verified scgpt-whole-human 0.2.5-beta.1 (macos-aarch64-metal)`. The self-test loads `best_model.pt`
and asserts the tensor shapes on torch 2.8.0 with Metal. Record the measured payload and archive
sizes (`ls -l .runtime-box-dist/`), then delete `.runtime-box-build` and the gitignored `.runtime-box-dist` build output.

### Output (write it back into the repo)

Update the Phase 5 section of
[runtime-box-pixi-migration.md](./runtime-box-pixi-migration.md) and the
[current status](../state/current.md) with: Part A pass/fail (and free-byte figure), and,
if Part B was run, the build/verify result and measured sizes. Flip this file's status from **open**
to **done**. If any defect surfaced, fix it, re-run the affected cheap gates
(`npm run test:unit`, `npm run runtime-box:catalog:check`), and record it.

--- end PROMPT ---
