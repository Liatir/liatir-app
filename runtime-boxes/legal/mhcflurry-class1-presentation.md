# MHCflurry Class I presentation Runtime Box

- Component: OpenVax MHCflurry 2.2.1 with the official Class I presentation models dated 2020-06-11.
- Upstream code: <https://github.com/openvax/mhcflurry/tree/v2.2.1>
- Code licence: Apache-2.0 (`mhcflurry-2.2.1.dist-info/LICENSE`).
- MHC allele parser: MHCgnomes 3.33.6, Apache-2.0 (`mhcgnomes-3.33.6.dist-info/licenses/LICENSE`).
- Official model archive: <https://github.com/openvax/mhcflurry/releases/download/pre-2.0/models_class1_presentation.20200611.tar.bz2>
- Official model archive SHA-256: `6193efee43e768c605b1869b1a7da2b8b89a31140f49cf45449fae17b5b7102e`.
- Reviewed source mirror SHA-256: `44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e`.
- MHCflurry wheel SHA-256: `cd934e9b092de76e477442c6f84aab1265def91acfa5ae129308116dbfa66ac7`.
- MHCgnomes wheel SHA-256: `65d76a8e48c43652d4e3cd8ac3dc73f62793e6bf6df1bf0dd849cebf96ddf904`.
- np-utils 0.6.0 source: <https://pypi.org/project/np-utils/0.6.0/>, BSD-3-Clause.
- np-utils source archive SHA-256: `2aa5c7ece3d1cb512d1af718aa05a5909dd47c74e5978b7c389c9b4f1a6ef804`.

The source mirror is a deterministic `tar.gz` repack of the model files because Scrollcase v2
does not expand `tar.bz2`. `scripts/repack-mhcflurry-model-asset.py` verifies the official archive
before repacking and writes its original provenance inside the mirror. No model or code is changed.

This component runs locally and is intended for research candidate prioritization. It is not a
validated vaccine, therapy, or diagnostic result.
