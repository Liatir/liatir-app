# Liatir 1.0.0 implementation

Authorized 2026-11-11. Work is local; publication and a long-running scientific
workflow validation are separate owner decisions.

## Checklist

- [x] App-global Plugin catalog: non-destructive migration, stable pipeline IDs,
  workspace-owned Jobs, logs and Results across workspace switches.
- [x] Workspace Python Scripts: mandatory SDK contract, shared Python runner,
  immutable execution snapshots, direct/pipeline execution, independent copies
  to another workspace, readable/exportable JS/TS archive.
- [x] Seven simulation pipeline presets, explicit inputs and platform requirements.
- [x] Quenta local 16 GB / 32 GB profiles, user-requested downloads and retained
  custom configuration. Compare against the old model only if available locally;
  never claim measured quality or memory improvements without evidence.
- [x] Quenta HTML presentations with locally supplied Preact, selected-result
  snapshots, isolated offline rendering and at most one generation repair.
- [x] Focused regressions, ordinary verify/UI gates, context check, documentation,
  root version 1.0.0 and release notes. No publication.

## Execution discipline

Before each subsystem: inspect its current contracts and callers, apply a bounded
change, run focused checks, record actual evidence here. Stop on unexplained
scientific differences. Keep legacy data intact until migration is durable.
Never test real users' saved work or reset their app data.

## Findings

- The existing Plugin registry is workspace-prefixed, although its sidebar route
  is already global. Pipeline references use imported UUIDs and must remain valid.
- Execution state currently resets on workspace switches, aborting controllers;
  output storage/finalization also resolves the current workspace dynamically.
  Sharing the catalog alone would leave an ownership defect. Regression coverage
  must switch workspace during a delayed run and verify the original destination.
- Python Plugins already use the managed `liatir.py` SDK, `main(ctx)` validation,
  managed dependency environments and Jobs. Scripts must reuse those facilities.
- Scripts remain workspace-specific; copying creates a new independent identity.
- Presentations use Preact, explicitly accepted by the owner. They have no network,
  external resources, filesystem gateway or native bridge access.

## Verification checkpoints

- Focused catalog/runtime/execution tests: 9 passed, including a Plugin completing
  after switching workspace and retaining its original log/Result destination.
- First broad unit pass: 797 passed, 7 skipped, two failures: generated SDK version
  still 0.4.0 and a source-inspection assertion tied to `getDataPrefix()`. Regenerate
  versions; replace that assertion with captured run ownership (behavior tested above).
- Rust check first found the pre-existing Cargo.lock app version at 0.2.1 against
  Cargo.toml 0.4.0. Root version is now 1.0.0; the conf generator and Cargo updated
  only that app-version lock entry. Rust subsequently reached the app but required
  `src-tauri/tsc/bridge.js`; compile the bridge before retrying, without dependency
  or warning cleanup.
- Frontend dependency additions are Preact and CodeMirror Python syntax support.
  No language models were downloaded. No local Ollama executable/service was found.

