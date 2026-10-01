/**
 * Decides whether this machine can run a given AI Model, and if not, explains why.
 *
 * The check happens *before* an install starts, because these models are multi-gigabyte downloads
 * and discovering the incompatibility afterwards would waste the user's time and bandwidth.
 *
 * The output is written for a non-technical user: a block is not a boolean, it carries the reason,
 * what was required and what was actually detected.
 */
import type { LiatirAIModelMetadata, LiatirRuntimeBoxInstall, LiatirToolRuntimeMetadata } from '@liatir/core';
import type { AIHardwareInfo } from './runtime';

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

/** A reason the model cannot be installed here, in a shape the UI can render directly. */
export interface AIModelInstallBlock {
  kind: 'host-os' | 'host-arch' | 'cuda' | 'memory' | 'runtime-target';
  summary: string;
  reason: string;
  required: string;
  detected: string;
  details: string[];
}

/**
 * Extracts `major.minor[.patch]` from anywhere in a string, so the raw output of `python --version`
 * ("Python 3.11.9") parses without pre-processing. A missing patch is treated as 0.
 */
function parseVersion(value: string | null | undefined): VersionParts | null {
  const match = (value ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch };
}

function compareVersions(a: VersionParts, b: VersionParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function osLabel(os: string | null | undefined): string {
  switch ((os ?? '').toLowerCase()) {
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    case 'windows': return 'Windows';
    default: return os || 'unknown OS';
  }
}

function osListLabel(items: string[]): string {
  return items.map(osLabel).join(', ');
}

function detectedHostLabel(hardware: AIHardwareInfo): string {
  const accelerators: string[] = [];
  if (hardware.appleMetal) accelerators.push('Apple Metal');
  if (hardware.cudaAvailable === true) {
    accelerators.push(
      hardware.nvidiaDriverVersion
        ? `NVIDIA driver ${hardware.nvidiaDriverVersion}`
        : 'CUDA detected',
    );
  }
  if (hardware.cudaAvailable !== true) accelerators.push('CUDA not detected');
  if (hardware.wsl2Available) accelerators.push('WSL2 available');
  return `${osLabel(hardware.os)} ${hardware.arch}${accelerators.length ? ` with ${accelerators.join(' and ')}` : ''}`;
}

/**
 * Selects whether one ordered published Runtime Box target can run on this host.
 *
 * Mirrors the installer's selection: native targets first, then — on Windows x86_64 — a Linux
 * x86_64 CPU or CUDA box validated for WSL2. A CUDA box routed through WSL2 is checked against
 * the driver seen inside the distribution, not the one Windows reports.
 */
function runtimeBoxInstallBlock(
  runtimeBox: LiatirRuntimeBoxInstall,
  hardware: AIHardwareInfo,
  componentLabel: 'AI Model' | 'Tool Runtime',
): AIModelInstallBlock | null {
  const candidates = runtimeBox.publishedTargets ?? [];
  if (candidates.length === 0) {
    return {
      kind: 'runtime-target',
      summary: 'This model is not ready to install',
      required: 'A published Runtime Box target',
      detected: detectedHostLabel(hardware),
      reason: `This ${componentLabel} does not have a published Runtime Box for this computer yet.`,
      details: [`No published target is listed for this ${componentLabel}.`],
    };
  }

  const nativeCandidates = candidates.filter(
    (candidate) => candidate.target.platform === hardware.os
      && candidate.target.arch === hardware.arch
      && candidate.hostEnvironments.includes('native'),
  );
  const wslCandidates = candidates.filter(
    (candidate) => hardware.os === 'windows'
      && hardware.arch === 'x86_64'
      && candidate.target.platform === 'linux'
      && candidate.target.arch === 'x86_64'
      && (candidate.target.accelerator === 'cpu' || candidate.target.accelerator === 'cuda')
      && candidate.hostEnvironments.includes('windows-wsl2'),
  );
  if (nativeCandidates.length === 0 && wslCandidates.length > 0 && !hardware.wsl2Available) {
    return {
      kind: 'runtime-target',
      summary: 'WSL2 is required',
      required: 'A working x86_64 WSL2 Linux distribution',
      detected: hardware.wslError || 'WSL2 is not ready',
      reason: `This ${componentLabel} uses its signed Linux Runtime Box through WSL2 on Windows. Install or repair WSL2, then retry.`,
      details: [hardware.wslError || 'Liatir could not start a compatible WSL2 distribution.'],
    };
  }
  const runnableCandidates = [
    ...nativeCandidates.map((candidate) => ({ candidate, viaWsl2: false })),
    ...(hardware.wsl2Available ? wslCandidates.map((candidate) => ({ candidate, viaWsl2: true })) : []),
  ];
  if (runnableCandidates.length === 0) {
    const platformCandidates = candidates.filter(
      (candidate) => candidate.target.platform === hardware.os,
    );
    if (platformCandidates.length > 0) {
      const architectureCandidates = platformCandidates.filter(
        (candidate) => candidate.target.arch === hardware.arch,
      );
      if (architectureCandidates.length === 0) {
        const requiredArchitectures = [
          ...new Set(platformCandidates.map((candidate) => candidate.target.arch)),
        ];
        return {
          kind: 'host-arch',
          summary: 'This model is not available on this architecture',
          required: requiredArchitectures.join(', '),
          detected: `${osLabel(hardware.os)} ${hardware.arch}`,
          reason: `This ${componentLabel} needs a published ${requiredArchitectures.join(' or ')} Runtime Box.`,
          details: [
            `Detected architecture: ${hardware.arch}`,
            `Published architectures: ${requiredArchitectures.join(', ')}`,
          ],
        };
      }
      return {
        kind: 'runtime-target',
        summary: 'A compatible Runtime Box is not available',
        required: `${osLabel(hardware.os)} ${hardware.arch}`,
        detected: detectedHostLabel(hardware),
        reason: `This ${componentLabel} has no validated native or WSL2 Runtime Box for this computer.`,
        details: ['The published payload does not declare a supported execution environment.'],
      };
    }
    const requiredPlatforms = [
      ...new Set(candidates.map((candidate) => candidate.target.platform)),
    ];
    return {
      kind: 'host-os',
      summary: 'This model is not available on this system',
      required: osListLabel(requiredPlatforms),
      detected: detectedHostLabel(hardware),
      reason: `This ${componentLabel} does not have a published Runtime Box for ${osLabel(hardware.os)}.`,
      details: [
        `Published platforms: ${osListLabel(requiredPlatforms)}`,
        `Detected: ${detectedHostLabel(hardware)}`,
      ],
    };
  }

  const memoryBytes = hardware.totalMemoryBytes;
  let minimumMemoryGb: number | null = null;
  let minimumDriver: string | null = null;
  // Set when a CUDA box was rejected only because Windows sees the GPU and WSL2 does not, so the
  // message names that instead of a driver which is in fact current.
  let wslGpuUnreachable = false;
  for (const { candidate, viaWsl2 } of runnableCandidates) {
    if (
      candidate.minRamGb &&
      memoryBytes !== null &&
      memoryBytes < candidate.minRamGb * 1_000_000_000
    ) {
      minimumMemoryGb = Math.max(minimumMemoryGb ?? 0, candidate.minRamGb);
      continue;
    }
    if (candidate.target.accelerator === 'cpu') return null;
    if (candidate.target.accelerator === 'metal' && hardware.appleMetal) return null;
    if (candidate.target.accelerator === 'cuda') {
      const required = candidate.minNvidiaDriverVersion;
      if (!required) continue;
      minimumDriver = required;
      const available = viaWsl2 ? hardware.wslNvidiaDriverVersion : hardware.nvidiaDriverVersion;
      if (!available) {
        wslGpuUnreachable ||= viaWsl2 && Boolean(hardware.nvidiaDriverVersion);
        continue;
      }
      const installed = parseVersion(available);
      const minimum = parseVersion(required);
      if (installed && minimum && compareVersions(installed, minimum) >= 0) return null;
    }
  }

  if (minimumDriver && wslGpuUnreachable) {
    return {
      kind: 'cuda',
      summary: 'The GPU is not visible inside WSL2',
      required: 'An NVIDIA GPU reachable from WSL2',
      detected: `NVIDIA driver ${hardware.nvidiaDriverVersion} on Windows, no GPU inside WSL2`,
      reason: `This ${componentLabel} runs on the GPU through WSL2, but no NVIDIA GPU is visible inside your WSL2 installation. Run \`wsl --update\` in a terminal, restart WSL2, then try again.`,
      details: [
        `Detected: ${detectedHostLabel(hardware)}`,
        'Windows reports the NVIDIA driver, but WSL2 cannot reach the GPU.',
      ],
    };
  }

  if (minimumDriver) {
    return {
      kind: 'cuda',
      summary: 'A compatible NVIDIA driver is required',
      required: `NVIDIA driver ${minimumDriver} or newer`,
      detected: hardware.nvidiaDriverVersion
        ? `NVIDIA driver ${hardware.nvidiaDriverVersion}`
        : 'No compatible NVIDIA driver detected',
      reason: hardware.nvidiaDriverVersion
        ? `Update the NVIDIA driver to ${minimumDriver} or newer. No compatible CPU Runtime Box is published for this ${componentLabel}.`
        : `This ${componentLabel} needs an NVIDIA GPU with driver ${minimumDriver} or newer. No compatible CPU Runtime Box is published.`,
      details: [
        `Detected: ${detectedHostLabel(hardware)}`,
        `Required: NVIDIA driver ${minimumDriver} or newer`,
      ],
    };
  }

  if (minimumMemoryGb !== null && memoryBytes !== null) {
    const detectedMemoryGb = Math.floor(memoryBytes / 1_000_000_000);
    return {
      kind: 'memory',
      summary: 'More memory is required',
      required: `${minimumMemoryGb} GB of memory`,
      detected: `${detectedMemoryGb} GB of memory`,
      reason: `This ${componentLabel} needs at least ${minimumMemoryGb} GB of memory.`,
      details: [`Detected: ${detectedMemoryGb} GB`, `Required: ${minimumMemoryGb} GB`],
    };
  }

  return {
    kind: 'runtime-target',
    summary: 'No compatible Runtime Box is available',
    required: `A validated ${osLabel(hardware.os)} ${hardware.arch} execution path`,
    detected: detectedHostLabel(hardware),
    reason: 'No published Runtime Box target is compatible with this computer.',
    details: ['No native or WSL2 candidate satisfies the detected hardware requirements.'],
  };
}

/**
 * Returns the first reason this model cannot be installed here, or `null` if it can.
 *
 * Target selection checks OS, architecture, memory, and accelerator compatibility.
 *
 * Unknown hardware yields `null` — permissive on purpose. If the probe failed we cannot prove the
 * machine is unsuitable, and blocking an install on a failed probe would be worse than letting the
 * install try and fail with a real error.
 */
export function modelInstallBlock(
  model: LiatirAIModelMetadata,
  hardware: AIHardwareInfo | null | undefined,
): AIModelInstallBlock | null {
  if (!hardware) return null;

  return runtimeBoxInstallBlock(model.install.runtimeBox, hardware, 'AI Model');
}

export function toolRuntimeInstallBlock(
  runtime: LiatirToolRuntimeMetadata,
  hardware: AIHardwareInfo | null | undefined,
): AIModelInstallBlock | null {
  if (!hardware) return null;
  return runtimeBoxInstallBlock(runtime.install.runtimeBox, hardware, 'Tool Runtime');
}
