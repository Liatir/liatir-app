# Runtime Boxes, Explained from Zero

Last reviewed: 2026-08-10

This guide explains the Liatir Runtime Box system for a reader who knows
nothing about CI, Python environments, cloud services, digital signatures, or
AI model packaging.

For the exact production resources and evidence, see the
[Runtime Box production report](../../history/runtime-box-production-report.md).
For the complete engineering history, see the
[Runtime Box CI foundation ledger](../../state/roadmap/runtime-box-ci-foundation.md).
For the current builder ownership and migration boundary, see
[Scrollcase P5 — Liatir adoption](../../history/scrollcase-p5-liatir-adoption.md).

## The short version

An AI Model usually needs much more than one model file. It may need:

- a specific Python version;
- exact versions of PyTorch, NumPy, and many other packages;
- model weights and supporting data files;
- different libraries for macOS, Linux, Windows, CPU, Metal, or CUDA;
- enough disk, RAM, and sometimes GPU memory;
- a known way to start the model and interpret its output.

A **Runtime Box** packages those pieces into one signed, target-specific,
installable archive.

The generic box builder is **Scrollcase**, an independent Apache-2.0 tool
published on npm and consumed by Liatir as an exact build-time dependency.
Scrollcase is not part of this repository and is not used by the installed
desktop app at runtime. Liatir owns the recipes, scientific validation,
private-signer adapter, CI/evidence, distribution and product integration
around the generic tool.

You can think of it as a sealed scientific appliance:

```text
AI Model
  + exact Python
  + exact packages
  + exact model assets
  + startup and self-test instructions
  + compatibility information
  + build provenance
  = one Runtime Box for one exact target
```

Liatir downloads the correct box only when the user needs that AI Model. The
desktop installer therefore does not need to contain every large model and
every conflicting Python dependency.

## The current product rule

Liatir now has one AI Model installation mechanism: signed Runtime Boxes. There
is no fallback that builds a model environment on the user's computer, no
direct file-download model installer, and no built-in mock model.

The complete current product catalog is:

| AI Model | Published native targets |
| --- | --- |
| Geneformer V1 10M | macOS arm64 Metal, Linux x86_64 CUDA 12.9, Windows x86_64 CUDA 12.8 |
| scGPT Whole-human | macOS arm64 Metal, Linux/Windows CPU, Linux CUDA 12.9, Windows CUDA 12.8 |
| UCE 4-layer | macOS arm64 Metal |

All three run through the shared Single-cell Embedding AI Tool. Every listed
target has reviewed scientific and product-lifecycle evidence and is served by
the public `beta` channel. Geneformer CPU targets were dropped after measured
throughput showed they were not viable. UCE expansion beyond macOS is not part
of the completed P5 release matrix and needs a separate feasibility and evidence
decision.

A future model must complete the same legal, build, scientific, signing,
publication, product lifecycle, and evidence gates for every feasible native
target before it is generally available. "We have not built it yet" is not an
exception. A platform can be excluded only when an exact license, upstream
framework, hardware, or runner blocker is recorded and exposed honestly in the
product.

The CI foundation we completed proves that this process can safely build,
check, sign, publish, install, run, update in place, roll back, remove, and
record evidence for real AI Models across the currently supported targets.

## The problem Runtime Boxes solve

Imagine installing three scientific AI Models directly into one shared Python
environment:

- Model A needs PyTorch version X.
- Model B needs a different PyTorch version.
- Model C needs a package that is incompatible with both.
- The macOS build needs Metal support.
- Linux CUDA needs NVIDIA libraries.
- Windows uses different executable and library layouts.

Putting everything into one environment would make installations enormous and
fragile. Updating one model could break another. Shipping all dependencies in
the main Liatir application would also make every user download tools they may
never use.

Runtime Boxes solve this by isolating each runtime family. Every box has its own
identity, files, packages, compatibility rules, and failure boundary. If one
box is broken, unrelated models and workflows should remain usable.

## The essential vocabulary

### AI Model

An **AI Model** is the installable model choice visible to the user, such as:

- Geneformer V1 10M;
- UCE 4-layer;
- scGPT Whole-human.