- The new real-Python SDK regression caught a template error (`ctx.inputs` versus
  the SDK's actual `ctx.input`). Correct the template/editor text to the existing
  SDK, retain the failing regression, and rerun the focused suite before accepting
  Script execution. No parallel SDK API is introduced.

- Focused regressions now pass 17/17: catalog migration/idempotence and collisions,
  workspace-owned completion, independent Script copying, mandatory contracts,
  actual Python SDK input/output enforcement and syntax-before-import, seven
  preset graphs, explicit bounded local model profiles.
- The presentation host has its own restrictive CSP and no file gateway. Parent
  templates restrict frame navigation to local content; the frame receives only
  frozen source snapshots and returns rendering status. A real-app regression
  attempts HTTP fetch/image loads and checks that Preact renders without the app
  bridge. Generated empty content is an error, not a successful presentation.
- JS/TS archived source is retained; the Python editor has a visual contract editor
  and uses the SDK's canonical `ctx.input`. Python syntax is parsed before import.

- Follow-up ownership inspection found Pipeline callbacks could still save runtime
  state after navigation using the new current workspace. Pipeline stores are now
  retained per workspace, with captured persistence paths; the existing cancellation
  on switching workspace is preserved and settles against its original store.
  Explicit Sandbox resets remain distinct from navigation and still clear state.
  Add cross-workspace pipeline settlement regression coverage before acceptance.
- Rust unit tests: 122 passed, 2 ignored.

- Additional run-ownership coverage passes: a cancelled departing pipeline settles
  in A while B keeps its own saved graph and receives no A Result. Pipeline registry
  entries (including Script source) are captured once for the run, including nested
  pipelines; edits cannot change later steps of an already-started run.
- Scripts now change into their own durable output directory before user imports,
  and normalize relative file outputs there. This closes a discovered collision
  risk from the shared dependency environment's default working directory.
  The SDK always wraps the handler externally; marker attributes cannot bypass
  output validation. Real Python regressions exercise both behaviors.

- Ordinary verification reruns exposed two source-inspection assertions tied to
  old call spellings; update them to require the captured run ID. Behavioral
  cross-workspace tests independently verify that destination. The WebDriver
  method guard also needed to recognize JavaScript's `Object.isFrozen` as a
  non-element method used by the new isolation test.

- The first full UI preparation built the bundled Native Tools and WebDriver app
  from a cold cache (about 10 minutes for Rust). Its runner was stopped after
  startup because subsequent ownership/source-directory fixes require rebuilding
  the exact final frontend/native candidate. Its partial pass is not final UI
  evidence. The isolated runner's SIGTERM handler closes only its test app.

- All seven ordinary verify gates passed after 809 unit/contract tests (7 skipped),
  including frontend check/build and SDK generation. A subsequent export-only
  hardening change still needs the final verify pass. TypeScript lint and Rust
  Clippy passed with existing warnings; Rust tests passed 122 with 2 ignored.
- Public docs generation rejected a dotted release-note slug as a file extension.
  Rename it to `docs/release-notes-v1.md` and rebuild both documentation sites;
  preserve the Markdown URL validator rather than loosening it.

## Pending final review item

- Capture the Script direct-run workspace at the editor's Run click, across the
  asynchronous save preceding execution. `runScriptDirect` now receives the
  captured owner explicitly from the Run click, so
  changing workspace during save cannot start A's script in B. The execution-store guard rejects a different active
  owner. Rerun targeted checks and rebuild the native candidate before final signoff.

## Native UI defect and bounded correction

- JBrowse's native tests timed out with "did not start". Read back the live test
  app's actual `viewer-sandbox.html` response header: Tauri had injected
  `script-src 'self' <hashes>` into the development policy after it became non-null.
  The newly added frame-only development policy therefore blocked all blob scripts
  the existing viewers load. This is a confirmed cause, not a guessed viewer bug.
- Keep the frame restriction, explicitly allow `script-src 'self' blob:` in both
  development templates (matching the existing production script policy). Retain
  the presentation frame's independent, stricter policy. Add a template regression
  and first rerun the two genome cases and the new workbench cases on a rebuilt
  candidate; retry limit two. Do not weaken checks or change scientific viewers.

- Final provenance review added explicit `python-script`/utility producers for
  direct-run artifacts. The Plugin/Script step and execution kinds remain distinct
  in core. Scripts are not advertised as executable `jobs.spawn(ToolRef)` binaries:
  their typed desktop API and pipeline adapter own their mandatory contracts.
  Add a provenance regression and rebuild the final frontend assets before native
  signoff; no code paths in the scientific tools are changed.

- Focused native candidate: actual unpackaged Python numeric/file chaining and
  presentation generation with exactly one repair both passed. The BAM genome
  viewer passed, confirming the blob-script policy correction. A cold Dependencies
  probe exceeded the genome spec's 20-second row wait; allow its observed startup
  transition up to 60 seconds without weakening the rendering assertions.
- Reopening the saved presentation exposed a separate defect: Result data is a
  Svelte reactive proxy, which cannot cross `postMessage`'s structured-clone boundary.
  Snapshot plain JSON before transfer and key the preview by immutable presentation
  ID so switching Results creates a fresh frame. Retain the failed native saved-
  presentation/isolation test and rerun it on rebuilt assets. Retry limit two.

- An independent headless Chrome check of the actual standalone export exposed
  malformed generated JavaScript. Exact inspection showed `String.replace` was
  interpreting `$&` inside the embedded Preact bundle as a replacement directive.
  Use a replacement callback to preserve all literal source/data bytes. Extract
  the pure HTML assembly for a fast regression covering `$&`, `$``, `$'` and
  closing-script text, policy hashes and JavaScript syntax before another browser
  retry. The exported parent frame policy handles navigation; remove the unused,
  unsupported `navigate-to` directive rather than claiming it enforces anything.

- Standalone export correction verified independently in real headless Chrome,
  using the actual generated Result's sources/runtime. The page rendered; fetch
  and image requests were blocked; navigation to an HTTP URL was blocked by the
  parent frame policy, with zero requests reaching the local trap server. The
  pure assembly regression also passes and preserves literal source/data bytes
  and both policy hashes.
- Latest ordinary verify: all seven gates pass, 107 files / 813 passed / 7 skipped.
  Rust tests on the updated source: 122 passed / 2 ignored. Final native assets
  are being rebuilt once more with the saved-Result snapshot and export fixes.

- Route the existing Results "Export HTML" action to the isolated standalone
  presentation document (not the generic scientific-table exporter). Add a direct
  export-action regression; generated Results also retain their original HTML file.

- Saved-Result preview also captures selection lifetime: a late output read for
  Result A cannot replace Result B's content after selection/navigation. Clear the
  old output while loading and ignore reads after effect cleanup. The native
  saved-presentation test switches between generated and seeded Results, exercising
  both this selection guard and the keyed frame lifecycle.

## Handover review (2026-11-11, second agent)

The first agent ran out of credits before the full UI gate. A review of the whole
diff found the core design sound (unit 814 passed / 7 skipped, `test:verify` and
`syngraphe check` green) and these open defects, all accepted by the owner for fixing:

- **Page state across a workspace switch — checked, not a defect.** Runs no longer
  abort on a switch and finalize into their captured workspace. The root layout
  already remounts the page per workspace (`{#key workspaceStore.activeId}`) and the
  Jobs list is scoped to the active workspace, so page-local `running`/log state of
  A cannot appear in B.
- **Pipelines are still cancelled by a switch**, silently, unlike direct runs. Keep
  the cancellation (pipeline steps read workspace-scoped stores) but confirm first.
- **Quenta context regression.** Existing users silently dropped from 16,384 to
  8,192 tokens. Keep the previous 16,384 for existing/custom models; the profiles
  set their own.
- **Scripts UI** is bare for non-technical users: hand-written JSON dependencies,
  lost folders/search, raw controls instead of the app's components.
- **Two presets** (trajectory, metabolic) make the user enter the same file twice.
- Script run snapshots live in the legacy JS/TS `scripts/` folder and outlive their
  Result; move them into the run's own directory. Misplaced Rust doc comment; very
  dense one-line code in the new files.
- The Results "present" action did not pass the selected Result.
- **Ollama is installed** — Liatir manages its own copy at
  `~/Library/Application Support/app.liatir.app/.liatir/.main/runtimes/quenta/ollama/`
  (0.31.2), not on `PATH`; that is why the first agent reported none. `qwen3.5:9b`
  was installed. The reference Mac has 16 GB of memory, so only the 16 GB profile
  (`gemma4:12b`, 8.0 GB download) can be compared here; `qwen3.8:27b` (17.7 GB)
  cannot run meaningfully on it and is not measured.

### Corrections applied (second agent)

- Leaving a workspace asks before stopping running pipelines (`setLeaveGuard`, the
  same injection pattern as the reset hook); every caller stops when the user stays.
  `executionRuns.reset()` (Sandbox reset) now clears only the active workspace.
- Quenta's context: the first agent's per-profile `num_ctx` plumbing was removed
  after measuring (below). Every request again uses the long-standing 16,384
  tokens, now named `LIATIR_QUENTA_CONTEXT_TOKENS` in core (the Rust bridge sends
  the same literal); the stale `contextWindowTokens` setting is gone.
- Found during the fix: the first agent had also stopped Quenta from starting its
  engine on open (`refreshProvider` instead of `bootstrapProvider`), so existing
  users saw "Needs attention" until a manual refresh, and new users saw an error
  instead of a choice. Now Quenta prepares the chosen model on open, and with no
  model it only checks status and shows the profile picker
  (`QuentaProfilePicker`, in settings and on the first screen). Nothing downloads
  until a profile is chosen. `QUENTA_DEFAULT_MODEL` is gone: there is no implicit
  default download.
- Scripts list and editor rebuilt on the app's components: search and folder
  filter, plain-language field kinds, packages as one line each, typed "Run with"
  values, latest-run panel, "Older JavaScript scripts" archive.
- Presets: each card shows what it produces, what the user chooses and what it
  requires. The trajectory and metabolic presets still ask for the same files in
  both steps: pipelines have no shared file input (Variable nodes are text/number
  only), and wiring a typed path would be worse for non-technical users. A shared
  file input would be a new pipeline feature, not a fix.
- Results: "Create presentation" is now a per-Result action passing its ID.
- Script snapshots moved to `runs/<id>/script/` (data root, like the output
  folder); native validation split into `validate_script_request`; doc comment of
  `lia_liatir_read_manifest` restored.

### Quenta model comparison (2026-11-11, 16 GB Apple Silicon Mac, Ollama 0.31.2)

Method: Liatir-managed Ollama, Quenta's real system prompt and context wrapper,
temperature 0.2, thinking off, four questions (Italian docking result with docs
context, failed-job log, Italian question whose answer is absent, greeting).
Memory from Ollama's own allocation log (`/api/ps` under-reports gemma4's mapped
weights as ~1.1 GB; system page counts were too noisy to use).

