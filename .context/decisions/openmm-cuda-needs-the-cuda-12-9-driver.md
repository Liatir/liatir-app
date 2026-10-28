# OpenMM CUDA needs the CUDA 12.9 driver

Taken 2026-10-27, before OpenMM's first publication, while checking what the
`linux-x86_64-cuda12.9` box really requires of a user's NVIDIA driver.

## Context

The OpenMM CUDA scroll and the product metadata declared a minimum NVIDIA driver of `525.60.13`:
the floor NVIDIA publishes for *CUDA 12.x minor version compatibility*. That floor holds for
programs that ship compiled GPU code. It does not hold for programs that hand PTX to the driver to
compile at run time, because a driver can only compile PTX of an ISA version it knows.

OpenMM is such a program. Three independent readings:

1. **Source.** OpenMM 8.5.1's `platforms/cuda/src/CudaContext.cpp` compiles every kernel with NVRTC
   using `-arch=compute_<n>`, takes the result with `nvrtcGetPTX`, and loads it with
   `cuModuleLoad`/`cuModuleLoadDataEx` — the driver's PTX JIT. It has no handling for a driver that
   is too old; the failure surfaces as "Error loading CUDA module".
2. **The shipped binary.** The box's `lib/plugins/libOpenMMCUDA.so` imports `nvrtcGetPTX`,
   `nvrtcCompileProgram` and `cuModuleLoadDataEx`, and links `libnvrtc.so.12`, which the box
   provides as `cuda-nvrtc 12.9.86`.
3. **Measured.** Compiling a kernel with the box's own NVRTC exactly as OpenMM does
   (`-arch=compute_89`) produced a PTX header `.version 8.8` and
   `// Cuda compilation tools, release 12.9, V12.9.86`, on 2026-10-27, on the RTX 4060 Ti host.

NVIDIA's `cuda-python` maps PTX ISA 8.8 to a minimal CUDA 12.9 driver "needed to load a PTX of the
given ISA version", from the official PTX ISA release table. The CUDA 12.9 release notes give the
driver for CUDA 12.9 as Linux `>=575.51.03` and Windows `>=576.02`. NVRTC 12.9.86 is the
CUDA 12.9 Update 1 component; an update release does not change the PTX ISA version.

## Decision

The OpenMM CUDA 12.9 box requires NVIDIA driver **575.51.03 or newer**, in the signed scroll and
in the product metadata, which the installer requires to be identical.

One value serves both host environments. Under WSL2 the app compares the Windows driver version
against it. Windows drivers numbered 575.51.03 or higher belong to the R575 branch or later, whose
first Windows release is 576.02; the R570 branch's Windows drivers are numbered 572–573. So the
single floor admits exactly the CUDA 12.9-capable drivers on Linux and on Windows.

## Alternatives considered

- **Keep 525.60.13.** Rejected: a user on driver 535 or 550, the defaults of current Ubuntu LTS
  releases, would pass every check, download about 1.3 GB, and then see every run fail with
  `CUDA_ERROR_UNSUPPORTED_PTX_VERSION`. A check that admits a machine that cannot run the box is
  worse than no check.
- **Re-lock the box with an older `cuda-version` (for example 12.0).** NVRTC would then emit PTX an
  R525 driver can load, admitting older drivers. It is a new dependency solve, licence audit, build
  and full scientific revalidation for a box already validated, so it is not done before this
  publication. It remains the way to widen support later, as a separate decision.
- **Two floors, one per host environment.** The target model carries one driver minimum, and the
  reasoning above shows one value is exact for both, so no contract change is warranted.

## Consequences

- The scroll change alters the signed release, which the production build makes anyway.
- Users with older drivers see, before any download, that the driver must be updated to 575.51.03
  (Windows: 576.02) or newer — the existing compatibility message names the minimum.
- This finding is about OpenMM's run-time PTX compilation. Other CUDA components ship compiled torch
  kernels and are not changed by this decision; whether any of them also depends on PTX JIT was not
  investigated here.

## Sources

- [OpenMM 8.5.1 `CudaContext.cpp`](https://github.com/openmm/openmm/blob/8.5.1/platforms/cuda/src/CudaContext.cpp)
- [CUDA 12.9 Update 1 release notes, driver table](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-toolkit-release-notes/index.html)
- [cuda-python PTX ISA to driver mapping](https://nvidia.github.io/cuda-python/coverage/z_94f9e761dee70a67__ptx_utils_py.html)
- [The same failure with NVRTC 12.5 on a CUDA 12.4 driver](https://gitlab.archlinux.org/archlinux/packaging/packages/cuda/-/issues/7)

## Related

- [OpenMM CUDA publication](../history/openmm-cuda-publication.md)