It includes the model identity and the assets required to run it.

### AI Tool

An **AI Tool** is the scientific capability that uses a compatible model. For
example, a single-cell embedding tool can use a supported embedding model.

The model answers “which implementation performs the work?” The tool answers
“what scientific task is the user performing?”

### Runtime ID

A **runtime ID** identifies the isolated installed environment. Liatir keeps
runtime state separated by this identity instead of using one global Python
installation.

### Recipe

A **recipe** is the reviewed build instruction for one model and one target. It
declares items such as:

- the Python and pinned pixi versions for the current Scrollcase substrate;
- the dependency lock;
- source and model asset URLs;
- SHA-256 hashes;
- extraction and pruning rules;
- the expected installed size;
- the self-test command;
- compatibility requirements.

The recipe is not the Runtime Box itself. It is the reproducible instruction
used to build the box.

Every active Runtime Box scroll now uses pixi/conda-pack through the published
Scrollcase path. No uv recipe or local generic builder remains. Scrollcase P5
adoption, including the Rust consumer boundary, duplicate-helper deletion,
final local/native lifecycle and documentation handoff, is complete.

### Dependency lock

A **dependency lock** is the exact package list, including exact versions and
hashes. It prevents a build from silently receiving a newer or different
dependency simply because an upstream package changed.

### Target

A **target** is an exact operating-system, architecture, and accelerator
combination. Examples are:

- `macos-aarch64-metal`;
- `linux-x86_64-cpu`;
- `linux-x86_64-cuda12.9`;
- `windows-x86_64-cuda12.8`;
- `windows-x86_64-cpu`.

A Linux CUDA box is not a Windows CUDA box. A CPU box is not silently treated
as a GPU box. Matching the model name alone is never enough.

### Catalog

`runtime-boxes/catalog.json` is the checked machine-readable authority for:

- models and recipes;
- supported or buildable targets;
- runner profiles and timeouts;
- disk estimates and cost controls;
- validation scripts;
- publication metadata;
- retained evidence records.

The workflows receive a model ID and target ID, then resolve the important
details from this catalog. A person cannot inject an arbitrary runner or script
through a workflow input.

### Runner

A **runner** is the machine that executes a GitHub Actions job.

Different jobs need different machines:

- standard hosted runners for cheap checks;
- native macOS, Linux, or Windows runners for platform behavior;
- a Linux T4 runner for CUDA validation;
- the temporary private Apple silicon runner used for the very large UCE build.

### Release manifest

A **release manifest** is a small signed JSON document describing one immutable
box. It includes the box identity, target, archive URL, hashes, sizes,
compatibility, and provenance.

The archive contains the large runtime. The manifest tells Liatir exactly what
that archive is and how to verify it.

### Channel

A **channel** is a signed pointer that says which release should currently be
offered. The current production workflow uses the `beta` channel.

This separates two actions:

1. publishing an immutable candidate;
2. making that candidate visible to users by promoting the channel.

A candidate can therefore be uploaded without becoming live if a later check
fails.

### Registry

The Runtime Box Registry is the small control plane at `models.liatir.com`. It
serves signed channel and revocation documents and accepts authenticated
publication operations.

It does not stream multi-gigabyte Runtime Box archives through the Worker.
Large immutable assets are served directly from R2 through
`assets.models.liatir.com`.

### Digital signature

A digital signature lets Liatir prove that a release document was authorized
by the Liatir production signing system and was not modified afterward.

The private signing key is held by Google Cloud KMS and cannot be exported. The
app contains only public keys, which can verify signatures but cannot create
new valid releases.

### Evidence record

An **evidence record** is a compact JSON receipt describing what a CI run
actually proved. It can include:

- exact repository commit and recipe;
- clean or dirty source status;
- runner and hardware identity;
- dependency-lock hash;
- archive and installed sizes;
- self-test result;
- scientific fixture and output shape;
- parity metrics;
- signing key ID;
- public archive verification;
- publication and promotion receipts;
- product lifecycle result.

The evidence is small. Model weights, private keys, credentials, archives, and
raw scientific outputs are never retained as GitHub evidence artifacts.

