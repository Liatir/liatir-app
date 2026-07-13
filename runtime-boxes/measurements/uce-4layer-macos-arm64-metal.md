# UCE 4-layer macOS arm64 packaging measurements

Measured on 2026-07-13 from clean Git revision
`a35fbc48aa315cee2ee47bfeff4875efed24d4bd` on Apple arm64. These measurements
cover Runtime Box packaging and installed self-test only. They do not cover UCE
inference, scientific parity, native lifecycle, production signing, or
publication.

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
available on the measurement host. No Metal workload was run in this gate, so
the packaging evidence must not be used as an inference-memory estimate.
