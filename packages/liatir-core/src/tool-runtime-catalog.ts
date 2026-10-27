import type {
  AiRuntimePackageCheck,
  LiatirAIModelHardwareRequirements,
  LiatirAIModelHostRequirements,
  LiatirAIModelLicense,
  LiatirAIModelRuntime,
  LiatirPythonRuntimePackage,
} from "./index.js";
import type {
  LiatirRuntimeBoxActivationMetadata,
  LiatirRuntimeBoxInstall,
} from "./runtime-box.js";
import { PVACTOOLS_RUNTIME_COMPONENT_ID, PVACTOOLS_RUNTIME_ID } from "./oncology.js";
import {
  OPENMM_BOX_ID,
  OPENMM_RUNTIME_COMPONENT_ID,
  OPENMM_RUNTIME_ID,
  OPENMM_VERSION,
} from "./structure-simulation.js";

export type LiatirToolRuntimeStatus = "available" | "installed" | "missing" | "error";

export interface LiatirToolRuntimeInstallSpec {
  method: "runtime-box";
  runtimeId: string;
  runtimePackages?: LiatirPythonRuntimePackage[];
  runtimeBox: LiatirRuntimeBoxInstall;
  hostRequirements?: LiatirAIModelHostRequirements;
}

/** A scientific command environment installed on demand, but not presented as an AI Model. */
export interface LiatirToolRuntimeMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  runtime: LiatirAIModelRuntime;
  localOnly: true;
  install: LiatirToolRuntimeInstallSpec;
  license?: LiatirAIModelLicense;
  hardware?: LiatirAIModelHardwareRequirements;
  documentation?: {
    liatirPath?: string;
    officialUrl?: string;
  };
  tags?: string[];
}

export interface LiatirToolRuntimeRecord extends LiatirToolRuntimeMetadata {
  status: LiatirToolRuntimeStatus;
  runtimePath?: string;
  installedSizeBytes?: number;
  runtimeBoxActivation?: LiatirRuntimeBoxActivationMetadata;
  updatedAt?: number;
  error?: string;
}

/** Published pVACseq metadata. Only the exact target with retained production evidence is exposed. */
export const PVACTOOLS_TOOL_RUNTIME_METADATA: LiatirToolRuntimeMetadata = {
  id: PVACTOOLS_RUNTIME_COMPONENT_ID,
  name: "pVACtools pVACseq",
  description: "Local MHC Class I neoantigen prioritization with the supported pVACtools and MHCflurry pair.",
  category: "Oncology",
  version: "7.1.2",
  runtime: { kind: "python-venv", name: "pVACseq Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: PVACTOOLS_RUNTIME_ID,
    runtimePackages: [
      { package: "pysam", importName: "pysam" },
      { package: "numpy", version: "1.26.4", importName: "numpy" },
      { package: "pandas", specifier: "pandas<2.1", importName: "pandas" },
    ],
    runtimeBox: {
      boxId: "pvactools-pvacseq",
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "macos", arch: "aarch64", accelerator: "cpu" },
        hostEnvironments: ["native"],
        minRamGb: 8,
      }, {
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 8,
      }],
    },
    hostRequirements: {
      os: ["macos", "linux", "windows"],
      arch: ["aarch64", "x86_64"],
      reason: "pVACseq ships as signed Runtime Boxes for Apple silicon and Linux x86_64 CPU; Windows uses the validated Linux CPU box through WSL2.",
    },
  },
  license: {
    name: "BSD 3-Clause Clear",
    spdxId: "BSD-3-Clause-Clear",
    url: "https://github.com/griffithlab/pVACtools/blob/v7.1.2/LICENSE",
    verifiedAt: "2026-08-26",
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 8,
    recommendedRamGb: 16,
    notes: "This locked pVACseq surface uses only local MHCflurry and MHCflurryEL predictors.",
  },
  documentation: {
    officialUrl: "https://pvactools.readthedocs.io/en/7.1.2/pvacseq/run.html",
  },
  tags: ["runtime-box", "oncology", "neoantigen", "pvacseq", "mhc-class-i"],
};

/** Exact metadata used by a release-built test app and the product after publication. */
export const PVACTOOLS_RELEASE_CANDIDATE_METADATA = PVACTOOLS_TOOL_RUNTIME_METADATA;

