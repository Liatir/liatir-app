# Controlled local MCP boundary

Status: Scientific AI Workbench Gate 8 cross-platform complete, schema version 1

Owner: `packages/liatir-core`  
Protocol: MCP `2026-07-28`, Streamable HTTP

## Product boundary

MCP is an optional interoperability boundary around Liatir's existing saved
pipeline runtime. It is not an agent, a second orchestrator, or a prerequisite
for the workbench. The user builds and saves the scientific graph in Liatir;
an external client can request that exact saved revision with its declared
run-time inputs and then inspect permission-scoped Jobs, Results and artifacts.

The server exposes three tools and no general invocation surface:

- `start_saved_pipeline({ pipeline_id, inputs })` validates values against the
  input contract frozen into the revision grant, allocates a durable UUID
  before user authorization and returns it in `awaiting-authorization` state;
- `cancel_pipeline_run({ run_id })` can target only a non-terminal run created
  through this MCP boundary;
- `cancel_job({ job_id })` accepts only a Job attributed to an MCP-owned root
  run and routes cancellation through that root owner rather than killing a
  child process behind the pipeline lifecycle.

The input contract recursively covers every client-settable field of every
pipeline execution family: Native Tools; AI Tools, including selection among
the AI Tool's currently installed and compatible AI Models; `.lia` Plugins;
saved External Workflows; scientific viewers and other utility steps; enabled
non-private API Connector parameters; Variable values; Math operands; Condition
values/comparisons; and the same families inside nested sub-pipelines. Connected
fields are produced inside the graph. The client cannot inject `@pipe:`
references, private Connector parameters, operations, condition operators or
topology. File values are `{ artifactId }`, never paths. There are no arbitrary
command fields, pipeline mutation methods, filesystem browser, prompt surface,
sampling surface, or model-chosen scientific decisions. MCP cannot install,
update or remove an AI Model, or define/edit an External Workflow; it can only
supply declared run-time inputs to an already saved and explicitly allowed
pipeline revision.

## State ownership

| Entity | Owner and persistence | Identity and isolation |
| --- | --- | --- |
| HTTP listener | App process; runtime-only ephemeral loopback port | One listener for the app lifetime; policy can remain disabled |
| MCP policy | App-global `mcp/config.json` | Enabled flag, 64-hex bearer token, revision/input grants, Result-workspace grants and Data-artifact grants |
| Pipeline grant | MCP policy | Workspace ID + pipeline ID + exact saved `updatedAt` revision + derived input schema snapshot |
| Run request | App-global `mcp/requests.json`, capped at 500 | Stable UUID allocated before approval; workspace, pipeline revision, input schema/values and client metadata |
| Pipeline execution | Existing frontend pipeline store and common execution spine | Same UUID is the root Pipeline Run and Result identity; independent pipelines remain independent |
| Job and Result | Existing native Job backend and workspace Result store | Parent/root execution identity includes `initiator.kind = "mcp"` and request/client metadata |
| Artifact | Existing workspace Data index and physical file owner | Logical artifact ID; readable only through MCP-owned Result, workspace Result grant or explicit Data grant |
| Audit record | App-global `mcp/audit.json`, capped at 1,000 | Independent UUID; action, outcome and relevant workspace/pipeline/run identity |

Configuration writes are atomic. The configuration file containing the token
is mode `0600` on Unix. A malformed durable MCP file fails visibly instead of
being replaced with an apparently safe empty state.

## Trust boundaries

```text
MCP client
    │ Streamable HTTP + exact bearer token
    ▼
127.0.0.1:<ephemeral>/mcp
    │ three tools + scoped read-only resources
    ▼
durable request awaiting authorization
    │ main-window user approval; grant/revision revalidation
    ▼
existing saved-pipeline runtime
    │ common execution identity
    ├── owner-attributed Job and child-run evidence
    ├── exactly-once terminal Result
    └── registered artifact IDs and bounded content reads
```

The MCP endpoint does not reuse the broad `.lia` Plugin IPC token or its HTTP
dispatcher. Native MCP administration commands additionally require Tauri's
injected `WebviewWindow` label to be exactly `main`; a Plugin webview cannot
enable the server, retrieve the bearer token, change grants, resolve approval,
or read the private audit index.

The MCP client `name` and `version` come from protocol initialization and are
self-reported audit metadata only. They grant no authority.

## Network and protocol policy

- Bind only to `127.0.0.1` on an OS-assigned port.
- Keep the feature disabled by default. The listener remains local and inert
  while policy is disabled.
- Require an exact `Authorization: Bearer <token>` value for every MCP request.
- When `Origin` is present, accept only well-formed
  `http://127.0.0.1:<port>` or `http://localhost:<port>` origins. Non-browser
  clients may omit `Origin`.
- Reject invalid authorization before audit persistence so an unauthenticated
  local process cannot exhaust the audit file.
