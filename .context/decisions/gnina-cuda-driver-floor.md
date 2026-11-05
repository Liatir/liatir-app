# GNINA's CUDA 12.8 box needs NVIDIA driver 570.26

Taken 2026-11-05, while building the `gnina` box, on the principle of
[OpenMM CUDA needs the CUDA 12.9 driver](openmm-cuda-needs-the-cuda-12-9-driver.md): a driver floor
comes from what the program and its libraries require, read and measured, not from CUDA's
minor-version table alone.

## Context

GNINA 1.3.3's release binary was built with CUDA 12.8 and links cuDNN 9 and the CUDA 12 libraries
dynamically; the box supplies them as conda-forge's CUDA 12.8 packages and cuDNN 9.10.2. Two floors
were on the table: 525.60.13, the floor NVIDIA gives for CUDA 12 *minor version compatibility*, and
570.26, the CUDA 12.8 toolkit's own driver.

What the program makes the driver do, read on 2026-11-04 and 2026-11-05 on the RTX 4060 Ti host
(compute capability 8.9, Windows driver 610.88 through WSL2):

1. **The binary's GPU code.** `cuobjdump` (CUDA 12.8.90) lists compiled code (SASS) for sm_60, sm_61,
   sm_70, sm_75, sm_80, sm_86, sm_89, sm_90, sm_90a, sm_100, sm_100a and sm_120 — 379 to 383 kernels
   for each family from sm_60 on — and PTX only for sm_120, three kernels. sm_50 has five.
2. **What it loads.** Under `LD_DEBUG=libs`, neither scoring nor energy minimization ever loads
   `libnvrtc`, although libtorch inside GNINA can call it.
3. **Measured.** The product runner's rescoring of 38 poses gives the same scores with the driver's PTX
   compiler disabled (`CUDA_DISABLE_PTX_JIT=1`); the scientific validator holds this. So, unlike
   OpenMM, nothing here asks for a driver newer than the libraries' own floor.

What the libraries require, from NVIDIA's documentation:

4. The CUDA 12.8 release notes give 570.26 (Linux) and 570.65 (Windows) as the CUDA 12.8 GA toolkit
   driver, and 525.60.13 / 528.33 for CUDA 12.x minor version compatibility.
5. The **cuDNN 9.10 support matrix** lists, for CUDA 12.8 and 12.9, a minimum driver of **570.26**
   (Linux) and **570.65** (Windows); the 525.60.13 floor appears only for CUDA 12.0–12.6. It also lists
   compute capability 5.0 to 12.0.

## Decision

The `gnina` box (`linux-x86_64-cuda12.8`) requires NVIDIA driver **570.26 or newer**, in the signed
scroll and in the product metadata, which the installer requires to be identical.

One value serves both host environments, as for OpenMM: Windows drivers of the R570 branch are
numbered 572 and later, so under WSL2 the same comparison admits exactly the Windows drivers at or
above cuDNN's 570.65.

The runner also refuses, by name, a GPU of compute capability below 6.0: cuDNN would run there, but
GNINA's own binary carries almost no code for Maxwell (reading 1), so the run would fail inside GNINA.

## Alternatives considered

- **525.60.13.** Readings 1–3 suggest nothing in a run needs more, but cuDNN 9.10 with CUDA 12.8 is
  documented only from 570.26, and this host cannot run an older driver to measure it. A floor below
  what the vendor supports, unmeasured, would be a claim without evidence.
- **Re-locking with CUDA 12.6 libraries**, whose cuDNN row allows 525.60.13. Rejected: the binary was
  built with CUDA 12.8, and running it on older runtime libraries than it was built with is not a
  supported configuration.
- **Forcing `CUDA_DISABLE_PTX_JIT=1` on every run.** It would turn reading 3 into an enforced rule, but
  on a GPU this host cannot test, a library kernel shipped only as PTX would then fail even with a
  driver new enough to compile it.

## Consequences

- Users with drivers older than 570.26 (Windows: 570.65) are told so before anything is downloaded.
- The PTX-free measurement covers compute capability 8.9; for the others it rests on reading 1. A GPU
  newer than sm_120 would need the PTX path; GNINA would then fail visibly, and the runner reports
  GNINA's failure, never a CPU fallback.

## Sources

- [CUDA 12.8 release notes, driver tables](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/index.html)
- [cuDNN 9.10 support matrix](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.0/reference/support-matrix.html)

## Related

- [GNINA's official binary is fetched at install](gnina-binary-fetched-at-install.md)
- [Scientific Simulation Suite plan](../state/roadmap/scientific-simulation-suite.md)
