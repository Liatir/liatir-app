# AI Runtime Box Production Report

## Completed

- Production distribution is live in the Cloudflare `Personal` account for `liatir.com`.
- `models.liatir.com` serves the authenticated Runtime Box control plane.
- `assets.models.liatir.com` serves immutable artifacts from the `liatir-storage` R2 bucket under `ai-runtime-boxes/`.
- Geneformer V1 10M `1.0.0-beta.1` is production-signed, published, promoted to the beta channel, and enabled in the catalog as a `runtime-box` model.
- Remote signature, immutable artifact, byte-range download, Worker authentication, focused TypeScript/Svelte/Rust checks, and post-extraction imports were verified.
- A targeted fresh-home native gate now covers interruption/resume, signed install, real Geneformer inference, atomic replacement, rollback, removal, and Jobs metadata.
- Geneformer matches the pinned official V1 tokenizer and embedding algorithm exactly on the deterministic CPU fixture (`maxAbsoluteError: 0.0`).
- scGPT Whole-human `0.2.5-beta.1` is production-signed, published, promoted, and passes real 512-dimensional CPU and native Apple Metal embedding gates.
- Production signing now runs in the dedicated Google Cloud project `liatir-release-security`: private Cloud Run service `liatir-runtime-box-signer` validates a versioned policy and uses the non-exportable Ed25519 KMS key `runtime-box-production`.
- The live R2 Worker trust bundle contains both the legacy public key and `liatir-runtime-box-kms-2026`, preserving existing releases during rotation. A live IAM-to-Cloud-Run-to-KMS smoke signature verified locally against the embedded public key.

## Architecture

The repository CLI builds a complete relocatable box containing standalone Python, hash-locked dependencies, model assets, self-test metadata, and provenance. For production it sends the exact canonical payload to a private IAM-protected Cloud Run signer. The signer rejects unknown models, targets, origins, mutable URLs, dirty provenance, and malformed metadata before asking Cloud KMS to sign. The CLI verifies the returned signature locally, uploads the large archive directly to R2, and promotes only small signed control documents through the authenticated Registry Worker.

Liatir fetches the signed channel, selects a compatible release, verifies the production signature and checksums, resumes the archive download when possible, safely extracts it, runs its self-test, and atomically activates it per `runtimeId`. The previous runtime is retained for rollback. The Worker never proxies large model archives.

## Remaining Beta Gates

- Add a true cross-version native update gate (same-version atomic replacement and rollback are already verified).
- Add client-persisted signed channel generation/expiry state to reject replay of an older otherwise-valid channel document.
- Do not redistribute scFoundation weights under the current non-commercial model license; select a lawful alternative or design an explicit user-supplied checkpoint flow.