- Cap each HTTP request at 1 MiB, each pipeline input payload below half that
  bound, each exposed input contract at 256 fields and each artifact content
  response at 64 KiB.
- Return `ttlMs: 0` and private cache scope for tools, resource lists,
  templates and resource reads. Workspace/run state must never be reused as
  public or stale client cache data.
- Rotate the token without changing grants. The previous token stops working
  immediately.

The app process must remain open. The endpoint port is not durable and clients
must read the current URL after restart. No TLS or remote-network mode exists;
loopback binding plus bearer authentication is the deliberate local-only
contract, not a remote deployment recipe.

## Authorization lifecycle

1. The server verifies enabled policy, active workspace, saved pipeline,
   revision-bound grant, exact argument keys, declared JSON input types,
   artifact permissions and absence of another non-terminal MCP run for the
   same pipeline.
2. It allocates and persists the run ID, records `run-requested`, focuses the
   main window and emits an authorization event.
3. The modal names the self-reported client, active workspace, pipeline and run
   ID and shows every supplied input beside fields that retain saved values. No
   execution record, Job or Result exists yet.
4. Approval revalidates active workspace, saved revision, input-schema snapshot,
   allowlist and current artifact permissions. Denial becomes terminal without
   creating execution evidence.
5. The controller marks the request queued/running and invokes the exact saved
   revision with the preallocated ID and MCP initiator metadata.
6. The frontend resolves artifact IDs to registered paths only after approval,
   applies values to an execution-only view of the graph and leaves the saved
   pipeline untouched.
7. Existing pipeline, Job and Result paths own execution and cancellation.
8. The controller persists `done`, `error`, `cancelled` or `interrupted` with
   Result identity where available. Reads join the durable control record with
   existing execution, Job and Result evidence.

Revoking a pipeline or artifact grant, disabling workspace Result reads, or
disabling the server denies waiting requests whose authority is no longer
valid. None silently kills already approved work; that work must use the normal
owner-scoped cancellation path. On app restart or workspace activation,
approved non-terminal requests reconcile against durable execution state. A
known terminal execution is copied back to the MCP request; otherwise it becomes
`interrupted` rather than remaining falsely active.

Only one non-terminal MCP run for the same saved pipeline is accepted at a
time. Runs of different pipelines are isolated and may proceed concurrently.

## Read-only resources and file authority

The server exposes only:

- `liatir://workspace/active`: active workspace ID and name;
- `liatir://workspace/active/pipelines`: currently valid grant metadata for
  the active workspace, not pipeline graphs or parameters;
- `liatir://runs`: at most the latest 100 MCP-owned runs in the active
  workspace;
- `liatir://runs/{run_id}/status`: durable request plus matching execution;
- `liatir://runs/{run_id}/logs`: matching MCP execution records and logs;
- `liatir://runs/{run_id}/result`: matching terminal Result metadata/output;
- `liatir://jobs` and `liatir://jobs/{job_id}`: sanitized Jobs whose root
  identity belongs to an MCP request;
- `liatir://results` and `liatir://results/{result_id}`: at most the latest 200
  Results when the active workspace has the explicit Result-read grant;
- `liatir://artifacts` and `liatir://artifacts/{artifact_id}`: path-free
  metadata for currently readable registered files;
- `liatir://artifacts/{artifact_id}/content/{offset}/{length}`: 1–65,536 bytes
  from a regular non-symlink file, returned as UTF-8 text for text media or an
  MCP base64 blob otherwise.

Run resources require the run to belong to MCP and to the current active
workspace. An artifact is readable only when it is linked to an MCP-owned
Result, linked to any Result while workspace Result reads are enabled, or
individually granted from Data. The artifact ID is resolved against the active
workspace's Data index; a caller-supplied path never enters the read or pipeline
input boundary.

Result metadata omits stored inputs and parameters, replaces output files with
artifact descriptors and recursively replaces registered paths in structured
output. Job resources omit command, arguments and raw metadata. Run status
omits execution payloads, while logs replace known workspace and app-storage
paths with logical identifiers. Scientific logs and Results can still contain
sensitive domain content, so the user must protect the token and approve only
expected requests.

## Threat model

