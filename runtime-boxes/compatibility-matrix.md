# AI Runtime Box Compatibility Matrix

| Target | Status | Python | Accelerator | Distribution gate |
|---|---|---:|---|---|
| macOS arm64 | Foundation target | 3.11.9 | Apple Metal / CPU | Geneformer lifecycle/parity and scGPT native inference passed |
| macOS x86_64 | Planned | TBD | CPU | Not published |
| Linux x86_64 | Planned | TBD | CPU / CUDA | CUDA ABI matrix required |
| Windows x86_64 | Planned | TBD | CPU / CUDA | Relocatable runtime validation required |

The first release target is `macos-aarch64-metal`. Target selection is exact;
the app must never silently install a box built for another OS, architecture,
accelerator, CUDA ABI, or incompatible Liatir version.

## Trust and update rules

- Every release and channel document is signed offline with Ed25519.
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
