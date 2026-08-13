# External Workflows

External Workflows let you run a saved workflow engine project from Liatir and
reuse the same definition as one step in a larger Liatir pipeline. Nextflow is
the first supported engine.

Liatir does not replace Nextflow or edit its DSL. Nextflow still owns its
process scheduling, executors, cache and internal parallelism. Liatir provides
the common inputs, Jobs, Results, provenance and output handoff around it.

## Requirements

Install [Nextflow](https://docs.seqera.io/nextflow/install) and a compatible
Java runtime on the execution host. Both `nextflow` and `java` must be available
on `PATH`; Liatir checks their paths and versions before a run.

The verified execution paths are:

| Liatir app | Nextflow backend |
| --- | --- |
| macOS arm64 | Native macOS arm64 |
| Linux x86_64 | Native Linux x86_64 |
| Windows 11 x86_64 | WSL2 Linux x86_64 |

On Windows, install Nextflow and Java inside an x86_64 WSL2 distribution. Do
not install an unofficial native Windows Nextflow build or add a
`nextflow.cmd` wrapper. Liatir calls `wsl.exe` directly, validates that the
selected distribution is WSL2 x86_64, and checks its Linux utilities before
enabling a run. The default WSL distribution is used unless the advanced
`LIATIR_WSL_DISTRIBUTION` environment variable is set before Liatir starts.
WSL1 and WSL ARM64 are not supported by this adapter.

The first release does not install Nextflow, configure HPC or cloud executors,
or download workflow dependencies for you. Local workflows can run without a
network connection when their own dependencies are already available. A
repository source may need network access unless Nextflow has cached it.

## Save a workflow

1. Open **Tools → External Workflows** and choose **New workflow**.
2. Select a local Nextflow script, or enter a repository with a fixed tag or
   commit. Moving branch names such as `main` are not accepted.
3. Describe the parameters and file inputs that users should fill in.
4. Declare every output with its exact path below the workflow output folder.
5. Save the definition.

Wildcard output paths are intentionally unsupported. Only files explicitly
declared in the saved definition become Liatir outputs.

## Run it directly

Open the saved definition, choose its inputs and parameters, then select
**Run workflow**. The run receives its own Job and Result. Liatir copies the
source, configuration and inputs into an isolated run folder; it does not
modify the originals.

The Result includes the declared files plus the actual execution backend,
Nextflow and Java versions, command, source revision, parameters, profile,
configuration digest, task states, logs, trace, report, timeline and exit
status. Declared files can be added to **Data** and reused without searching
the Nextflow work directory.

For a Windows run, Liatir creates one run-owned staging folder on the host,
copies source, optional configuration and inputs into it, and safely maps those
paths for the selected WSL distribution. Nextflow sees Linux paths, while
Liatir collects and hashes only the declared output files back on Windows. The
original source and inputs are never changed.

## Use it in a pipeline

Saved definitions appear in the pipeline palette under **External Workflows**.
Adding one creates a reference to the same definition rather than a copy. Its
declared inputs and outputs behave like the fields of other Liatir nodes, so an
output can feed a built-in tool, Native Tool, `.lia` Plugin, AI Tool, viewer or
another External Workflow.

A nested run keeps the parent Pipeline Run identity while using the same
Nextflow adapter and output rules as a direct run. Nextflow process tasks appear
inside the workflow Job instead of becoming unrelated top-level Jobs.

## Cancellation and resume

Cancelling a run stops only that External Workflow Job. On Windows, every run
has a separate Linux process group and unguessable ownership token; Liatir
stops that group without shutting down the WSL distribution or unrelated Linux
work. Failed and cancelled runs keep their available logs and provenance in
Results.

If Liatir exits while a Windows-to-WSL run is active, the next app start uses
the persisted run identity to stop only the orphaned process tree and reconcile
one interrupted Result with its original Job and parent. It does not present an
abandoned run as still active.

Nextflow resume is available as an explicit expert option for a compatible past
run. Liatir does not claim ownership of Nextflow cache semantics, and it will
not resume against a changed workflow definition or source revision.