| | qwen3.5:9b | gemma4:12b |
| --- | --- | --- |
| Allocated at 8,192 / 16,384 tokens | 5.97 / 6.24 GiB | 9.38 / 9.56 GiB |
| Output speed | 8.2–9.4 tok/s | 5.0–5.3 tok/s |
| Language, citations, missing evidence | correct | correct |
| Unsupported suggestions | invented "Repair" setting, .xtc/.trr | suggested DESeq2/edgeR |

Conclusion: no quality improvement to claim; gemma4:12b is heavier and slower on
the 16 GB reference machine. Owner decision (2026-11-11): the Standard profile
uses `qwen3.5:9b` instead; Extended stays `qwen3.8:27b` as planned. Scripts and raw answers were
kept outside the repository (session scratchpad), not as evidence files.

### Final verification (2026-11-11, second agent, on the final source)

- `npm run test:verify`: all gates passed — 108 files, 816 unit/contract tests
  passed, 7 skipped; svelte-check 881 files, 0 errors, 0 warnings.
- `npm run lint:ts`: 0 errors (57 pre-existing warnings in other packages).
- `cargo clippy --all-targets`: no findings in the new Script code; remaining
  warnings pre-exist. `cargo test`: 122 passed, 2 ignored.
- `npm run test:ui` on a freshly prepared binary: 51 passed, 42 skipped, 1 failed —
  the very first test of the run (`00-pipeline-lifecycle`, "keeps pipeline runs
  isolated…") timed out opening the Sandbox on the cold first launch, with an empty
  app log and no dialog on screen. Rerun alone, all 10 tests of that spec passed,
  so it is the known first-click hydration race of `openSandboxWorkspace`, not a
  product defect. The matrix stops on the first failure, so the remaining suites
  were run afterwards: single-cell index, SnpEff suite, pipeline settlement
  restart, Runtime Box security and macOS desktop lifecycle all passed. All three
  `v1-workbench` tests passed (Script direct run and pipeline chaining,
  presentation with one repair, isolated saved presentation).
- One `cargo test` run failed only because it overlapped `native-tools:build`
  inside the UI gate, which re-signs the bundled box with a fresh key; rerun after
  the build: 122 passed.
- `syngraphe check`: no problems.

Not done, by owner decision: the extended long-workflow validation and publication.

### Owner follow-ups (2026-11-11, evening)

- Scripts editor: the starting code now has no inputs/outputs, a "Write your code
  here..." comment and returns `{}` (runs as is; unit-tested). New fields start
  unnamed with an example placeholder (`e.g. my_variable` / `e.g. my_result`); the
  editor holds ordered rows (`script-contract.ts`) and refuses to save an unnamed,
  invalid or repeated name instead of dropping the field. "Run with" became "Test
  values"; every info popup was rewritten for non-technical users.
- **Defect found (pre-existing, native):** `lia_quenta_ollama_bootstrap` started
  Liatir's own `ollama serve` (default port 11434) whenever the configured URL was
  unreachable, even for another address — downloading Ollama and leaving an engine
  that can never answer. Seen as an orphaned engine from a test home after the UI
  gate (a Quenta mock server closed while a bootstrap was in flight). Fixed:
  `starting_ollama_can_serve` only allows it for port 11434; Rust unit test added.
- Liatir's managed Ollama is installed once and never updated: this Mac still runs
  0.31.2, while a fresh install gets the current release (0.40.16 seen in a test
  home). Models published for newer Ollama (e.g. `bonsai-2`) answer 412 "requires a
  newer version" on old installs — relevant to any future profile choice.
- Gemma 4 12B was deleted from `~/.ollama` after the comparison.

### Bonsai 2 27B comparison (2026-11-12, owner request; Apple M1, 16 GB)

Owner rule: switch the Standard profile only if Bonsai is convincingly better.
`bonsai-2:27b` (8.3 GB, ternary build of Qwen 3.8 27B, vendor-claimed 98% quality)
refused to pull on the installed Ollama 0.31.2 (412, newer version required), so
both it and `qwen3.5:9b` were re-measured on Ollama 0.40.16 (the release Liatir
downloads today; signed by Ollama's Developer ID 3MU9H2V9Y9) with a separate
models folder, same four questions and settings as before.

| | qwen3.5:9b | bonsai-2:27b |
| --- | --- | --- |
| Allocated at 16,384 tokens | ~7.5–8.7 GiB peak (new engine) | 8.75 GiB (+0.9 GiB image projector reserve) |
| Output speed | 9.4–10.3 tok/s | 3.9 tok/s |
| Docking answer, wall time | 80 s | 226 s |
| Unsupported suggestions | update via a Help/Preferences menu; GROMACS/AMBER; DESeq2/edgeR/limma | none observed |

Decision: keep `qwen3.5:9b`. Bonsai's answers were somewhat more grounded but not
enough to justify ~2.5× slower replies, and it cannot be downloaded by existing
installs whose managed Ollama predates it. Test models were removed afterwards.

### Verification after the owner follow-ups (2026-11-12)

- `npm run test:verify`: 108 files, 818 passed, 7 skipped; svelte-check 882 files,
  0 errors, 0 warnings. `cargo test`: 122 passed, 2 ignored (the first attempt did
  not compile: the new helper was missing from the test module's explicit import).
- `test:ui` (`--continue-on-failure`): every suite passed except one tauri-e2e
  test, "frames a graph far wider than the screen" (fit-view timing), which passed
  on rerun alone; load average was ~40–180 during app launches. The three
  `v1-workbench` tests and the Quenta specs passed, and no Liatir-managed Ollama
  was left running afterwards, confirming the bootstrap fix.
- Sidebar: AI Models now sits directly under Tools (owner request, 2026-11-12).
  The tracked visual baselines dated from August (old AI Models page, light theme)
  and had been failing for months; the visual spec also followed the OS appearance,
  so a dark-mode Mac differed on every pixel. The spec now forces the light theme
  (`useLightTheme`), and all eight baselines were regenerated with
  `LIATIR_UPDATE_SNAPSHOTS=1`, reviewed image by image, and confirmed by a second
  comparison run without updating (2 passed). The AI Models baseline still shows
  this host's CPU/RAM line, as the old one did.
- Info popups (`InfoPopup`) now dim and slightly blur the page behind them, with
  the same backdrop as the confirmation dialogs (owner request).
- Script export: the editor's "Export .py" saves the code only (contracts and
  packages stay in Liatir); documented in `docs/pipeline/scripts.md`.
- Pipelines page: presets moved out of the page into `PipelinePresetsDialog`
  (header **Presets** button, plus **Browse presets** in the empty state), with its
  own search, so the user's pipelines and their search are back at the top. Real-app
  tests that use presets open the dialog first (`pipeline-presets-open`); the
  lighthouse, AI catalog, pipeline editor and workbench specs pass (12/12).
- Quenta presentations were hard to find (a grey "Present Results" button). Now a
  `QuentaModeSwitch` ("Chat | Presentations", plain links) sits at the top right of
  both `/quenta` and `/quenta/presentations`; "Create presentation" on a Result
  stays. Found while testing: the presentations page read `?result=` only on mount,
  so a link to it while it was open selected nothing; it now follows the URL (not
  later Results-list changes). The workbench spec opens the mode from the switch;
  workbench (3/3) and Quenta specs pass.
- Presentations can now be free pages about a described topic with no Result
  selected (owner request). The prompt says the data is absent and requires the page
  to state it and mark numbers/charts as illustrative; the Create button needs
  Results or a description. Real-app coverage added to the workbench spec.
- Presentations page: the long native-checkbox list became chips plus a
  **Choose Results…** dialog (`PresentationResultsDialog`: search, app-styled
  checkboxes, draft selection applied only on "Use selected"). Workbench spec
  updated to the chips and the dialog; 3/3 pass.
- **Presentations rebuilt as a chat with a Stage** (owner, 2026-11-12: "it must be a
  chat, like ndoc's Stage, not a form"). `/quenta/presentations` is now a conversation
  (left) and a Stage (right). Each message is a turn that runs the same fixed
  workflow and saves a new version as a Result; a follow-up passes the newest version
  to revise (`PresentationOptions.previous`). The chat shows live stages
  (`PresentationStages`: preparing data → writing slides, with streamed character
  count → checking → one repair if needed → saving). Conversations are per workspace
  (`presentation-threads.svelte.ts`, `quenta/presentation-threads.json`); generation
  runs in the store, so leaving the page does not stop it, and a turn left running by
  a closed app reloads as "interrupted". Output is slides: the frame runtime
  (`stage-runtime.ts`, bundled by the Vite plugin) adds `LiatirStage.Deck`, so the
  model only writes `{ title, body }` slides.
  Verified on the rebuilt app: workbench spec (Result-attached chat, one repair,
  stage frame, follow-up revision, free-topic page) and Quenta specs pass (8/8).
  Found while testing: the `?result=` link was handled again when a new Result
  arrived (the effect tracked `results`, and `page.url` keeps the query after
  `replaceState`), opening a second empty conversation; it is now consumed once.
- Quenta Chat (owner request): the task dropdown (Ask / Explain result / Explain
  failure) was removed. A chat starts with nothing attached; **Attach a Result or
  failure** opens the shared `ResultPickerDialog` (renamed from the presentation
  picker; single choice here, failed/cancelled marked) and sets the conversation
  focus through a new `focus` persistence mutation, which can also detach. The intent
  follows the attachment: a fresh completed Result → explain-result, a failed one →
  explain-failure (sending without typing uses the focus prompt); follow-ups are plain
  questions about it. Deep links from Results/Jobs still open a focused chat.
- Dev server moved from 5173 to **38173** (owner request, 2026-11-12): on this Mac
  VS Code ("Code Helper") was listening on 5173, so `npm run dev` could not start
  its strictPort Vite server. Changed in `frontend/vite.config.ts`, the local-dev
  Tauri template and capability (regenerated with `npm run localdevconf`), and the
  two heavy specs that load the dev frontend. Also: the UI gate's
  `test:tauri:prepare` runs `npm ci --prefix frontend` and builds in the shared
  `src-tauri/target`, so it must not run while the owner is using `npm run dev`.
- **Presentation Stage kit** (owner, 2026-11-12: "a clean library the model reuses, not
  everything from scratch"; shadcn/ui + Tailwind + Chart.js chosen). `frontend/stage-kit/`
  holds shadcn/ui (new-york-v4) copies, Liatir charts on Chart.js (with the matrix and
  box-plot plugins), Tailwind's in-page compiler with Liatir's tokens and tw-animate. The
  `liatir-presentation-runtime` Vite plugin bundles it into one script (~1.0 MB minified,
  no `eval`); `stage-kit/build.mjs` is the single build definition, shared with the tests.
  The runtime is stored once under `quenta/presentation-runtimes/<sha256>.js` and
  re-hashed on every read; a presentation names it by `runtimeId`. The kit first targeted
  Preact via `preact/compat`: Radix's Slider thumb never appeared under it, so the owner
  switched the runtime to React 19. `stage-kit` is type-checked by `npm run check`
  (`tsc -p stage-kit`), outside svelte-check.
- **Presentations are decks, not code** (owner, 2026-11-13; see
  [the decision](../../decisions/stage-pages-are-documents-not-code.md)). Measured first on
  the code design with `qwen3.5:9b`: 5 of 5 answers (three requests, two repaired) were
  React code with syntax errors, so nothing would have opened. Now the model fills in a
  deck under an Ollama JSON-Schema grammar: 45 element types (words, data and charts,
  diagrams, interactive, decoration, and four one-level containers) on per-slide grids of
  1–4 columns with `span`, seven accents and five backgrounds; a cover from the deck's
  title and a closing slide are added by the kit. Source Results become tables `T1…`
  (`spec/tables.ts`), described to the model with a few rows; data elements name a table
  and its columns, and each request's schema lists only its own tables and columns. The
  kit writes the source under every data element, or "AI-entered"/"Illustrative" for typed
  values. Elements size themselves to their own cell with container queries (a flow in a
  narrow column stacks; a cycle becomes a list), found on real decks at Stage width.
  Coverage: `tests/unit/stage-deck.test.ts` and `tests/fixtures/stage-gallery.json` (every
  element; the check's wording; values read from tables), and a real-app spec that opens
  the gallery in the presentation frame. `scripts/validate-quenta-presentations.mjs` runs
  four real requests (topic in Italian, docking Results in Italian, scRNA topic, 60-gene
  differential expression) through the app's own prompt, schema, check and single repair.
- Real-app screenshots of the frame are unreliable when the e2e window is not visible
  (display asleep, window covered): WKWebView then stops `requestAnimationFrame`, which
  Chart.js needs to size and draw, so charts look blank while the DOM is correct. The
  gallery spec therefore asserts that the frame reports "ready" (every slide mounted, no
  error), not pixels; slides are inspected visually in headless Chrome.
- Deck measurements, `qwen3.5:9b` on the 16 GB Mac, 2026-11-13, with
  `scripts/validate-quenta-presentations.mjs`. First full run: 3 of 4 first answers
  accepted; the 60-gene request asked twice for a histogram of fold change split by
  Direction, which the histogram did not allow, so it now stacks groups in shared ranges
  (the request was sensible; the element was too narrow). Final run after that and the
  container-query fixes: **4 of 4 usable** — three first answers, one after the single
  repair (a threshold with 4 values for 2 labels, named exactly and fixed). Each answer
  took 91–125 s for 540–900 output tokens with a 1.7–2.3k-token prompt (the code design
  needed ~1,100–2,200 output tokens and 160–270 s, and none opened). The model used 23 of
  the 45 element types across the eight accepted decks (charts, tables, key numbers,
  flows, quizzes, a threshold slider, cards, decoration).
- **Stage is a page, not slides** (owner correction, 2026-11-13: "don't call them slides,
  they must not be slides; I said to call it Stage, it is a page"). The deck became a
  **Stage page**: `spec/page.ts` (`sections` instead of `slides`), `liatir/page.tsx` draws
  one scrolling page — header with title, subtitle and an index of section buttons,
  sections one under the other, closing summary — with no slide navigation; sections rise
  into view with a CSS scroll-driven animation only where supported (nothing can stay
  hidden elsewhere). The Quenta mode is labelled **Stage** (switch, page title, "Open in
  Stage" on Results, chat steps "Writing the page"); stored identifiers keep
  "presentation" (see the decision). The sandbox draws `presentation.page` with
  `LiatirStage.showPage`; the few deck-format Results made in dev on 2026-11-13 no longer
  open ("rendered no content") and can be deleted. **Download HTML** on the Stage saves the
  shown version through `presentationToHtml` (`utils/export-result.ts`), the same file the
  Results export writes; PDF was not added (owner allowed HTML only if PDF is complicated:
  the sandboxed frame cannot print, and the exported page scrolls inside an iframe).
  Headless Chrome screenshots do not follow a scroll inside the frame, so section photos
  are taken by hiding the other sections.
- Stage page measurements, `qwen3.5:9b`, 2026-11-13, after the page change: two full runs
  of the four requests gave 3 of 4 usable on the first answer each time (91–135 s); the
  scRNA topic page failed twice on the threshold. First its data form (labelled series)
  did not fit "a slider over a list of numbers", so the threshold now takes `NUMBERS`
  (`{ name, values, labels? }` or `{ table, column, label? }`) and groups more than 60
  numbers into ranges. Then the repair returned the first answer **byte for byte**: the
  previous answer was pasted at the end of the repair request, so the model read it last
  and copied it. `repairMessages` now sends the answer as the model's own turn followed
  by the problems only; rerun, the same request was fixed by the repair (8 sections).
  Verified after the change: `test:verify` (832 unit tests), the real-app workbench and
  Quenta specs (10 passed, 5 skipped as before), Stage gallery in headless Chrome.
- Branch review fixes, 2026-11-13: the Results size check now reserves room for two
  answers (the repair resends the first); a display timeout is re-checked once and never
  sent to the model as a repair; histograms, box plots and computed key numbers now say
  how many rows had no number. Verified: `test:verify` (833 unit tests). Not yet run: the
  real-app e2e specs and the real-model script. Still open: open one downloaded Stage page
  in Safari and Firefox (the export was only tried in Chrome).
