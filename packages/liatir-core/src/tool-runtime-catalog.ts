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
  AUTODOCK_VINA_VERSION,
  MOLECULAR_DOCKING_BOX_ID,
  MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
  MOLECULAR_DOCKING_RUNTIME_ID,
} from "./molecular-docking.js";
import {
  MDANALYSIS_VERSION,
  MOLECULAR_ANALYSIS_BOX_ID,
  MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
  MOLECULAR_ANALYSIS_RUNTIME_ID,
  PROLIF_VERSION,
} from "./molecular-analysis.js";
import {
  COBRAPY_VERSION,
  HIGHS_VERSION,
  METABOLIC_MODELING_BOX_ID,
  METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
  METABOLIC_MODELING_RUNTIME_ID,
} from "./metabolic-modeling.js";
import {
  BIOCHEMICAL_SIMULATION_BOX_ID,
  BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
  BIOCHEMICAL_SIMULATION_RUNTIME_ID,
  PYSB_VERSION,
} from "./biochemical-simulation.js";
import {
  PHYSICELL_BOX_ID,
  PHYSICELL_RUNTIME_COMPONENT_ID,
  PHYSICELL_RUNTIME_ID,
  PHYSICELL_VERSION,
} from "./physicell.js";
import {
  GNINA_BOX_ID,
  GNINA_RUNTIME_COMPONENT_ID,
  GNINA_RUNTIME_ID,
  GNINA_VERSION,
} from "./gnina.js";
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
  documentation: {
    liatirPath: "/tools/molecular-simulation",
    officialUrl: "https://docs.openmm.org/8.5.0/",
  },
  tags: ["runtime-box", "openmm", "molecular-dynamics", "relaxation", "amber19", "openff"],
};

/**
 * Molecular docking as a release candidate: AutoDock Vina with Meeko, PDBFixer and Ringtail in one
 * Linux CPU box that also serves Windows through WSL2. It joins the catalog only once published; the
 * installer requires every requirement here to equal the signed release's exactly.
 */
export const MOLECULAR_DOCKING_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
  name: "AutoDock Vina 1.2.7",
  description: "Local receptor preparation, molecular docking and virtual screening with AutoDock Vina, Meeko, PDBFixer and Ringtail.",
  category: "Molecular Docking",
  version: AUTODOCK_VINA_VERSION,
  runtime: { kind: "python-venv", name: "Molecular Docking Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: MOLECULAR_DOCKING_RUNTIME_ID,
    runtimePackages: [
      { package: "vina", specifier: `vina==${AUTODOCK_VINA_VERSION}`, importName: "vina" },
      { package: "meeko", specifier: "meeko==0.8.0", importName: "meeko" },
      { package: "ringtail", specifier: "ringtail==2.3.1", importName: "ringtail" },
      { package: "pdbfixer", specifier: "pdbfixer==1.12.0", importName: "pdbfixer" },
      { package: "rdkit", specifier: "rdkit==2024.9.6", importName: "rdkit" },
    ],
    runtimeBox: {
      boxId: MOLECULAR_DOCKING_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "Molecular docking runs on the CPU of a Linux x86_64 computer, natively or on Windows through WSL2. It is not available on macOS.",
    },
  },
  license: {
    name: "AutoDock Vina Apache-2.0 with LGPL-2.1 Meeko and Ringtail",
    spdxId: "Apache-2.0 AND LGPL-2.1-only AND MIT AND BSD-3-Clause",
    url: "https://github.com/ccsb-scripps/AutoDock-Vina/blob/v1.2.7/LICENSE",
    verifiedAt: "2026-11-03",
    components: [
      { scope: "runtime", name: "AutoDock Vina 1.2.7", spdxId: "Apache-2.0", sourceUrl: "https://github.com/ccsb-scripps/AutoDock-Vina/tree/v1.2.7" },
      { scope: "runtime", name: "Meeko 0.8.0", spdxId: "LGPL-2.1-only", sourceUrl: "https://github.com/forlilab/Meeko/tree/v0.8.0" },
      { scope: "runtime", name: "Ringtail 2.3.1", spdxId: "LGPL-2.1-only", sourceUrl: "https://github.com/forlilab/Ringtail/tree/v2.3.1" },
      { scope: "runtime", name: "PDBFixer 1.12 with the OpenMM 8.5.1 library", spdxId: "MIT", sourceUrl: "https://github.com/openmm/pdbfixer/tree/v1.12" },
      { scope: "runtime", name: "RDKit 2024.09.6", spdxId: "BSD-3-Clause", sourceUrl: "https://github.com/rdkit/rdkit/tree/Release_2024_09_6" },
    ],
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 4,
    notes: "Runs on the CPU only. Run time and memory are estimated from retained measurements of this exact release.",
  },
  documentation: {
    liatirPath: "/tools/molecular-docking",
    officialUrl: "https://autodock-vina.readthedocs.io/en/latest/",
  },
  tags: ["runtime-box", "docking", "virtual-screening", "autodock-vina", "meeko", "pdbfixer", "ringtail"],
};

