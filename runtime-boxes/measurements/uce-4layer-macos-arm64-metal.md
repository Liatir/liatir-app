# UCE 4-layer macOS arm64 packaging measurements

Measured on 2026-07-13 on Apple arm64. Gate 3 packaging measurements came from
clean Git revision `a35fbc48aa315cee2ee47bfeff4875efed24d4bd`.
Gate 5 product-runner measurements came from clean Git revision
`19230b72f952c75e206ddfa6de3816c4f54a8bd1`. Production signing, native
lifecycle, and publication remain separate gates.

## Reproducible artifact

| Measurement | Result |
|---|---:|
| Archive size | 8,862,120,348 bytes (8.25 GiB) |
| Archive SHA-256 | `3bd8c17691fed429a4f34186881a7f682541bfbd2ea534a35f784852f7bf99fb` |
| Signed installed size | 10,142,871,337 bytes (9.45 GiB) |
| Protein embedding files | 8 |
| Extracted protein embedding disk use | 3,037,200,384 bytes (2.83 GiB) |
| Dependency lock SHA-256 | `bad8165f05e80191d7ffef0c862cb1b6882532a43182cba0a3ddf40246420bc8` |

Two clean builds downloaded and verified every pinned source and model asset.
Both produced the exact archive SHA-256 and byte size above, plus an identical
signed development release document with SHA-256
`368ee290d4c3e0e40389ecc2f2eb42e98aa88384f1ba3db656647c4ce7f3e761`.
Both release archives passed signature, checksum, extraction, required-file,
import, checkpoint-shape, and token-shape verification.

## Resource observations

| Measurement | Result |
|---|---:|
| Observed clean-build disk delta at peak | 19,464,245,248 bytes (18.13 GiB) |
| Fresh-install disk plan minimum | 19,273,427,141 bytes (17.95 GiB) |
| CPU self-test maximum RSS | 3,736,911,872 bytes (3.48 GiB) |
| Metal unified-memory use | Not exercised by the packaging self-test |

The fresh-install minimum is the signed archive size plus signed installed size
plus the 256 MiB installer safety margin. Existing active or rollback runtimes
increase the app's preflight requirement and are intentionally not included in
that minimum.

The packaged Torch 2.1.1 library is a Mach-O arm64 binary. The packaged runtime
reported `platform.machine() == "arm64"`, and reported both MPS built and MPS
available on the measurement host. The Gate 3 packaging evidence remains a
self-test measurement and must not be used as an inference-memory estimate.

## Focused product-runner inference

Before inference, a fresh Gate 5 build from the revision above produced archive
SHA-256 `b2a6b66d91ed3d2638a58e2143fb5f6202fed7e007da1ef155ced9303d62fcd7`.
Development signature, archive checksum, required files, installed layout, and
self-test verification passed. The archive hash differs from Gate 3 because the
signed build provenance records the newer source revision.

The Gate 5 validator extracted the exact Python wrapper shipped by the frontend
and created one deterministic human AnnData fixture from gene symbols present
in the packaged UCE assets. It ran exactly once on CPU, validated the complete
output contract, and then ran exactly once on Apple Metal. The wrapper delegated
embedding to the pinned upstream UCE source revision
`8ead6e07af0c80f75653598138bb704e865b45c8` in both runs.

| Measurement | CPU | Apple Metal |
|---|---:|---:|
| Cells / genes | 10 / 32 | 10 / 32 |
| Embedding shape | 10 x 1,280 | 10 x 1,280 |
| Finite values | Yes | Yes |
| Duration | 14,781 ms | 11,540 ms |
| Maximum resident set | 5,653,921,792 bytes | 7,300,235,264 bytes |
| Peak process footprint | 7,173,111,744 bytes | 7,861,283,072 bytes |

The fixture SHA-256 was
`1886e38071688bb1b4647ae98f3c280749155e5f5b430f8d4d90b13726dfc27d`;
the raw input hash remained unchanged. Both runs produced the embedded AnnData,
preview CSV, summary JSON, and the six expected intermediate artifacts with
species, batch, accelerator, and random-seed provenance.

Metal was compared with the CPU execution of the same pinned official
algorithm using absolute and relative tolerances of `0.02` and a minimum cosine
similarity of `0.999`. The maximum observed absolute difference was
`2.5704503059387207e-7`, the mean absolute difference was
`4.138579725587732e-8`, and the minimum cosine similarity was
`0.9999999999969341`. These measurements establish focused output sanity and
backend parity for this tiny fixture; they are not a large-dataset capacity
claim.
