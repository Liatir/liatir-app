# pVACtools pVACseq Tool Runtime

- Reviewed combined source revision: `v7.1.2+mhcflurry-v2.0.6`.
- Component: pVACtools 7.1.2 pVACseq with MHCflurry 2.0.6 and MHCflurryEL only.
- pVACtools source: <https://github.com/griffithlab/pVACtools/tree/v7.1.2>
- pVACtools licence: BSD-3-Clause-Clear (`pvactools-7.1.2.dist-info/LICENSE`).
- pVACtools wheel SHA-256: `625049fea40020660c365c02d14f6f72c0be6a47aba1a7d4f079fda912853dba`.
- MHCflurry source: <https://github.com/openvax/mhcflurry/tree/v2.0.6>
- MHCflurry licence: Apache-2.0 (`mhcflurry-2.0.6.dist-info/LICENSE`).
- MHCflurry wheel SHA-256: `9aae769f4093a93076dfa9662bd563f1245d15c0ad159da41af91bc6c405bdef`.
- MHCgnomes 3.33.6 licence: Apache-2.0.
- MHCgnomes wheel SHA-256: `65d76a8e48c43652d4e3cd8ac3dc73f62793e6bf6df1bf0dd849cebf96ddf904`.
- vcfpy 0.13.8 source: <https://pypi.org/project/vcfpy/0.13.8/>, MIT.
- vcfpy source archive SHA-256: `e7d00965105e7ca9567299f073ad60c6bbfc78d685d25ba33353988af9b33160`.
- np-utils 0.6.0 source: <https://pypi.org/project/np-utils/0.6.0/>, BSD-3-Clause.
- np-utils source archive SHA-256: `2aa5c7ece3d1cb512d1af718aa05a5909dd47c74e5978b7c389c9b4f1a6ef804`.
- Vaxrank 1.4.0 source: <https://pypi.org/project/vaxrank/1.4.0/>, Apache-2.0.
- Vaxrank source archive SHA-256: `0a287076eae0542a26fd0131848b230c803714de3ff5ba14d9add0e8d7c99be7`.
- Official Class I presentation model source and reviewed mirror: see
  `runtime-boxes/legal/mhcflurry-class1-presentation.md`.

The product adapter rejects every predictor except the exact local `MHCflurry` and `MHCflurryEL`
pair, disables network connections in the parent and predictor child process, and passes the bundled
model directory explicitly. IEDB, MHCnuggets, remote APIs, and runtime downloads are not part of the
approved surface.

The upstream pVACseq example VCF and its tabix index remain in the box as official reduced validation
data. Other pVACtools product commands are pruned from the payload.

Only Vaxrank's dependency-free `manufacturability` module is used by pVACseq. Supplying the reviewed
1.4.0 source directly avoids installing Vaxrank's unrelated genome and MHC predictor stack.

The environment uses Biopython 1.83 instead of the wheel metadata's legacy 1.77 pin because 1.77 has
no conda build for macOS arm64 or Python 3.11. The pVACseq validation gate covers this bounded
compatibility substitution before any target can be published.

This component runs locally and is intended for research candidate prioritization. It is not a
validated vaccine, therapy, or diagnostic result.