## The complete production journey

The complete path is easier to understand as four phases:

```text
Define and check
      |
      v
Build and validate
      |
      v
Sign, publish, and promote
      |
      v
Install and run inside Liatir
```

### Phase 1: define and check

#### 1. Legal review

Before distributing a model, Liatir must confirm that it may legally
redistribute:

- source code;
- Python dependencies;
- model weights;
- supporting assets.

A permissive source-code license does not automatically permit redistribution
of model weights. This is why scFoundation remains unavailable as a
Liatir-distributed Runtime Box even though its repository code has a permissive
license.

#### 2. Pin every input

The recipe records exact sources and hashes. The dependency lock records exact
packages and hashes. If an input no longer matches, the build stops.

This prevents “the same recipe” from producing a different runtime next week
because an upstream file changed.

#### 3. Resolve the approved target

The workflow looks up the requested model and target in the catalog. It obtains
the approved:

- recipe;
- runner;
- timeout;
- validator;
- disk budget;
- mode;
- publication paths.

Unknown combinations stop before an expensive machine is allocated.

#### 4. Perform cheap preflight checks

Coordination/preflight jobs validate the catalog, legal records, target
contract, dependency-lock hash, workflow input, and calculated disk requirement
before native allocation. Heavy model-native jobs use the reviewed on-demand
self-hosted runner profiles; a preflight job does not authorize starting one.

This is important because a GPU or private runner should not be used to
discover a typo that a cheap check could have found.

### Phase 2: build and validate

#### 5. Check the real host

The native runner verifies its actual platform, architecture, free disk, and,
when relevant, GPU model and driver.

The historical hosted Windows CUDA runner was rejected because its NVIDIA
driver was too old for CUDA 12.4. The successor CUDA 12.9/12.8 targets were
validated on reviewed self-hosted profiles and subsequently published. In
general, validation alone still does not make a candidate a supported product
target; it also needs protected publication and promotion.

#### 6. Build the Runtime Box

For a migrated pixi recipe, Liatir's stable operator command invokes the exact
installed Scrollcase executable. Scrollcase:

1. installs the exact environment from the committed `pixi.lock`;
2. packs and relocates the conda-forge environment with conda-pack;
3. downloads and hash-checks every model asset;
4. safely extracts approved archives;
5. removes only explicitly reviewed unnecessary files;
6. writes build provenance;
7. runs the recipe self-test;
8. creates a normalized immutable archive;
9. calculates archive and installed sizes.

The resulting box remains self-contained: the final user does not install
Scrollcase, pixi, conda-pack, or Python. Model authoring records that have not
yet moved to schema-v2 scrolls are frozen build inputs until P5.4 migrates them;
new generic pixi work must not bypass Scrollcase.

#### 7. Run an independent self-test

After building, Scrollcase verifies the signed release and extracts it again as
an independent consumer would. Liatir composes its evidence receipt only after
that verification succeeds and the signed payload, archive size and archive
SHA-256 agree. Required imports and model-specific scientific checks remain
Liatir evidence.

This catches boxes that worked only inside the temporary build directory.

#### 8. Perform scientific validation

A process can exit successfully while producing scientifically wrong output.
Therefore, Liatir also runs model-specific validation.

Examples of checks include:

- expected input and output shapes;
- finite values rather than `NaN` or infinity;
- comparison with a pinned CPU reference;
- allowed absolute and relative differences;
- minimum cosine similarity;
- correct output and provenance contracts.

A digital signature proves authenticity. Scientific validation proves that the
candidate behaves as expected. Neither one replaces the other.

### Phase 3: sign, publish, and promote

#### 9. Obtain a production signature

GitHub does not possess a long-lived Google credential or the private signing
key. It obtains a short-lived identity through Workload Identity Federation.

The identity may call the private Cloud Run signer. The signer checks the exact
payload against its reviewed model, target, and origin policy. Only the Cloud
Run runtime identity can ask Cloud KMS to sign.

The trust chain is:

```text
Approved GitHub workflow
  -> short-lived Google identity
  -> private Cloud Run signer
  -> signer policy check
  -> non-exportable Cloud KMS key
  -> signature returned to CI
  -> signature verified with the public key
```