/**
 * Trajectory analysis and interaction fingerprints as a release candidate: MDAnalysis and ProLIF in one
 * Linux CPU box that also serves Windows through WSL2. It joins the catalog only once published; the
 * installer requires every requirement here to equal the signed release's exactly.
 */
export const MOLECULAR_ANALYSIS_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
  name: "MDAnalysis 2.11.0 and ProLIF 2.2.3",
  description: "Local trajectory analysis (RMSD, RMSF, distances) and protein-ligand interaction fingerprints for simulations and docked poses.",
  category: "Molecular Analysis",
  version: MDANALYSIS_VERSION,
  runtime: { kind: "python-venv", name: "Molecular Analysis Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: MOLECULAR_ANALYSIS_RUNTIME_ID,
    runtimePackages: [
      { package: "MDAnalysis", specifier: `MDAnalysis==${MDANALYSIS_VERSION}`, importName: "MDAnalysis" },
      { package: "prolif", specifier: `prolif==${PROLIF_VERSION}`, importName: "prolif" },
      { package: "rdkit", specifier: "rdkit==2026.9.1", importName: "rdkit" },
    ],
    runtimeBox: {
      boxId: MOLECULAR_ANALYSIS_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "Molecular analysis runs on the CPU of a Linux x86_64 computer, natively or on Windows through WSL2. It is not available on macOS.",
    },
  },
  license: {
    name: "MDAnalysis LGPL-3.0-or-later with Apache-2.0 ProLIF",
    spdxId: "LGPL-3.0-or-later AND Apache-2.0 AND BSD-3-Clause",
    url: "https://github.com/MDAnalysis/mdanalysis/blob/package-2.11.0/LICENSE",
    verifiedAt: "2026-11-03",
    components: [
      { scope: "runtime", name: "MDAnalysis 2.11.0", spdxId: "LGPL-3.0-or-later", sourceUrl: "https://github.com/MDAnalysis/mdanalysis/tree/package-2.11.0" },
      { scope: "runtime", name: "ProLIF 2.2.3", spdxId: "Apache-2.0", sourceUrl: "https://github.com/chemosim-lab/ProLIF/tree/v2.2.3" },
      { scope: "runtime", name: "RDKit 2026.09.1", spdxId: "BSD-3-Clause", sourceUrl: "https://github.com/rdkit/rdkit/tree/Release_2026_09_1" },
    ],
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 4,
    notes: "Runs on the CPU only. Run time and memory are estimated from retained measurements of this exact release.",
  },
  documentation: {
    liatirPath: "/tools/molecular-analysis",
    officialUrl: "https://docs.mdanalysis.org/2.11.0/",
  },
  tags: ["runtime-box", "trajectory-analysis", "interaction-fingerprint", "mdanalysis", "prolif"],
};

