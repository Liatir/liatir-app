/**
 * Decides whether this machine can run a given AI Model, and if not, explains why.
 *
 * The check happens *before* an install starts, because these models are multi-gigabyte downloads
 * and discovering the incompatibility afterwards would waste the user's time and bandwidth.
 *
 * The output is written for a non-technical user: a block is not a boolean, it carries the reason,
 * what was required, what was actually detected, and — where the problem is fixable — an action to
 * take. "You need Python 3.11, you have 3.13, here is where to install it" is actionable in a way
 * that "incompatible" is not.
 */
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

/** A reason the model cannot be installed here, in a shape the UI can render directly. */
export interface AIModelInstallBlock {
  kind: 'host-os' | 'host-arch' | 'cuda' | 'python';
  summary: string;
  reason: string;
  required: string;
  detected: string;
  details: string[];
  /** Set only for fixable blocks: the dependency the user can install to resolve this. */
  dependencyBinary?: string;
  actionLabel?: string;
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

/**
 * Whether a Python version satisfies a requirement.
 *
 * The bounds are inclusive-min / exclusive-max, which is how these models actually specify support
 * (e.g. ">=3.10, <3.12"): a new Python release is not assumed to work until it has been tested.
 */
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

/**
 * Maps a version requirement to the concrete Python the user should install.
 *
 * A range is not something a user can act on, so it is collapsed to one specific interpreter that
 * satisfies it. The first branch handles an upper bound at or below 3.11 — meaning 3.11 itself is
 * excluded — so 3.10 is the newest that would work. The default is 3.11, the version these models
 * are most broadly tested against.
 */
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

/**
 * Returns the first reason this model cannot be installed here, or `null` if it can.
 *
 * Checks run cheapest-and-most-fundamental first (OS, then architecture, then GPU, then Python), so
 * the user is shown the blocker that actually matters rather than a downstream symptom of it.
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
    // The *default* Python is incompatible — but that is not the end of the story. Users commonly
    // have several installed, and the runtime will pick a suitable one. So before blocking, check
    // every detected interpreter: if any of them satisfies the requirement, there is no problem.
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
