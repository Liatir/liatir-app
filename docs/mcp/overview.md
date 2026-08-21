# Local MCP

Local MCP lets an MCP-compatible client ask Liatir to run a pipeline you have
already saved. Liatir keeps control of the scientific workflow: the client can
request a run, but you must approve that request in the app before anything
starts.

The server is local to your computer, off by default, and is not required for
using Liatir normally.

## Connect a client

1. Build and save the pipeline you want to reuse.
2. Open **Settings → Local MCP**.
3. Select **Turn on**.
4. Select **Allow** beside the saved pipeline.
5. If the pipeline accepts source files, allow only the files it may use under
   **Source files from Data**.
6. Optionally select **Allow Results** if the client may read Results that it
   did not create itself.
7. Copy the current **Server URL** and **Bearer token** into your MCP client.

Configure the client to use Streamable HTTP and send the token as:

```text
Authorization: Bearer <token copied from Liatir>
```

The server URL uses a local address such as
`http://127.0.0.1:49152/mcp`. Its port can change when Liatir restarts, so copy
the current URL again after restarting the app. Liatir must remain open while a
client is connected.

Treat the bearer token like a password. **Rotate token** immediately disconnects
clients that still use the old token.

## What a client can do

The Liatir MCP surface exposes three tools:

- `start_saved_pipeline` requests one allowed saved pipeline by `pipeline_id`
  and supplies its declared `inputs`;
- `cancel_pipeline_run` requests cancellation of one run that was started
  through MCP, by its stable `run_id`;
- `cancel_job` requests owner-aware cancellation by an MCP-visible `job_id`.
  Liatir cancels the owning Pipeline Run, so Jobs and Results cannot be left in
  contradictory states.

Read `liatir://workspace/active/pipelines` before starting a run. Every allowed
pipeline includes its current input descriptors and stable input IDs. Supply
values in one `inputs` object:

```json
{
  "pipeline_id": "saved-pipeline-id",
  "inputs": {
    "fastqc-node:node-input:input": {
      "artifactId": "allowed-data-artifact-id"
    },
    "threshold-node:variable:value": 0.05
  }
}
```

String, number and boolean fields use their JSON scalar types. File fields use
an `artifactId` advertised by `liatir://artifacts`; filesystem paths are never
accepted. You may omit a field to keep the value saved in the pipeline or its
declared default.

The input contract includes every value the client can vary across every
pipeline execution family:

- Native Tool inputs;
- AI Tool inputs, including selection among that tool's currently installed and
  compatible AI Models;
- `.lia` Plugin inputs;
- saved External Workflow inputs and parameters;
- scientific viewer and other utility-step inputs;
- public enabled API Connector parameters;
- Variable values, Math operands and Condition values;
- all the same inputs inside nested sub-pipelines.

Values already supplied by a pipeline connection stay internal to the graph.
Private API parameters, the graph topology, operations and condition operators
remain part of the immutable saved revision. If an AI Tool exposes an AI Model
input, the client receives a closed list of compatible installed models; an
unavailable or incompatible model ID is rejected.

A start request returns its run ID immediately with
`awaiting-authorization`. Liatir then shows a dialog with the client, workspace,
pipeline, run identity and supplied inputs. Approving it starts that exact
saved revision with those values;
denying it creates no pipeline execution, Job or Result.

An approved run follows the normal Liatir lifecycle. Its work appears in
**Jobs**, and its terminal outcome appears in **Results** with MCP initiator and
run identity. A client reads progress separately through these resources:

- `liatir://workspace/active` — active workspace identity;
- `liatir://workspace/active/pipelines` — currently allowed pipeline revisions;
- `liatir://runs` — MCP-owned runs in the active workspace;
- `liatir://runs/{run_id}/status`;
- `liatir://runs/{run_id}/logs`;
- `liatir://runs/{run_id}/result`;
- `liatir://jobs` and `liatir://jobs/{job_id}` — only Jobs owned by MCP runs;
- `liatir://results` and `liatir://results/{result_id}` — available only after
  the workspace-level **Allow Results** permission;
- `liatir://artifacts` and `liatir://artifacts/{artifact_id}` — path-free
  metadata for readable files;
- `liatir://artifacts/{artifact_id}/content/{offset}/{length}` — one bounded
  content chunk, with `length` from 1 through 65,536 bytes.

Text chunks are returned as text. Binary chunks are base64 MCP blobs. Clients
can continue with the next offset until the returned chunk is shorter than the
requested length.

## File and Result permissions

Permissions are scoped to the active workspace:

- a Result created by an MCP run is readable through that run without a second
  permission;
- **Allow Results** exposes the workspace's Result list, Result output and
  registered files linked to those Results;
- **Source files from Data** grants individual registered files for reading and
  for file inputs;
- revoking either permission takes effect on the next read and invalidates a
  waiting request that depends on the revoked artifact.

Liatir resolves artifact IDs internally at execution time. Resource metadata,
Results and Job output replace registered paths with logical artifact URIs and
never expose an arbitrary filesystem browser.

## Safety boundary

Allowing a pipeline applies only to its exact saved revision. Editing and
saving the pipeline makes the grant stale; return to Settings and review the
new revision before allowing it again.

An MCP client cannot:

- edit or construct a pipeline;
- install, update or remove an AI Model;
- define or edit an External Workflow;
- supply an undeclared input, a private API parameter, a new pipeline
  connection or a raw path;
- change operations, topology or settings that were not declared as run-time
  inputs;
- run arbitrary shell commands;
- browse arbitrary files or unapproved workspace state;
- cancel work that was not started through MCP.

The saved pipeline itself still has the capabilities you configured in Liatir.
For example, it may contain an API Connector, External Workflow, or AI Tool
using a heavy AI Model, network access or local dependencies. MCP can select an
advertised installed-compatible model and pass declared inputs, but it cannot
manage model installations or alter the workflow definition. Review the
complete saved pipeline before allowing it.

Every authenticated tool request is recorded in the local MCP audit log,
whether it succeeds or is rejected. Successful resource listings and reads are
recorded too. The most recent security activity is visible in
**Settings → Local MCP**. Turning the server off rejects new requests and any
request still waiting for approval; it does not silently stop a run you already
approved. Cancel that run explicitly from Liatir or the MCP client.

## Troubleshooting

### The client reports unauthorized

Copy the bearer token again, including no spaces before or after it. If the
token was rotated, replace the old value in the client.

### The client cannot connect

Confirm that Liatir is open and **Local MCP** says **Ready for local clients**.
Copy the current Server URL again after every Liatir restart. The endpoint is
loopback-only and cannot be used from another computer.

### A pipeline is not listed or the request says it is not allowed

Save the pipeline, then allow it in **Settings → Local MCP**. If it says
**Changed since it was allowed**, review it and select **Allow new revision**.
Only pipelines in the active workspace are exposed.

### A request is waiting

Bring Liatir to the foreground and approve or deny the authorization dialog.
The client identity shown there is self-reported metadata; base your decision
on the pipeline, workspace and request you expected, not the client name alone.

Liatir implements MCP protocol revision `2026-07-28` over local Streamable HTTP.
