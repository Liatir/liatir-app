# PhysiCell Tool Runtime

- Runtime identity: `physicell-multicellular-simulation` / `physicell-1-14-2`.
- Reviewed source revision: `physicell-1.14.2+2dd954ad781f` (the release source, and the executable built
  from it).
- PhysiCell 1.14.2: <https://github.com/MathCancer/PhysiCell/releases/tag/1.14.2>, BSD-3-Clause, the
  release archive `PhysiCell_V.1.14.2.zip` (12,384,340 bytes, SHA-256
  `15b190ac3420683b1f8e9d61dd9573b7afe0f6bc4c0011b0b0756693ccd0b9f4`). It contains BioFVM (BSD-3-Clause)
  and pugixml (MIT); their licence texts and PhysiCell's citation ship under `physicell/licenses/`.
- The executable `physicell/bin/physicell-1.14.2-template-linux-x86_64` is PhysiCell's template project,
  compiled from that archive by `runtime-boxes/native-builds/physicell/build.sh` with conda-forge's GCC
  15.3.0 against a glibc 2.17 sysroot: 2,544,576 bytes, SHA-256
  `2dd954ad781fe9088a483a070b120701ce70b57a2ef253276617142fe34952f1`, rebuilt byte for byte from the
  locked toolchain. The GCC runtime libraries (libstdc++, libgcc, libgomp) are linked into it under the
  GCC Runtime Library Exception, which lets the result be distributed on any terms. What is compiled
  inside it is declared in `runtime-boxes/legal/audits/physicell-linux-x86_64-cpu-bundled-declaration.json`.
- The template's settings ship unmodified as `physicell/config/PhysiCell_settings.xml`.

The conda packages (Python, NumPy, SciPy and their dependencies) ship unmodified with their licence
files, on the basis recorded in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md);
the complete transitive inventory is `runtime-boxes/legal/audits/physicell-linux-x86_64-cpu.json`.

Pruned from the payload: `venv/lib/python3.1` (conda's link to `python3.11`, which the build would
otherwise copy in full).

The executable needs glibc 2.17 or newer and nothing else from the host.

## Scientific limits

An agent-based simulation follows the model's cell definitions, rules and parameters, not the tissue
they stand for. Cell behaviour is stochastic, so one seed gives one sample; with more than one thread
the same seed does not repeat a run exactly.