For protected builds, Scrollcase hands the exact canonical payload bytes to
Liatir's external signer command. That adapter obtains the short-lived identity
and calls the private Cloud Run service; Scrollcase accepts the result only if
the returned envelope contains the same payload and a locally valid signature.
No Cloud Run, GCP, KMS, Registry or Liatir credential knowledge enters
Scrollcase. Publication and promotion remain blocked until the later
verification and scientific checks pass.

#### 10. Publish immutable objects

The archive and signed release manifest are uploaded under content-addressed
paths. Their identities include hashes, and an existing immutable object is not
silently overwritten.

CI then streams the public archive back and verifies its full SHA-256. This
proves that the publicly downloadable bytes are the bytes that were built and
signed.

#### 11. Exercise the real product lifecycle

For the Linux and Windows Geneformer releases, CI built the real Liatir test
application and exercised the runtime as the product uses it. The evidence
covers:

- disk preflight;
- signed installation;
- interrupted-download resume;
- real Geneformer inference;
- Job creation and logs;
- Result creation;
- provenance;
- same-version replacement;
- rollback;
- removal;
- retained Result artifacts;
- cleanup.

This is much stronger than proving that a Python command ran successfully.

#### 12. Promote the beta channel

Promotion happens only after the required publication and product checks pass.
The Registry receives the already-signed channel document, verifies it, and
stores it in R2.

If a build fails before promotion, it is not presented as the active beta
release even if some immutable files were already uploaded.

#### 13. Write compact evidence and clean up

The workflow writes the evidence record and uploads only the small allowed JSON
files. Temporary build state is removed even when a job fails.

For a temporary self-hosted runner, cleanup also means deregistering the runner
and deleting its marked work directory.

### Phase 4: install and run inside Liatir

#### 14. Select a compatible target

The app examines the real host:

- operating system;
- CPU architecture;
- accelerator;
- NVIDIA driver when relevant;
- memory and compatibility requirements.

It selects only an exact supported target. If CUDA is unavailable or
incompatible and a supported CPU target exists, the selection rules may fall
back to CPU. They never reinterpret a Linux target as Windows or WSL2.

#### 15. Read signed control documents

The app reads the channel document, release manifest, and revocations. It
verifies their signatures using the checked-in public trust bundle.

The app does not trust the Registry merely because it uses HTTPS. A modified
document still fails signature verification.

#### 16. Plan disk usage

Installation may temporarily need space for all of these at once:

- the remaining archive download;
- the extracted new runtime;
- the currently active runtime;
- one retained rollback runtime;
- a safety margin.

This is why a box with a 3 GB archive may need much more than 3 GB free during
installation. The large UCE release has an approximately 8.86 GB archive and an
approximately 10.14 GB extracted payload, so its build and installation need
substantial temporary space.

#### 17. Download and verify

The app downloads into a partial file and can resume an interruption. It checks
the complete archive size and SHA-256 before trusting the bytes.

#### 18. Extract safely

Extraction occurs in a short sibling staging directory. The extractor rejects
path traversal, unsafe links, special entries, and unexpected payload size.

The short directory name is especially important on Windows, where deeply
nested Python and PyTorch paths can exceed legacy path limits.

#### 19. Self-test before activation

The extracted runtime executes its self-test before becoming active. A box that
cannot import its required packages is never activated as a working runtime.

#### 20. Activate atomically

Liatir swaps the staged runtime into the active location. The previous runtime
is retained for rollback. If an activation step fails, the app should not leave
an unrelated or half-installed runtime presented as ready.

#### 21. Run the AI Model

The AI Tool starts the model through its isolated runtime. The run belongs to a
stable model/tool and parent identity. It appears in Jobs with logs and reaches
Results with artifacts and provenance.

The runtime is infrastructure. Jobs and Results are the user-visible scientific
lifecycle.

#### 22. Remove without destroying Results

Removing an installed Runtime Box removes the executable environment, not the
scientific Result that was already produced. Retained Result artifacts and
provenance must remain inspectable.

