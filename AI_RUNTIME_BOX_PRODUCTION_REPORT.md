# AI Runtime Box Production Report

## Completed

- Production distribution is live in the Cloudflare `Personal` account for `liatir.com`.
- `models.liatir.com` serves the authenticated Runtime Box control plane.
- `assets.models.liatir.com` serves immutable artifacts from the `liatir-storage` R2 bucket under `ai-runtime-boxes/`.
- Geneformer V1 10M `1.0.0-beta.1` is production-signed, published, promoted to the beta channel, and enabled in the catalog as a `runtime-box` model.
- Remote signature, immutable artifact, byte-range download, Worker authentication, focused TypeScript/Svelte/Rust checks, and post-extraction imports were verified.
- A targeted fresh-home native gate now covers interruption/resume, signed install, real Geneformer inference, atomic replacement, rollback, removal, and Jobs metadata.
- Geneformer matches the pinned official V1 tokenizer and embedding algorithm exactly on the deterministic CPU fixture (`maxAbsoluteError: 0.0`).
- scGPT Whole-human now has a hash-locked macOS arm64 recipe and passes a real 512-dimensional CPU embedding gate; production publication is the next cutover step.

## Architecture

The repository CLI builds a complete relocatable box containing standalone Python, hash-locked dependencies, model assets, self-test metadata, and provenance. It signs immutable release and channel documents with an offline Ed25519 key, uploads the large archive directly to R2, and promotes only small signed control documents through the authenticated Registry Worker.

Liatir fetches the signed channel, selects a compatible release, verifies the production signature and checksums, resumes the archive download when possible, safely extracts it, runs its self-test, and atomically activates it per `runtimeId`. The previous runtime is retained for rollback. The Worker never proxies large model archives.

## Remaining Beta Gates

- Back up the signing key to a genuinely separate encrypted offline medium; no such mounted destination was available during this work.
- Add a true cross-version native update gate (same-version atomic replacement and rollback are already verified).
- Publish and natively validate scGPT.
- Do not redistribute scFoundation weights under the current non-commercial model license; select a lawful alternative or design an explicit user-supplied checkpoint flow.