/**
 * Constraint-based metabolic modeling as a release candidate: COBRApy with HiGHS, confirmed by GLPK, in
 * one Linux CPU box that also serves Windows through WSL2. It joins the catalog only once published;
 * the installer requires every requirement here to equal the signed release's exactly.
 */
export const METABOLIC_MODELING_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
  name: "COBRApy 0.32.1 with HiGHS",
  description: "Local flux balance and flux variability analysis, and single gene and reaction deletions, on genome-scale metabolic models.",
  category: "Systems Biology",
  version: COBRAPY_VERSION,
  runtime: { kind: "python-venv", name: "Metabolic Modeling Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: METABOLIC_MODELING_RUNTIME_ID,
    runtimePackages: [
      { package: "cobra", specifier: `cobra==${COBRAPY_VERSION}`, importName: "cobra" },
      { package: "optlang", specifier: "optlang==1.9.1", importName: "optlang" },
      { package: "highspy", specifier: `highspy==${HIGHS_VERSION}`, importName: "highspy" },
      { package: "swiglpk", specifier: "swiglpk==5.0.13", importName: "swiglpk" },
    ],
    runtimeBox: {
      boxId: METABOLIC_MODELING_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "Metabolic modeling runs on the CPU of a Linux x86_64 computer, natively or on Windows through WSL2. It is not available on macOS.",
    },
  },
  license: {
    name: "COBRApy LGPL-2.0-or-later with MIT HiGHS and GPL-3.0 GLPK",
    spdxId: "LGPL-2.0-or-later AND Apache-2.0 AND MIT AND GPL-3.0-or-later",
    url: "https://github.com/opencobra/cobrapy/blob/0.32.1/LICENSE",
    verifiedAt: "2026-11-04",
    components: [
      { scope: "runtime", name: "COBRApy 0.32.1", spdxId: "LGPL-2.0-or-later", sourceUrl: "https://github.com/opencobra/cobrapy/tree/0.32.1" },
      { scope: "runtime", name: "optlang 1.9.1", spdxId: "Apache-2.0", sourceUrl: "https://github.com/opencobra/optlang/tree/1.9.1" },
      { scope: "runtime", name: "HiGHS 1.15.1", spdxId: "MIT", sourceUrl: "https://github.com/ERGO-Code/HiGHS" },
      { scope: "runtime", name: "GLPK 5.0", spdxId: "GPL-3.0-or-later", sourceUrl: "https://www.gnu.org/software/glpk/" },
    ],
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 4,
    notes: "Runs on the CPU only. Run time and memory are estimated from retained measurements of this exact release.",
  },
  documentation: {
    liatirPath: "/tools/metabolic-modeling",
    officialUrl: "https://cobrapy.readthedocs.io/en/0.32.1/",
  },
  tags: ["runtime-box", "metabolic-modeling", "flux-balance-analysis", "cobrapy", "highs"],
};

/**
 * PySB with BioNetGen, kept out of the product catalog until a signed target is published; the
 * installer requires every requirement here to equal the signed release's exactly.
 */