| Threat | Control | Remaining limit |
| --- | --- | --- |
| Remote or DNS-rebinding access | IPv4 loopback bind, strict optional `Origin`, bearer auth | A local process that steals the token can make requests |
| Token disclosure | Hidden UI value, private config on Unix, exact comparison, user rotation | OS-level compromise is outside the app boundary |
| Stale grant or approval race | Grant bound to exact saved revision and revalidated at request and approval | The approved saved graph may intentionally use external systems |
| Plugin privilege escalation | Separate endpoint/token and dispatcher; every admin command is main-window-only | Main-window compromise has the same authority as the user-facing app |
| Arbitrary execution | Three closed JSON schemas, revision-frozen inputs, no graph references, shell or generic invoke tool | Tools already present in the saved graph retain their configured capability |
| Arbitrary file disclosure | Artifact IDs resolved against active Data; Result/Data grants; no path arguments; regular non-symlink files; 64 KiB chunks; path-free metadata | Permitted scientific files and Result content remain sensitive by definition |
| Cross-workspace disclosure | Active-workspace filtering and MCP-run ownership checks | Switching workspace makes another workspace's run temporarily unreadable by design |
| Replay and duplicate work | Durable UUID, one active MCP run per pipeline, terminal-state checks | Different allowed pipelines may run concurrently by product design |
| False completion after restart | Common execution records, terminal reconciliation, explicit `interrupted` fallback | The MCP control layer does not resurrect an orphaned computation |
| Audit or request-file exhaustion | Bounded indexes and unauthenticated rejection before persistence | Oldest records age out; this is a local activity ledger, not immutable compliance storage |

## Audit contract

The audit records server enable/disable, token rotation, pipeline/Result/Data
allow and revoke, resource list/read, run request/authorization/denial/start/
cancel/finish, Job-origin cancellation and rejected tool requests. Each
accepted protocol operation carries the self-reported client metadata where
available. Authentication failures are intentionally not persisted; HTTP
status is the rejection evidence at that outer boundary.

## Verification

The native Gate 8 E2E uses the pinned official TypeScript MCP client with
protocol negotiation pinned to `2026-07-28`. It proves:

- the invalid-token `401` boundary and the exact three-tool/resource surface;
- revision-bound allowlisting and stale-grant rejection after a saved edit;
- explicit schema discovery for Native Tools, AI Tools and compatible installed
  AI Models, `.lia` Plugins, External Workflows, scientific viewers, API
  Connectors, Variable/Math/Condition nodes and nested sub-pipelines;
- rejection of an AI Model ID outside the advertised installed-compatible
  option set, before approval or execution;
- discovery and execution of a file input by allowed artifact ID, including
  rejection of unknown inputs and ungranted artifacts;
- stable asynchronous identity before approval;
- approval followed by a real FastQC Pipeline Run, one Job, one Result, logs
  and MCP initiator attribution;
- approval of a saved SeqKit pipeline whose registered FASTQ path contains a
  space, with declared file and numeric inputs, one Native Tool Job, exactly one
  terminal Result, 17 expected records, root/initiator inheritance and no
  mutation of the saved graph;
- owner-aware Job and run cancellation settling Job and Result as cancelled;
- workspace Result listing, path-free Result output, explicit Data access,
  bounded text content reads and immediate permission revocation;
- denial creating no execution, Job or Result;
- required audit actions.

Focused core tests pin the shared schema/revision helper and initiator
inheritance. The SeqKit parser regression pins aligned output whose first file
column contains spaces. Rust tests pin exact token comparison, loopback Origin
parsing, main-window-only administration, the three permitted per-run resource
kinds, and redaction of an absolute output path that is not one of the
registered host-path replacements.

The same official-client scenario passes `1/1` against both the real native
Windows app and an independently compiled Linux x86_64 ELF app. On Windows it
asserts `lia_native_tools_environment().execution === "wsl2"` and the
successful SeqKit Result proves the complete `liatir.exe -> WSL2 bundled tool`
crossing. Under Linux/Xvfb it asserts `execution === "native"`, so the ELF app
executes its bundled SeqKit directly. FastQC remains the lifecycle and
cancellation fixture; it is not treated as evidence for the Windows Native
Tools boundary.

On each platform `npm run test:verify` passes 57 files / 342 tests and the
complete UI profile passes 5 suites / 0 failed / 2 platform-skipped, with the
native Tauri E2E sub-run at 33 passed / 0 failed / 23 skipped. Windows Rust is
80 passed / 2 ignored; Linux Rust is 79 passed / 2 ignored; Clippy exits 0 on
both at the existing warning baseline. The earlier macOS arm64 real-client
proof remains 1/1; its separate full-profile WebDriver `SIGABRT` is not
rewritten as green evidence. Exact hosts, toolchains, archive digests, commands,
prerequisites and failure/retry history are in
[Gate 8 MCP — Windows and Linux evidence](../roadmap/gate-8-mcp-windows-linux.md).

## Explicit exclusions

- remote MCP hosting, TLS termination or LAN exposure;
- arbitrary paths, unregistered/ungranted files, shell, command invocation or
  Plugin administration;
- pipeline creation, graph mutation, new connections, private Connector
  parameters or undeclared input overrides;
- automatic approval or trust based on the client-reported name;
- autonomous scientific selection, preprocessing or interpretation;
- cancellation of user-, Plugin- or other non-MCP-owned runs;
- replacing the Jobs, Results or saved-pipeline runtime with MCP-specific
  execution state.
