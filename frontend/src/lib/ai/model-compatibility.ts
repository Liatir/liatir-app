import type {
  LiatirAIModelHostRequirements,
  LiatirAIModelMetadata,
  LiatirAIModelPythonRequirement,
} from '@liatir/core';
import type { AIHardwareInfo } from './runtime';

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

export interface AIModelInstallBlock {
  kind: 'host-os' | 'host-arch' | 'cuda' | 'python';
  summary: string;
  reason: string;
  required: string;
  detected: string;
  details: string[];
  dependencyBinary?: string;
  actionLabel?: string;
}

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

function pythonMatches(
  version: string | null | undefined,
  requirement: LiatirAIModelPythonRequirement | undefined,
): boolean {
  const parsed = parseVersion(version);
  if (!parsed || !requirement) return false;
  if (requirement.minVersion) {
    const min = parseVersion(requirement.minVersion);
    if (min && compareVersions(parsed, min) < 0) return false;
  }
  if (requirement.maxVersionExclusive) {
    const max = parseVersion(requirement.maxVersionExclusive);
    if (max && compareVersions(parsed, max) >= 0) return false;
  }
  return true;
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
  if (hardware.cudaAvailable === true) accelerators.push('CUDA detected');
  if (hardware.cudaAvailable !== true) accelerators.push('CUDA not detected');
  return `${osLabel(hardware.os)} ${hardware.arch}${accelerators.length ? ` with ${accelerators.join(' and ')}` : ''}`;
}

function detectedPythonLabel(hardware: AIHardwareInfo): string {
  const candidates = hardware.pythonCandidates ?? [];
  if (candidates.length > 0) {
    return candidates.map((candidate) => `${candidate.version} at ${candidate.path}`).join(', ');
  }
  if (!hardware.pythonVersion) return 'no compatible Python detected';
  return `${hardware.pythonVersion}${hardware.pythonPath ? ` at ${hardware.pythonPath}` : ''}`;
}

function pythonDependencyBinary(
  requirement: LiatirAIModelPythonRequirement | undefined,
): string {
  if (!requirement) return 'python';
  const max = parseVersion(requirement.maxVersionExclusive);
  if (max && compareVersions(max, { major: 3, minor: 11, patch: 0 }) <= 0) {
    return 'python3.10';
  }
  if (requirement.minVersion?.startsWith('3.11')) return 'python3.11';
  if (requirement.minVersion?.startsWith('3.12')) return 'python3.12';
  return 'python3.11';
}

function pythonDependencyLabel(binary: string): string {
  if (binary === 'python3.10') return 'Python 3.10';
  if (binary === 'python3.11') return 'Python 3.11';
  if (binary === 'python3.12') return 'Python 3.12';
  return 'Python';
}

function pythonRequirementLabel(
  requirement: LiatirAIModelHostRequirements['python'],
): string {
  if (!requirement) return 'Python';
  if (requirement.label) return requirement.label;
  if (requirement.minVersion && requirement.maxVersionExclusive) {
    return `Python >=${requirement.minVersion},<${requirement.maxVersionExclusive}`;
  }
  if (requirement.minVersion) return `Python >=${requirement.minVersion}`;
  if (requirement.maxVersionExclusive) return `Python <${requirement.maxVersionExclusive}`;
  return 'Python';
}

export function modelInstallBlock(
  model: LiatirAIModelMetadata,
  hardware: AIHardwareInfo | null | undefined,
): AIModelInstallBlock | null {
  if (!hardware) return null;

  const requirements = model.install?.hostRequirements;
  if (requirements?.os?.length && !requirements.os.includes(hardware.os)) {
    const required = `${osListLabel(requirements.os)}${requirements.requiresCuda ? ' with NVIDIA CUDA' : ''}`;
    const detected = detectedHostLabel(hardware);
    const basis = requirements.reason ?? `This model supports ${required} hosts only.`;
    return {
      kind: 'host-os',
      summary: 'This model is not available on this system',
      required,
      detected,
      reason: `This model needs ${required}.`,
      details: [
        basis,
        `Detected: ${detected}`,
        `Required: ${required}`,
      ],
    };
  }

  if (requirements?.arch?.length && !requirements.arch.includes(hardware.arch)) {
    const required = requirements.arch.join(', ');
    const detected = detectedHostLabel(hardware);
    const basis = requirements.reason ?? `This model supports ${required} architectures only.`;
    return {
      kind: 'host-arch',
      summary: 'This model is not available on this architecture',
      required,
      detected,
      reason: `This model needs a ${required} build.`,
      details: [basis, `Detected: ${detected}`, `Required: ${required}`],
    };
  }

  if (requirements?.requiresCuda && hardware.cudaAvailable !== true) {
    const required = 'NVIDIA CUDA runtime';
    const detected = detectedHostLabel(hardware);
    const basis = requirements.reason ?? 'This model requires a CUDA-capable NVIDIA GPU runtime.';
    return {
      kind: 'cuda',
      summary: 'NVIDIA CUDA is required',
      required,
      detected,
      reason: 'This model needs a CUDA-capable NVIDIA GPU runtime.',
      details: [
        basis,
        `Detected: ${detected}`,
        `Required: ${required}`,
      ],
    };
  }

  if (requirements?.python && !pythonMatches(hardware.pythonVersion, requirements.python)) {
    const candidates = hardware.pythonCandidates ?? [];
    const hasCompatibleCandidate = candidates.some((candidate) =>
      pythonMatches(candidate.version, requirements.python)
    );
    if (hasCompatibleCandidate) return null;
    const required = pythonRequirementLabel(requirements.python);
    const detected = detectedPythonLabel(hardware);
    const basis = requirements.python.reason ?? `This model requires ${required}.`;
    const dependencyBinary = pythonDependencyBinary(requirements.python);
    return {
      kind: 'python',
      summary: 'A compatible Python runtime is missing',
      required,
      detected,
      reason: `Install ${required} from Dependencies, then install this AI Model.`,
      details: [
        basis,
        `Detected: ${detected}`,
        `Required: ${required}`,
      ],
      dependencyBinary,
      actionLabel: `Open ${pythonDependencyLabel(dependencyBinary)}`,
    };
  }

  return null;
}
