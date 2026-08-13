# External Workflows

External Workflows let you run a saved workflow engine project from Liatir and
reuse the same definition as one step in a larger Liatir pipeline. Nextflow is
the first supported engine.

Liatir does not replace Nextflow or edit its DSL. Nextflow still owns its
process scheduling, executors, cache and internal parallelism. Liatir provides
the common inputs, Jobs, Results, provenance and output handoff around it.

## Requirements

Install [Nextflow](https://docs.seqera.io/nextflow/install) and a compatible
Java runtime on a supported execution host. Nextflow runs on POSIX systems and
uses WSL on Windows. Both `nextflow` and `java` must be available on `PATH`;
Liatir checks them before a run.

This first Liatir adapter is currently verified on macOS arm64. Linux and the
native Windows-to-WSL path will be listed as supported only after their native
product gates pass.

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

The Result includes the declared files plus the Nextflow and Java versions,
command, source revision, parameters, profile, configuration digest, task
states, logs, trace, report, timeline and exit status. Declared files can be
added to **Data** and reused without searching the Nextflow work directory.

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

Cancelling a run stops only that External Workflow Job. Failed and cancelled
runs keep their available logs and provenance in Results.

Nextflow resume is available as an explicit expert option for a compatible past
run. Liatir does not claim ownership of Nextflow cache semantics, and it will
not resume against a changed workflow definition or source revision.
