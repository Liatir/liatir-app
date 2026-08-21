# Beta support and troubleshooting

Liatir Beta focuses on one coherent local laboratory path: inspect data, run a
single-cell AI workflow, inspect and reuse its outputs, and run a saved
Nextflow workflow either directly or inside a Liatir pipeline. Optional
[Local MCP](/mcp/overview) can request exact saved pipeline revisions while
Liatir remains in control of authorization, Jobs and Results.

## Current limits

- Public signed desktop packages are not considered ready until the installer
  gate is complete on that platform.
- macOS scientific and local packaging evidence currently covers Apple silicon,
  not Intel Macs.
- Windows Nextflow runs through WSL2 Linux x86_64. Native Windows Nextflow,
  WSL1 and WSL ARM64 are not supported.
- The bundled Native Tools — samtools, bcftools, seqkit, fastp, bwa, minimap2 —
  also run through WSL2 on Windows, for the same reason: they have no Windows
  build. WSL2 must be installed; nothing has to be installed inside it. Their
  Windows behaviour has not yet been verified by the Windows gate, so treat
  Windows Native Tool support as implemented and unproven.
- The bundled environment currently covers macOS Apple silicon and Linux x86_64.
  On Intel Macs and Linux ARM64 these tools still have to be installed on the
  machine.
- Liatir does not yet install Nextflow/Java or configure HPC and cloud
  executors.
- Windows CUDA support is limited to the exact published CUDA 12.8 Geneformer
  and scGPT targets. The hosted Windows GPU runner cannot validate them, so
  support comes from their recorded native product evidence and is not a claim
  about other drivers or CUDA versions.
- AI Model availability is target-specific. The model selector shows only
  compatible installed assets.
- Liatir pipelines orchestrate tools but do not replace Nextflow scheduling,
  cache, resume or DSL semantics.
- Liatir is research software. Outputs require scientific review and are not a
  medical diagnosis.

## Common problems

### macOS says the developer cannot be verified

Do not bypass the warning for a Beta package. Delete that app bundle and obtain
the signed, notarized package from the official release page. Include the
package filename and version in a support report.

### Windows SmartScreen does not recognise the installer

Do not choose **Run anyway** for a Beta package. An official Windows installer is
Authenticode-signed; an unrecognised one is a development build. Delete it and
obtain the signed installer from the official release page, quoting the filename
and version in a support report.

### Update check is unavailable

Development builds do not have a release feed. In an official package, confirm
that the machine can reach the release service over HTTPS and try again. An
offline app remains usable; only the explicit update check needs connectivity.

### Liatir will not update or restart

Open **Jobs**. Finish or cancel every running Job, then retry. Liatir refuses to
replace or restart the app while scientific work is active.

### A file is missing

Liatir stores references to source files. If a file was moved, open **Data**,
select the missing entry and use **Relocate**. Existing run history keeps its
association with the updated reference.

### An AI Model cannot be installed

Check the model's operating-system, architecture, accelerator, memory and disk
requirements. Liatir will not substitute an incompatible Runtime Box. Keep the
error and diagnostics; do not loosen version or signature checks.

### Nextflow is not ready

Verify that both `nextflow` and `java` are installed on the supported execution
host and available on `PATH`. On Windows, install them inside an x86_64 WSL2
distribution rather than as an unofficial native Windows wrapper.

### A run was interrupted

Reopen Liatir and inspect **Jobs** and **Results**. Liatir reconciles interrupted
runs instead of leaving them falsely running. Nextflow `-resume` is an explicit
expert action and is allowed only with a compatible saved definition and source
revision.

### An MCP client cannot connect or start a pipeline

Open **Settings → Local MCP** and confirm the server is on. Copy the current
Server URL and bearer token again: rotating the token invalidates the old one,
and the local port can change when Liatir restarts. Save and explicitly allow
the pipeline's current revision. Then bring Liatir to the foreground to approve
the individual request. If a file input is rejected, allow that registered file
under **Source files from Data** and pass its artifact ID rather than a path. If
Result listing is unavailable, review the separate **Allow Results** permission.
See [Local MCP](/mcp/overview) for the complete safety boundary.

## Report a problem

Include the Liatir version, operating system and architecture, the affected Job
or Result identity, what you expected, and the exported diagnostics. Do not
send private datasets, credentials, signing keys, patient identifiers, or
complete environment-variable dumps.
