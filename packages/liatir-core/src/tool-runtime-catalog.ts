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

/**
 * Release-ready pVACseq metadata. It is intentionally not in the installable catalog until one
 * exact target has completed native validation and publication.
 */
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
      publishedTargets: [],
    },
    hostRequirements: {
      os: ["macos", "linux"],
      arch: ["aarch64", "x86_64"],
      reason: "Upstream supports Linux and reports limited macOS use; a Windows target needs WSL2 evidence before product exposure.",
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

/**
 * Phase 1 establishes the Tool Runtime product contract. Concrete entries are added only with
 * their reviewed Scrollcase recipes and published targets in the component-specific phases.
 */
export const LIATIR_TOOL_RUNTIME_CATALOG: readonly LiatirToolRuntimeMetadata[] = [];

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