export const BIOCHEMICAL_SIMULATION_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
  name: "PySB 1.17.0 with BioNetGen 2.9.3",
  description: "Local deterministic and stochastic simulation of rule-based biochemical reaction networks.",
  category: "Systems Biology",
  version: PYSB_VERSION,
  runtime: { kind: "python-venv", name: "Biochemical Simulation Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: BIOCHEMICAL_SIMULATION_RUNTIME_ID,
    runtimePackages: [
      { package: "pysb", specifier: `pysb==${PYSB_VERSION}`, importName: "pysb" },
      { package: "sympy", specifier: "sympy==1.11.1", importName: "sympy" },
      { package: "scipy", specifier: "scipy==1.17.1", importName: "scipy" },
      { package: "numpy", specifier: "numpy==2.4.6", importName: "numpy" },
    ],
    runtimeBox: {
      boxId: BIOCHEMICAL_SIMULATION_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "Biochemical simulation runs on the CPU of a Linux x86_64 computer with glibc 2.34 or newer, natively or on Windows through WSL2. It is not available on macOS.",
    },
  },
  license: {
    name: "PySB BSD-2-Clause with MIT BioNetGen",
    spdxId: "BSD-2-Clause AND MIT AND BSD-3-Clause AND (Artistic-1.0-Perl OR GPL-1.0-or-later)",
    url: "https://github.com/pysb/pysb/blob/v1.17.0/LICENSE",
    verifiedAt: "2026-11-04",
    components: [
      { scope: "runtime", name: "PySB 1.17.0", spdxId: "BSD-2-Clause", sourceUrl: "https://github.com/pysb/pysb/tree/v1.17.0" },
      { scope: "runtime", name: "BioNetGen 2.9.3", spdxId: "MIT", sourceUrl: "https://github.com/RuleWorld/bionetgen/releases/tag/BioNetGen-2.9.3" },
      { scope: "runtime", name: "SUNDIALS CVODE 2.6.0, in BioNetGen's run_network", spdxId: "BSD-3-Clause", sourceUrl: "https://github.com/LLNL/sundials" },
      { scope: "runtime", name: "muParser, in BioNetGen's run_network", spdxId: "MIT", sourceUrl: "https://github.com/beltoforion/muparser" },
      { scope: "runtime", name: "Perl 5.44", spdxId: "Artistic-1.0-Perl OR GPL-1.0-or-later", sourceUrl: "https://www.perl.org/" },
    ],
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 4,
    notes: "Runs on the CPU only. Network generation stops at 4 GB of memory or 5 minutes of computing; run time and memory are estimated from retained measurements of this exact release.",
  },
  documentation: {
    liatirPath: "/tools/biochemical-simulation",
    officialUrl: "https://pysb.readthedocs.io/en/v1.17.0/",
  },
  tags: ["runtime-box", "biochemical-simulation", "rule-based-modeling", "pysb", "bionetgen"],
};

/**
 * PhysiCell, kept out of the product catalog until a signed target is published; the installer
 * requires every requirement here to equal the signed release's exactly.
 */
export const PHYSICELL_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: PHYSICELL_RUNTIME_COMPONENT_ID,
  name: "PhysiCell 1.14.2",
  description: "Local agent-based simulation of multicellular systems: cells that grow, divide, move, die and exchange substrates.",
  category: "Systems Biology",
  version: PHYSICELL_VERSION,
  runtime: { kind: "python-venv", name: "Multicellular Simulation Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: PHYSICELL_RUNTIME_ID,
    runtimePackages: [
      { package: "numpy", specifier: "numpy==2.4.6", importName: "numpy" },
      { package: "scipy", specifier: "scipy==1.17.1", importName: "scipy" },
    ],
    runtimeBox: {
      boxId: PHYSICELL_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "Multicellular simulation runs on the CPU of a Linux x86_64 computer, natively or on Windows through WSL2. It is not available on macOS.",
    },
  },
  license: {
    name: "PhysiCell BSD-3-Clause with BioFVM and pugixml",
    spdxId: "BSD-3-Clause AND MIT",
    url: "https://github.com/MathCancer/PhysiCell/blob/1.14.2/LICENSE.md",
    verifiedAt: "2026-11-04",
    components: [
      { scope: "runtime", name: "PhysiCell 1.14.2", spdxId: "BSD-3-Clause", sourceUrl: "https://github.com/MathCancer/PhysiCell/releases/tag/1.14.2" },
      { scope: "runtime", name: "BioFVM, in PhysiCell 1.14.2", spdxId: "BSD-3-Clause", sourceUrl: "https://github.com/MathCancer/PhysiCell/tree/1.14.2/BioFVM" },
      { scope: "runtime", name: "pugixml, in PhysiCell 1.14.2", spdxId: "MIT", sourceUrl: "https://github.com/zeux/pugixml" },
      { scope: "runtime", name: "GCC runtime libraries 15.3.0, linked into the executable", spdxId: "GPL-3.0-or-later WITH GCC-exception-3.1", sourceUrl: "https://gcc.gnu.org/" },
    ],
  },
  hardware: {
    cpu: true,
    gpu: false,
    minRamGb: 4,
    notes: "Runs on the CPU, with one thread by default so that a seed repeats a run exactly. Run time grows with the number of cells a model makes; estimates come from retained measurements of this exact release.",
  },
  documentation: {
    liatirPath: "/tools/multicellular-simulation",
    officialUrl: "http://physicell.org/",
  },
  tags: ["runtime-box", "multicellular-simulation", "agent-based-model", "physicell"],
};

