# Geneformer V1 10M redistribution record

Verification date: 2026-07-18

## Decision

The pinned Geneformer V1 10M source and model assets are eligible for the
reviewed Linux and Windows Runtime Box targets under Apache License 2.0. The upstream
model card at the reviewed revision declares `apache-2.0`; that revision does
not contain a standalone `LICENSE` or `NOTICE` file. Each Runtime Box therefore
includes the complete Apache 2.0 license and a source-attribution notice next
to the unmodified model assets.

The reviewed upstream revision is
`04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`, and the model assets in the
recipe are content-addressed. Any source revision, asset, Python runtime, or
dependency-lock change requires a new audit.

The exact Linux CPU dependency lock is separately reviewed in
`runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cpu.json`. All 34
installed distributions declare redistributable open-source terms, their
wheel-provided license and notice files remain in the installed `.dist-info`
directories, and the audited PyTorch distribution is exactly
`torch==2.4.1+cpu`. The build rejects a package, version, license declaration,
or license-file layout that differs from this reviewed audit.

Two wheels do not expose a license file inside `.dist-info`. The shared Apache
2.0 text plus the named dependency inventory covers `safetensors==0.4.5` and
`tokenizers==0.19.1`.
The Windows CPU recipe also includes and self-tests the exact
`array-api-compat==1.15.0` MIT text. The already-published Linux CPU artifact
predates that supplemental inclusion; it must be replaced in a separately
authorized corrective release rather than being described as if its immutable
payload had changed.

This is an engineering compliance record, not legal advice.

## Pinned source and artifact identity

- Repository: `https://huggingface.co/ctheodoris/Geneformer`
- Exact source commit: `04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`
- Source tag: none; the commit is the release identity
- Checkpoint: `Geneformer-V1-10M/model.safetensors`, 41,183,536 bytes,
  SHA-256 `a5e33a757431643b3697de7ef6127950cdc49e06e58d4266b3a3ab191b683f14`
- Configuration: `Geneformer-V1-10M/config.json`, 565 bytes, SHA-256
  `9cf69ca3bdb0215c4188b54c451b6f02adfe68b8f66011a57d0f32845133fd4b`
- Token dictionary: SHA-256
  `ab9dc40973fa5224d77b793e2fd114cacf3d08423ed9c4c49caf0ba9c7f218f1`
- Median dictionary: SHA-256
  `b3b589bb5ec75040d05fc44dd6bf0184cf87f3c362cf158d196a6ed3b7fe5f39`
- Ensembl mapping: SHA-256
  `eac0fb0b3007267871b6305ac0003ceba19d4f28d85686cb9067ecf142787869`
- Pinned upstream tokenizer used for parity: SHA-256
  `689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002`

## Linux CPU dependency and layout review

- Recipe: `geneformer-v1-10m-linux-x86_64-cpu`
- Python: `3.11.9`
- Resolver: `uv 0.11.28`
- Wheel target: `x86_64-unknown-linux-gnu`
- PyTorch backend: `cpu`
- Dependency lock SHA-256:
  `73a31b39b7f2f3eee6a1c7628d13728490ed4db31095c50ab5ce0211b98829f1`
- Dependency payload measured before standalone Python and model assets:
  approximately 1.1 GiB extracted
- Build disk gate: 6 GiB; actual peak and installed/archive sizes must be
  recorded by the native Linux run
- Declared minimum RAM: 8 GiB. Upstream does not publish a numeric CPU RAM
  minimum, so actual peak RAM remains a required native-run measurement.

## Windows CPU dependency and layout review

- Recipe: `geneformer-v1-10m-windows-x86_64-cpu`
- Python: `3.11.9`
- Resolver: `uv 0.11.28`
- Wheel target: `x86_64-pc-windows-msvc`
- PyTorch backend: `cpu`
- Dependency lock SHA-256:
  `b0e070dbcbf7c236db06afd086bd39dec99721221f0019ce12f9cb1affd28e7c`
- Exact PyTorch distribution: `torch==2.4.1+cpu`
- Locked wheel count: 35
- Selected wheel bytes: 306,063,118 compressed and 1,484,068,521 expanded
- Supplemental exact MIT notice:
  `array-api-compat-1.15.0-MIT.txt` SHA-256
  `4ffd978e3fa18d058d98c66771cfea7ed634aaf7023cf9612b8b55eee9a8f0fe`
- Conservative build disk gate: 6 GiB, including a 2 GiB installed-payload
  estimate, 1 GiB archive estimate, and 2 GiB safety/cache margin
- Declared minimum RAM: 8 GiB. Actual peak RAM remains a required native-run
  measurement.

This audit inspected only hash-verified Windows wheel metadata and license
files on the local non-Windows host; it did not execute foreign binaries. The
native Windows build must still install the lock into standalone Python,
reproduce the audit, pass DLL/import and scientific self-tests, and record
actual installed/archive size, peak disk, and peak RAM.

The payload layout is fixed as follows:

- standalone Python and distributions under `venv/`;
- checkpoint and configuration under
  `model-cache/geneformer-v1-10m/model/`;
- pinned dictionaries under
  `model-cache/geneformer-v1-10m/dictionaries/`;
- upstream license and source notice under `licenses/` and
  `THIRD_PARTY_NOTICES/`;
- exact supplemental MIT notices for wheel metadata that omits bundled license
  files under `THIRD_PARTY_NOTICES/`;
- deterministic dependency-license evidence at
  `THIRD_PARTY_NOTICES/python-distributions.json`.

## Sources

- [Pinned Geneformer repository and assets](https://huggingface.co/ctheodoris/Geneformer/tree/04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [Apache redistribution FAQ](https://www.apache.org/foundation/license-faq.html)
- [PyTorch 2.4.1 CPU wheels](https://docs.pytorch.org/get-started/previous-versions/)
- [uv managed Python platforms](https://docs.astral.sh/uv/concepts/python-versions/)
- [uv PyTorch backend selection](https://docs.astral.sh/uv/guides/integration/pytorch/)
- [array-api-compat 1.15 license](https://github.com/data-apis/array-api-compat/blob/1.15/LICENSE)