## Why the system is split across several services

No single component receives every permission.

| Component | What it can do | What it cannot do |
| --- | --- | --- |
| GitHub release workflow | Build, validate, invoke the signer, publish through the Registry, and promote | Export or directly use the KMS private key |
| Cloud Run signer | Validate approved metadata and request a KMS signature | Host or publish Runtime Box archives |
| Cloud KMS | Protect and use the non-exportable signing key | Decide which model or target is allowed |
| Registry Worker | Authenticate publication, verify signed documents, and update control objects | Create a valid production signature |
| R2 | Store immutable archives and signed documents | Decide what is trusted or scientifically correct |
| Liatir app | Verify signatures, install compatible boxes, run models, and record Jobs/Results | Sign or publish production releases |

This separation limits damage if one service credential is compromised. For
example, access to R2 does not grant signing authority.

## Why we used gates

A gate is a required proof before moving to the next risk level.

The gates were not ten arbitrary development milestones. Each gate answered a
different question, and later gates depended on earlier answers.

The general progression was:

```text
Define identities
  -> make builders deterministic
  -> prove small native lifecycle
  -> select correct targets
  -> create safe workflows
  -> protect identities and signing
  -> retain evidence
  -> control cost
  -> prove real cross-platform releases
  -> prove a very large private-runner release
  -> document operations and support honestly
```

## What each gate accomplished

The gate summaries below are historical evidence from the original uv-era
foundation. They explain what was proven, not who owns the generic builder
today. Scrollcase extraction and P5 adoption preserve those Runtime Box product,
trust and lifecycle guarantees while replacing the producer implementation.

### Gate 0: one target identity contract

**Question:** Do all languages and components mean the same thing when they say
“Linux CUDA,” “Windows CPU,” or “macOS Metal”?

We created canonical target IDs shared by TypeScript, Node tooling, Rust, the
Registry, and the signer. Invalid or ambiguous targets are rejected early.

Without this gate, one layer could publish a target that another layer selects
incorrectly.

### Gate 1: native builder adapters

**Question:** Can the same high-level builder create correct boxes on macOS,
Linux, and Windows without duplicating the security and signing logic?

We separated platform-specific file and executable behavior into native target
adapters while keeping hashing, signing, provenance, and publication shared.

The builders also reject leaked build-machine paths and create deterministic,
relocatable archives.

### Gate 2: synthetic native foundation

**Question:** Does the install machinery work on each operating system before
we spend time and money on a real multi-gigabyte model?

We used small synthetic fixtures to prove build, verify, rebuild, extraction,
installation, resume, activation, rollback, removal, and cleanup behavior.

This gate intentionally did not claim scientific AI validation. It tested the
delivery machinery cheaply.

### Gate 3: host selection and provenance

**Question:** Will Liatir choose the correct box for the real computer and
record exactly what was used?

The shared core now owns ordered target candidates. Selection considers the
platform, architecture, RAM, GPU, and driver. The exact signed release identity
flows into installed state, Jobs, Results, and provenance.

### Gate 4: workflow topology

**Question:** Are cheap checks, native validation, GPU work, production release,
and signer deployment separated correctly?

We created:

- shared foundation workflows;
- reusable validation workflow logic;
- model-specific Geneformer, scGPT, and UCE callers;
- manual GPU preflights;
- a protected production release workflow;
- a separate protected signer-deployment workflow.

Automatic events may run cheap checks. They do not automatically start a
costly model build or production release.

### Gate 5: protected identities and secrets

**Question:** Can GitHub sign and publish without storing a permanent Google
private credential or receiving the KMS key?

We configured two protected GitHub Environments:

- `runtime-box-production` for releases;
- `runtime-box-signer-admin` for signer deployment.

Separate Workload Identity Federation providers bind the exact repository,
`main` branch, Environment, workflow path, and manual dispatch event to
least-privilege service accounts.

The release and deployment identities have no KMS role. Only the private signer
runtime identity can use the signing key.

### Gate 6: evidence and artifact policy

**Question:** Can we prove what happened without leaking credentials or storing
huge model files in GitHub?