/**
 * GNINA, kept out of the product catalog until a signed target is published; the installer requires
 * every requirement here to equal the signed release's exactly. The box does not contain GNINA: the
 * installer downloads GNINA's own release asset and verifies it before the box is activated.
 */
export const GNINA_RELEASE_CANDIDATE_METADATA: LiatirToolRuntimeMetadata = {
  id: GNINA_RUNTIME_COMPONENT_ID,
  name: "GNINA 1.3.3",
  description: "Local rescoring of docked poses with GNINA's convolutional neural networks, beside their Vina scores.",
  category: "Molecular Docking",
  version: GNINA_VERSION,
  runtime: { kind: "python-venv", name: "Neural Pose Rescoring Runtime", version: "Python 3.11" },
  localOnly: true,
  install: {
    method: "runtime-box",
    runtimeId: GNINA_RUNTIME_ID,
    runtimeBox: {
      boxId: GNINA_BOX_ID,
      channel: "beta",
      registryBaseUrl: "https://models.liatir.com/v1",
      publishedTargets: [{
        target: { platform: "linux", arch: "x86_64", accelerator: "cuda", cudaVersion: "12.8" },
        hostEnvironments: ["native", "windows-wsl2"],
        minRamGb: 4,
        minNvidiaDriverVersion: "570.26",
      }],
    },
    hostRequirements: {
      os: ["linux", "windows"],
      arch: ["x86_64"],
      reason: "GNINA runs on an NVIDIA GPU: on Linux x86_64 natively (glibc 2.35 or newer, such as Ubuntu 22.04), or on Windows through WSL2. It is not available on macOS or without an NVIDIA GPU.",
    },
  },
  license: {
    name: "GNINA GPL-2.0 (with OpenBabel), downloaded from GNINA's own release at install",
    spdxId: "GPL-2.0-only",
    url: "https://github.com/gnina/gnina/blob/v1.3.3/LICENSE.GNU",
    verifiedAt: "2026-11-05",
    components: [
      { scope: "runtime", name: "GNINA 1.3.3 release binary, fetched from GNINA's GitHub release and never redistributed by Liatir", spdxId: "GPL-2.0-only", sourceUrl: "https://github.com/gnina/gnina/releases/tag/v1.3.3" },
    ],
  },
  hardware: {
    cpu: false,
    gpu: true,
    minRamGb: 4,
    notes: "Needs an NVIDIA GPU of compute capability 6.0 (Pascal) or newer with driver 570.26 or newer; on Windows, 570.65 or newer with the GPU visible inside WSL2. Installing downloads the box and GNINA's own 2.1 GB program from GNINA's GitHub release.",
  },
  documentation: {
    liatirPath: "/tools/neural-pose-rescoring",
    officialUrl: "https://github.com/gnina/gnina",
  },
  tags: ["runtime-box", "gnina", "molecular-docking", "pose-rescoring", "cnn"],
};

/**
 * Tool Runtimes enter this catalog only with reviewed Scrollcase recipes and published targets.
 */
export const LIATIR_TOOL_RUNTIME_CATALOG: readonly LiatirToolRuntimeMetadata[] = [
  PVACTOOLS_TOOL_RUNTIME_METADATA,
  OPENMM_RELEASE_CANDIDATE_METADATA,
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