/**
 * OpenMM as offered on `beta`: the release-built test app and the product share this metadata.
 *
 * Only the CUDA target is offered. The CPU and macOS targets stay authored for a later release.
 * The driver floor is CUDA 12.9's rather than the 12.x minor-version floor, because OpenMM hands
 * PTX to the driver to compile — see the decision record "OpenMM CUDA needs the CUDA 12.9 driver".
 * The installer requires every requirement here to equal the signed release's exactly.
 */
export const OPENMM_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: OPENMM_RUNTIME_COMPONENT_ID,
  name: "OpenMM 8.5.1",
  description: "Local molecular relaxation and standard molecular dynamics with Amber19, TIP3P-FB and OpenFF ligand parameterization.",
  category: "Molecular Simulation",
  version: OPENMM_VERSION,
  runtime: { kind: "python-venv", name: "OpenMM Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: OPENMM_RUNTIME_ID,
    runtimePackages: [
      { package: "openmm", specifier: `openmm==${OPENMM_VERSION}`, importName: "openmm" },
      { package: "openff-toolkit", specifier: "openff-toolkit==0.17.1", importName: "openff.toolkit" },
      { package: "openforcefields", specifier: "openforcefields==2026.1.0", importName: "openforcefields" },
      { package: "openff-nagl", importName: "openff.nagl" },
      { package: "openff-nagl-models", specifier: "openff-nagl-models==2025.9.0", importName: "openff.nagl_models" },
      { package: "rdkit", specifier: "rdkit==2025.3.6", importName: "rdkit" },
    ],
    runtimeBox: {
      boxId: OPENMM_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cuda", cudaVersion: "12.9" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 8,
        minNvidiaDriverVersion: "575.51.03",
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "OpenMM runs on an NVIDIA GPU: on Linux x86_64 natively, or on Windows through WSL2. It is not available on macOS or without an NVIDIA GPU.",
    },
  },
  license: {
    name: "OpenMM MIT core with LGPL-3.0-or-later platform plugins",
    spdxId: "MIT AND LGPL-3.0-or-later AND CC-BY-4.0",
    url: "https://github.com/openmm/openmm/tree/8.5.1/docs-source/licenses",
    verifiedAt: "2026-09-02",
    components: [
      { scope: "source-code", name: "OpenMM API and Reference/CPU platforms", spdxId: "MIT", sourceUrl: "https://github.com/openmm/openmm/tree/8.5.1" },
      { scope: "runtime", name: "OpenMM CUDA and OpenCL platforms", spdxId: "LGPL-3.0-or-later", sourceUrl: "https://github.com/openmm/openmm/tree/8.5.1/platforms" },
      { scope: "runtime", name: "OpenMMForceFields 0.16.0", spdxId: "MIT", sourceUrl: "https://github.com/openmm/openmmforcefields/tree/0.16.0" },
      { scope: "runtime", name: "OpenFF Toolkit and NAGL code", spdxId: "MIT", sourceUrl: "https://github.com/openforcefield" },
      { scope: "runtime", name: "OpenFF force-fields 2026.01 with Sage 2.3.0, plus NAGL model data", spdxId: "CC-BY-4.0", sourceUrl: "https://github.com/openforcefield/openff-forcefields/tree/2026.01.0" },
    ],
  },
  hardware: {
    cpu: false,
    gpu: true,
    minRamGb: 8,
    notes: "Needs an NVIDIA GPU with driver 575.51.03 or newer; on Windows, 576.02 or newer with the GPU visible inside WSL2. GPU memory values are published only from retained target measurements.",
  },
  documentation: { officialUrl: "https://docs.openmm.org/8.5.0/" },
  tags: ["runtime-box", "openmm", "molecular-dynamics", "relaxation", "amber19", "openff"],
};

/**
 * Tool Runtimes enter this catalog only with reviewed Scrollcase recipes and published targets.
 */
export const LIATIR_TOOL_RUNTIME_CATALOG: readonly LiatirToolRuntimeMetadata[] = [
  PVACTOOLS_TOOL_RUNTIME_METADATA,
];

export function runtimeIdForToolRuntime(runtime: LiatirToolRuntimeMetadata): string {
  return runtime.install.runtimeId;
}

export function packageChecksForToolRuntime(runtime: LiatirToolRuntimeMetadata): AiRuntimePackageCheck[] {
  return (runtime.install.runtimePackages ?? []).map((pkg) => ({
    package: pkg.package,
    ...(pkg.importName ? { importName: pkg.importName } : {}),
    ...(pkg.specifier ? { specifier: pkg.specifier } : {}),
  }));
}