We defined a shared evidence contract and retention policy. CI uploads compact
JSON evidence only. A human reviews successful production evidence before it
is committed and referenced by the catalog.

### Gate 7: cost and trigger controls

**Question:** Can a typo, push, or shared workflow change unexpectedly allocate
an expensive GPU or heavy runner?

We added manual-only expensive workflows, catalog-resolved runners, concurrency
limits, timeouts, dependency-lock checks, disk planning, native host probes,
and concise heartbeats.

The rule is simple: use free checks to debug; use a paid runner only to prove an
already-reviewed candidate.

### Gate 8.1: real Linux Geneformer pilot

**Question:** Can a real AI Model complete the entire production and product
lifecycle on Linux CPU and Linux CUDA?

Geneformer V1 10M completed the chain on:

- Linux CPU in run `29547725429`;
- Linux CUDA on a real Tesla T4 in run `29643382673`;
- current-code Linux CUDA revalidation in run `29750614689`.

The evidence includes locked build, self-test, scientific parity, KMS signing,
immutable publication, public hash verification, native product install, real
inference, Jobs, Results, provenance, replacement, rollback, removal, beta
promotion, and cleanup.

This proved that “published” meant more than “an archive exists.”

### Gate 8.2: native Windows Geneformer

**Question:** Does the complete path also work on native Windows rather than
being inferred from Linux?

Windows CPU passed the full protected release in run `29706828552`.

This work found several real Windows-specific problems, including:

- `npm` invocation differences;
- paths long enough to break loading of nested PyTorch DLLs;
- a different standalone-Python executable layout;
- WebDriver navigation and timeout behavior;
- a product finalization issue exposed when page reloads were removed;
- transient Windows file locks during activation and rollback.

These were fixed and covered before the target was marked published.

Windows CUDA was also designed and wired, but it was not validated or
published. The GitHub Windows T4 runner reports NVIDIA driver `471.11`, which
is too old for the CUDA 12.4 runtime. The host probe rejects it before an
expensive build. The target remains **unsupported**.

This is an important lesson: implemented and buildable do not mean supported.

### Gate 8.3: cross-platform closure

**Question:** After all shared changes, do the supported targets still have a
complete, internally consistent evidence chain?

We audited macOS arm64 Metal, Linux CPU, Linux CUDA, and Windows CPU. We aligned
the catalog, shared core, support matrix, readiness claims, production records,
and product evidence.

macOS regression run `29880520628` proved that the then-current shared builder still
passed clean build, self-test, Metal parity, Rust lifecycle, evidence, and
cleanup. It did not republish because no shared-builder incompatibility was
found.

Gate 8 closed with four in-scope supported targets. Windows CUDA was formally
removed from Gate 8 scope rather than pretending it had passed.

### Gate 9: large macOS private runner

**Question:** Can the protected release system handle a model too large for the
ordinary macOS workflow while leaving no permanent private runner online?

UCE 4-layer needs roughly 9.12 GB of source assets, creates an approximately
8.86 GB archive, and installs to approximately 10.14 GB. We created a
repository-scoped, single-concurrency, temporary Apple silicon runner process
with:

- a dedicated marked work directory;
- a 35 GiB free-space bootstrap floor;
- no installed background service;
- a bounded online lifetime;
- unconditional deregistration and directory removal;
- retained diagnostics;
- no local signing key.

The first protected attempt, run `29889431937`, failed before signing or
publication. Extracting the protein-embedding archive deleted sibling assets in
the same destination. The failure was diagnosed from evidence, reproduced with
local regression tests, and fixed so extraction merges safely and rejects
collisions.

After fresh approval, run `29909249357` passed the complete protected UCE build,
KMS signing, independent self-test, Metal scientific parity, immutable R2
publication, public hash verification, beta promotion, evidence upload, and
cleanup. The runner deregistered and its marked root was removed.

This gate proved both large-model delivery and safe temporary-runner lifecycle.

### Gate 10: operational handoff

**Question:** Could someone else — a person or an agent — operate and continue the
system without guessing from chat history or exposing secret values?

We aligned:

- the canonical gate ledger;
- the production report;
- the support matrix;
- Runtime Box documentation;
- signer operations;
- Registry operations;
- AI roadmap and Beta readiness;
- the current project handoff.

The handoff records Environment names, variable and secret names, workflows,
WIF principals, service accounts, resource ownership, verified run IDs,
commands, stop conditions, cleanup, and incident procedures. It records names,
never secret values.

Local closure passed the catalog check, 11 signer tests, 164 unit and contract
tests, SDK/core/frontend/TypeScript builds, Svelte checks, and the internal
documentation build. Gate 10 required no paid or remote execution.

## What is supported now

### Geneformer V1 10M

| Target | State |
| --- | --- |
| macOS arm64 Metal | Supported and published |
| Linux x86_64 CUDA 12.9 | Supported and published |
| Windows x86_64 CUDA 12.8 | Supported and published |
| Linux/Windows x86_64 CPU | Not product targets; measured throughput was not viable |

### Other current boxes

- UCE 4-layer: supported and published for macOS arm64 Metal.
- scGPT Whole-human: supported and published for macOS arm64 Metal,
  Linux/Windows CPU, Linux CUDA 12.9 and Windows CUDA 12.8.
- WSL2 Runtime Box execution: unsupported and unverified.
- macOS Intel: not an active Runtime Box target.

CUDA support must always be stated with its operating system. “CUDA works” is
too vague; the reviewed evidence covers the specific Linux 12.9 and Windows
12.8 targets above.

## What the completed foundation does not prove

Completing Gates 0–10 does **not** mean:

- every Liatir AI Model is validated on every platform;
- every future Windows/CUDA combination works beyond the exact published
  Windows CUDA 12.8 targets;
- WSL2 works;
- every scientific integration in Liatir is production-ready;
- the complete desktop application release matrix is finished;
- a true upgrade from one Runtime Box version to a newer version has passed;
- the client already persists anti-replay state across restarts;
- every restrictive model license permits redistribution;
- a valid signature guarantees scientifically meaningful output.

The foundation proves that the shared delivery system works for its reviewed
scope and that support claims can be tied to concrete evidence.

## What remains next

The next Runtime Box product work is separate from the completed CI foundation:

1. complete the Scrollcase P5 legacy-deletion audit now that the Rust consumer
   boundary is closed;
2. prove a true native update from one version to a different version;
3. persist anti-replay channel state in the client so an older signed channel
   generation cannot silently replace a newer one after restart.

After that bounded work, the broader Scientific AI Workbench roadmap continues
with the common execution spine, scientific artifact profiles, the single-cell
lighthouse workflow, viewers, downstream reuse, and external workflow adapters.

## Common questions

### Is a Runtime Box a Docker container?

No. A Runtime Box is an archive installed and run directly by the native Liatir
desktop application. It contains a relocatable runtime, but it is not a Docker
image and does not require Docker.

### Why not ask users to install Python?

The correct Python and dependency combination is part of the reproducible
scientific environment. Depending on a user's global Python would create
version conflicts and make results harder to reproduce.

### Why is the archive so large?

The archive may contain standalone Python, PyTorch, scientific libraries,
model weights, source code, lookup tables, and other model assets. GPU builds
also contain large accelerator libraries.

### Why can installation require more free space than the download size?

During installation, the archive, extracted candidate, active runtime, retained
rollback, and safety margin may coexist. Compressed download size is therefore
not the same as peak required disk space.

### Why use both R2 and a Registry Worker?

R2 efficiently stores and serves large immutable objects. The Worker handles
small authenticated control operations such as channel promotion and
revocations. Keeping archives off the Worker reduces cost and complexity.

### Why sign JSON instead of only signing the ZIP archive?

The app must trust not only the archive bytes but also the model identity,
target, sizes, compatibility, URL, provenance, and channel selection. These
facts live in signed documents.

### Can someone with the Registry token create a malicious valid release?

The Registry token can authorize storage and promotion operations, but it
cannot create a valid KMS signature. The Worker verifies signed documents, and
the app independently verifies them again.

### Why did we publish immutable candidates before some runs eventually failed?

