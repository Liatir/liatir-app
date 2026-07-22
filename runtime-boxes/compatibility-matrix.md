# AI Runtime Box Compatibility Matrix

| Target | Status | Python | Accelerator | Distribution gate |
|---|---|---:|---|---|
| macOS arm64 | Supported | 3.11.9 | Apple Metal / CPU | Published Geneformer Metal lifecycle/parity and current-builder regression run `29880520628`; scGPT native inference; UCE lifecycle and CPU/Metal parity |
| Linux x86_64 | Supported for Geneformer | 3.11.9 | CPU / CUDA 12.4 | Published native CPU lifecycle in run `29547725429`; current-code T4 CUDA lifecycle in run `29750614689` |
| Windows x86_64 CPU | Supported for Geneformer | 3.11.9 | CPU | Published native lifecycle in run `29706828552`, including real inference, Jobs, Results, provenance, rollback, removal, and beta promotion |
| Windows x86_64 CUDA 12.4 | Unsupported, deferred | 3.11.9 recipe | Native CUDA 12.4 | Recipe and CI wiring are buildable, but no box is validated or published; the GitHub Windows T4 driver `471.11` is below the required `551.61` |
| Windows x86_64 / WSL2 | Unsupported, unverified | Reuses a compatible Linux x86_64 payload | CUDA through WSL2 | Physical-host launch, path translation, GPU passthrough, installation, and scientific validation have not passed |

Target selection is exact; the app must never silently install a box built for
another OS, architecture, accelerator, CUDA ABI, or incompatible Liatir
version. Linux CUDA evidence does not establish Windows CUDA support.

Future Linux Runtime Box release manifests may declare
`compatibility.hostEnvironments: ["native", "windows-wsl2"]`. This records that
the same Linux payload is intended for both environments without creating a
second model archive. It does not by itself establish Windows support: the
Tauri-to-WSL2 launch, path translation, GPU passthrough, installation, and
scientific fixture must pass on a physical Windows NVIDIA host before the
`windows-wsl2` environment is published as supported.

## Model packaging evidence

| Runtime Box | Target | Packaging status | Runtime evidence |
|---|---|---|---|
| Geneformer v1 10M | macOS arm64 / Metal | Published | Native lifecycle and scientific parity passed |
| Geneformer v1 10M | Linux x86_64 / CPU | Published (`1.0.0-beta.1`) | Full protected release and native product lifecycle passed in run `29547725429` |
| Geneformer v1 10M | Linux x86_64 / CUDA 12.4 | Published (`1.0.0-beta.1`) | T4 scientific validation and native product lifecycle passed on current code in run `29750614689` |
| Geneformer v1 10M | Windows x86_64 / CPU | Published (`1.0.0-beta.1`) | Full protected release and native product lifecycle passed in run `29706828552` |
| Geneformer v1 10M | Windows x86_64 / CUDA 12.4 | Not published; unsupported | GPU-free recipe checks passed, but native validation is blocked by the hosted runner driver and must not be inferred from Linux CUDA |
| scGPT Whole-human | macOS arm64 / Metal | Published | Native lifecycle and direct-run inference passed |
| UCE 4-layer | macOS arm64 / Metal | Published (`1.0.0-beta.1`) | One Runtime Box installer and the shared single-cell runner; reproducible packaging, complete 10-cell CPU/Metal outputs, backend parity, and targeted native lifecycle passed |

UCE Gate 3 measured an 8,862,120,348-byte archive and a
10,142,871,337-byte installed payload. Gate 5 then ran the exact product wrapper
once on CPU and once on Metal, producing finite 10 x 1,280 embeddings with a
maximum absolute backend difference of `2.5704503059387207e-7`. Native lifecycle
and production publication then passed as separate gates: the KMS-signed beta
release is live, and a fresh-home native run verified signed installation, a
tracked `ai-python` direct Job, finite 10 x 1,280 Result output and provenance,
Jobs/Results visibility, removal, and Result artifact survival.

## Trust and update rules

- Every release and channel document is signed with Ed25519. Production signing
  uses the private Cloud Run signer and non-exportable Cloud KMS key.
- Archive URL, archive size, SHA-256, compatibility, provenance, and (for new
  releases) exact extracted size are inside the signed release payload.
- Production builds trust only public keys embedded at build time.
- Debug builds may additionally trust the local development public key.
- Channel documents support deterministic percentage rollout metadata.
- Revoked versions must not be newly installed or activated.
- Installation extracts into a sibling staging directory, validates it, then
  atomically swaps it into the active runtime path. A previous runtime remains
  available for rollback.
- New manifests fail before download when the archive and signed extracted
  payload cannot fit beside the active runtime and retained rollback. Legacy
  manifests without extracted-size metadata remain compatible.
