# Single-cell study: explicitly approved PC resources

On 2026-10-05 the user explicitly authorized increasing local execution limits,
using this otherwise idle PC fully with a safety margin. This supersedes the
Mac-only CPU / one-thread / one-cell / 2 GiB continuation restriction in the
[handoff](../state/single-cell-showcase-wsl2-handoff.md). No additional approval is
needed for local GPU execution. Paid compute, GPU CI, publishing and releases
remain outside the request.

Measured hardware: Intel i7-8700K, six available cores, 31.93 GiB Windows RAM;
WSL2 exposes six processors with a 24 GiB RAM ceiling. NVIDIA RTX 4060 Ti has
8,188 MiB VRAM; Windows driver 610.62 exposes CUDA compatibility through WSL2.
The checked catalog publishes signed scGPT `linux-x86_64-cuda12.9`, version
`0.2.5-beta.2`, archive SHA-256
`3da31f6ef9c6ca48e55af52190451e4ca8ce293cd9421fc88e997c8cfceed932`.

Use the normal Liatir installation and Job paths. The initial PC policy permits
six numerical threads, up to 16 GiB process-family RSS, at least 6 GiB WSL
available memory, at least 8 GiB free disk, at most 256 MiB host swap growth,
and at most 6 GiB GPU memory for the computation. Keep this execution's cgroup
swap disabled. WSL's existing 24 GiB ceiling leaves about 8 GiB for Windows;
the GPU ceiling leaves about 2 GiB for display and allocation overhead. Select
a model batch size from a bounded real-data diagnostic before the full run.
Any GPU guard must be exercised before the long calculation.

Keep both complete datasets, seed 23, the exact prepared counts and split,
model weights, tokenization, and evaluation definitions unchanged. All nine
completed Mac representations remain reused, with their actual original
hardware, limits and timings. New PC results carry their own resources and
signed runtime identity. Do not present mixed-host costs as a controlled
same-machine comparison.

CPU partial scGPT saves remain intact. Their strict identity must not be
rewritten to pretend they were produced by the GPU. A GPU attempt uses a new
checkpoint unless measured compatibility supports a documented migration;
old partial attempts and their costs remain historical evidence. Changing the
resources is not permission to bypass scientific identity checks.

The user also confirmed that the purpose is a showcase executed through Liatir.
The current Linux native app was driven in an Xvfb virtual display, which is
why no window appeared on Windows. The user subsequently explicitly accepted
keeping the virtual window; visibility is not required. Continue through the
native app with normal Jobs, Results and export, and keep the Windows-owned
execution alive independently of chat.
