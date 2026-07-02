# Chai-1 Local Structure

Chai-1 is a local molecular structure prediction runtime. In Liatir it is
available as a managed AI Model for Linux CUDA machines.

## What it does

Chai-1 predicts molecular structures from biological sequence and molecular
inputs. It is part of the protein structure prediction family in Liatir.

## When to use it

Use Chai-1 when you have access to a compatible Linux workstation or server with
CUDA and enough GPU memory. It is not intended for normal macOS CPU or Apple
Metal testing.

## Inputs in Liatir

- Protein FASTA/FAA file, or an inline protein sequence.
- Optional ligand-related inputs when supported by the tool.
- Prediction options exposed by the Liatir protein structure runner.

## Outputs

Liatir can produce:

- structure files when prediction succeeds;
- logs and runtime metadata;
- viewer-compatible artifacts;
- provenance with model, runtime, input, parameters, and output files.

## Hardware and installation

The local Chai-1 runtime is restricted to Linux CUDA hosts in Liatir. It requires
Python 3.10 or newer and a GPU with bfloat16 support. A100, H100, or L40S-class
GPUs are recommended by the upstream project.

Liatir blocks installation on incompatible hosts and explains why.

## Limits and cautions

Chai-1 is not a fallback for macOS or CPU-only testing. Use Boltz-2 CPU mode for
local compatibility testing on machines without CUDA, understanding that CPU
runs can be slow.

This model is currently hidden from normal Liatir catalog surfaces until a Linux
CUDA validation environment is available.

## Official source

- [Chai-1 / chai-lab on GitHub](https://github.com/chaidiscovery/chai-lab)
