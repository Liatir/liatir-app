# R and Native Plugins use the existing subprocess lifecycle

Decided 2026-10-26. Implementation record: [runtime plan](../state/r-and-native-plugin-runtime-support.md).

R and Native are first-class `.lia` manifest runtimes. Their schemas come from
code declarations and use the existing field, result, file and pipeline contracts.
Both adapters return a Job acknowledgement; existing buffered settlement, cancellation
and result finalization handle them without runtime-specific pipeline branches.

Native runs a separate executable, selected by an exact OS/architecture target.
The reference SDK reuses the WASM Rust contract and validation code, conditionally
adding the native HTTP bridge; WASM receives no host bridge. Other languages may
implement the documented protocol. Dynamic-library loading was rejected because it
would put plugin ABI, crashes and lifetime inside the app process.

R executes through `Rscript --vanilla`. renv locks record CRAN/Bioconductor packages;
prepared libraries are isolated by Plugin name/version, lock and interpreter identity and protected by a
per-environment preparation lock. Code-only rebuilds reuse them. R interpreter
provisioning cannot reuse the Python-specific provisioning code or unrelated AI
Runtime Boxes: discover local R now and report a concrete installation action.
A signed optional R interpreter distribution remains separate future work.

Both SDKs use the existing bearer-authenticated loopback IPC and propagate the same
dev context. Native trust is a deliberate desktop action bound to the SHA-256 of
the complete validated archive. Signed bundles still require permission; changing
bytes revokes their receipt. Plugin IPC cannot grant trust or prepare global R
libraries. Dev libraries live inside the session sandbox for teardown. Session job
checks now require the session ID as well as the sandbox workspace ID.

Each run has a private extracted payload and JSON input file; the existing Jobs
cleanup removes these on termination. File results must use inline content or the
bridge's managed storage outside that temporary directory. Extraction rejects
unsafe paths, duplicate names and symlinks; unknown runtime values fail explicitly.
Node's missing-runtime compatibility and WASM isolation remain intact.

Pipeline form values are normalized once through the shared core contract before
calling any Plugin SDK. Numbers and booleans arrive as JSON numbers and booleans,
including zero and false; file paths remain strings. All declared field metadata,
including boolean output types, semantic artifacts and connection controls, is
preserved by the common Plugin-to-pipeline adapter.
