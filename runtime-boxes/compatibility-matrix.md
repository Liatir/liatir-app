# AI Runtime Box Compatibility Matrix

| Target | Status | Python | Accelerator | Distribution gate |
|---|---|---:|---|---|
| macOS arm64 | Foundation target | 3.11.9 | Apple Metal / CPU | Geneformer lifecycle/parity, scGPT native inference, and UCE lifecycle/CPU/Metal parity passed |
| Linux x86_64 | Planned | TBD | CPU / CUDA | CUDA ABI matrix required |
| Windows x86_64 | Planned | TBD | CPU / native CUDA | Relocatable runtime validation required |
| Windows x86_64 / WSL2 | Planned, unverified | Reuses a compatible Linux x86_64 payload | CUDA through WSL2 | Manual validation on a physical Windows NVIDIA host required before support is claimed |

The first release target is `macos-aarch64-metal`. Target selection is exact;
the app must never silently install a box built for another OS, architecture,
accelerator, CUDA ABI, or incompatible Liatir version.

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