Publication and promotion are deliberately separate. A content-addressed
candidate may exist in R2, but users do not receive it until the channel is
successfully promoted. Failed candidates remain unpromoted audit artifacts.

### Why did Windows need its own real test?

Windows has different executable layouts, path limits, shell behavior, file
locking, and WebDriver behavior. Linux success cannot prove native Windows
behavior.

### Is Windows CUDA supported?

Yes, for the exact published `windows-x86_64-cuda12.8` Geneformer and scGPT
targets. This does not imply support for old CUDA 12.4 identities, arbitrary
CUDA versions, WSL2 execution, or another model without its own evidence.

### Does a successful self-test prove scientific correctness?

No. A self-test proves that the packaged runtime is structurally usable and can
load required components. Scientific validation separately checks real model
behavior and output.

### Does the signature encrypt the Runtime Box?

No. The signature proves authenticity and integrity. The archives are public
distribution assets, not encrypted secrets.

### What happens if a release must be withdrawn?

Liatir supports signed revocation documents. New installation or activation of
a revoked version is refused. Immutable R2 objects are retained for audit
rather than silently deleted.

The distribution CLI accepts multiple entries and, by default, verifies and
carries forward the complete live revocation set before signing a replacement.
The protected `runtime-box-revoke.yml` workflow reads the public document back
and fails unless every requested entry is served. The current live document
jointly revokes Geneformer `1.0.0-beta.1` and scGPT `0.2.5-beta.1`; UCE
`1.0.0-beta.1` is not included and needs an explicit decision if it should be.

### Does “foundation complete” mean there will never be more Runtime Box work?

No. It means the bounded CI foundation has passed its defined gates. New model
families, targets, update behavior, trust rotation, or operational changes need
their own scoped evidence.

## Where to look in the repository

| Need | Source of truth |
| --- | --- |
| Current quick status | `.context/state/current.md` |
| Complete gate history | `.context/state/roadmap/runtime-box-ci-foundation.md` |
| Production resources and operator procedures | `.context/history/runtime-box-production-report.md` |
| Live model/target/publication catalog | `runtime-boxes/catalog.json` |
| Human-readable support matrix | `runtime-boxes/compatibility-matrix.md` |
| Reviewed compact evidence | `runtime-boxes/evidence/` |
| V2 scrolls and dependency locks | `runtime-boxes/scrolls/` |
| Legal reviews | `runtime-boxes/legal/` |
| Shared TypeScript contract | `packages/liatir-core/src/runtime-box.ts` |
| Generic box contract, pixi build, signing envelope and verify | Exact v2-only external dependency `scrollcase@0.8.0`; public exports and declared `scrollcase` executable only |
| Rust generic consumer | Exact `scrollcase-consumer 0.3.2` through its public API |
| Stable Liatir operator dispatcher | `scripts/runtime-box.mjs` and `scripts/runtime-box/scrollcase-adapter.mjs` |
| Private signer adapter | `scripts/runtime-box/signer-command.mjs` |
| Liatir distribution operations | `scripts/runtime-box/distribution-cli.mjs` |
| CI orchestration and evidence | `scripts/runtime-box-ci.mjs`, `scripts/runtime-box/evidence.mjs`, and model validators |
| Protected production release | `.github/workflows/runtime-box-release.yml` |
| Protected revocation | `.github/workflows/runtime-box-revoke.yml` |
| Protected signer deployment | `.github/workflows/runtime-box-signer-deploy.yml` |
| Signer policy | `services/runtime-box-signer/policy.json` |
| Signer operations | `services/runtime-box-signer/README.md` |
| Registry implementation and operations | `workers/runtime-box-registry/` |
| App public trust roots | `runtime-boxes/trust/production-public.json` |

## One final mental model

Remember the system this way:

```text
The recipe says how to build it.
The lock says exactly what goes into it.
The target says where it may run.
The validator says whether it behaves correctly.
The signer says Liatir authorized it.
R2 stores the immutable bytes.
The Registry says which signed release is currently offered.
The app verifies, installs, runs, and records it.
The evidence proves what actually happened.
The gates stopped us from claiming success before every required proof existed.
```
