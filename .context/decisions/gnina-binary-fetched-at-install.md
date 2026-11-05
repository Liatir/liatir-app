# GNINA's official binary is fetched at install, never redistributed

Decided 2026-11-04 by the owner. Resolves B1 in the
[Scientific Simulation Suite plan](../state/roadmap/scientific-simulation-suite.md).

## Context

GNINA rescores docked poses with convolutional neural networks. Its 1.3.3 release
(<https://github.com/gnina/gnina/releases/tag/v1.3.3>, 2026-06-29) ships one asset,
`gnina.cuda12.8.static`: 2,056,131,000 bytes, SHA-256
`3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172` (the digest GitHub records for
the asset). GNINA is dual licensed, GPL and Apache; the GPL applies because it links OpenBabel
(GPL-2.0-only), and the static binary also carries NVIDIA's CUDA libraries under NVIDIA's own terms.
Whether that combination can be redistributed at all is not settled, and a Runtime Box that carried
the binary would make Liatir its distributor.

## Decision

The GNINA box declares the official binary as an on-demand asset (Scrollcase `embed: false`): its
GitHub release URL, its size and its SHA-256 sit in the signed release, and the box never contains
the binary. When a user installs the tool, Liatir's installer downloads it from GNINA's own release,
verifies size and hash, and only then activates the box. Liatir redistributes no GNINA code; the
user obtains GNINA from its authors.

## Consequences

- Liatir's installer gains on-demand assets. Scrollcase records them and verifies them before a box
  runs, but by design never downloads them: the application does.
- Installing the tool needs GitHub to serve that exact asset. If it is removed or changed, the
  install fails visibly on the pinned hash; there is no fallback copy.
- The download is about 2 GB, in line with Liatir's other GPU boxes; the owner judged it acceptable.

## Rejected

- **Redistributing the binary in a signed box with its complete source.** Simplest for the user,
  but it would make Liatir the distributor of a GPL-2.0 work statically linked with NVIDIA's
  libraries, whose redistribution is unsettled.
- **A binary the user supplies, checked by digest.** Legally the safest, but it asks a non-technical
  user to find, download and select a 2 GB file.

## Corrected 2026-11-05

The context above says the static binary carries NVIDIA's CUDA libraries. Inspection showed
otherwise: despite its name, `gnina.cuda12.8.static` links cuDNN 9, the CUDA runtime, cuBLAS, cuFFT,
cuSPARSE and cuSOLVER dynamically (`readelf -d`), and needs glibc 2.35. The box supplies those
libraries as unmodified conda-forge packages, as every Liatir CUDA box does, so the box is a 2.3 GB
download beside GNINA's 2.1 GB, not nothing beside it. GNINA itself is still fetched from its
release, unchanged. Its RPATH puts `/usr/local/lib`, `/usr/local/cuda/lib64` and the working
directory ahead of the box's libraries, so the runner preloads every one by absolute path and starts
GNINA from an empty directory. The driver it needs is decided in
[GNINA's CUDA 12.8 box needs NVIDIA driver 570.26](gnina-cuda-driver-floor.md).
