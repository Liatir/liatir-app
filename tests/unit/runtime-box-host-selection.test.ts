import { describe, expect, it } from 'vitest';
import {
  RUNTIME_BOX_AI_MODEL_REGISTRY,
  GENEFORMER_V1_10M_MODEL_ID,
  MHCFLURRY_CLASS1_PRESENTATION_METADATA,
  getRuntimeBoxAIModelMetadata,
} from '../../packages/liatir-core/src/ai-catalog';
import { PVACTOOLS_TOOL_RUNTIME_METADATA } from '../../packages/liatir-core/src/tool-runtime-catalog';
import type {
  LiatirAIModelMetadata,
  LiatirRuntimeBoxActivationMetadata,
  LiatirRuntimeBoxTargetCandidate,
} from '../../packages/liatir-core/src/index';
import {
  runtimeBoxActivationFromMetadata,
  runtimeBoxResultProvenance,
} from '../../frontend/src/lib/ai/runtime-box-provenance';
import type { AIHardwareInfo } from '../../frontend/src/lib/ai/runtime';
import {
  modelInstallBlock,
  toolRuntimeInstallBlock,
} from '../../frontend/src/lib/ai/model-compatibility';

const baseModel = getRuntimeBoxAIModelMetadata(GENEFORMER_V1_10M_MODEL_ID)!;

function modelWithTargets(
  publishedTargets: readonly LiatirRuntimeBoxTargetCandidate[],
): LiatirAIModelMetadata {
  return {
    ...baseModel,
    install: {
      ...baseModel.install!,
      method: 'runtime-box',
      runtimeBox: {
        ...baseModel.install!.runtimeBox!,
        publishedTargets,
      },
    },
  };
}

function hardware(
  os: AIHardwareInfo['os'],
  arch: string,
  nvidiaDriverVersion?: string,
): AIHardwareInfo {
  return {
    os,
    arch,
    cpuCores: 8,
    totalMemoryBytes: 64 * 1024 ** 3,
    appleMetal: os === 'macos',
    cudaAvailable: nvidiaDriverVersion ? true : null,
    nvidiaDriverVersion: nvidiaDriverVersion ?? null,
    wsl2Available: false,
    wslDistribution: null,
    wslError: null,
  };
}

function candidate(
  platform: 'macos' | 'linux' | 'windows',
  accelerator: 'cpu' | 'metal' | 'cuda',
  options: {
    arch?: 'aarch64' | 'x86_64';
    cudaVersion?: string;
    minNvidiaDriverVersion?: string;
    minRamGb?: number;
    hostEnvironments?: Array<'native' | 'windows-wsl2'>;
  } = {},
): LiatirRuntimeBoxTargetCandidate {
  return {
    target: {
      platform,
      arch: options.arch ?? (platform === 'macos' ? 'aarch64' : 'x86_64'),
      accelerator,
      ...(options.cudaVersion ? { cudaVersion: options.cudaVersion } : {}),
    },
    hostEnvironments: options.hostEnvironments ?? ['native'],
    ...(options.minNvidiaDriverVersion
      ? { minNvidiaDriverVersion: options.minNvidiaDriverVersion }
      : {}),
    ...(options.minRamGb ? { minRamGb: options.minRamGb } : {}),
  };
}

describe('Runtime Box native target selection', () => {
  it.each([
    {
      name: 'macOS arm64 Metal',
      hardware: hardware('macos', 'aarch64'),
      targets: [candidate('macos', 'metal')],
    },
    {
      name: 'Linux CPU',
      hardware: hardware('linux', 'x86_64'),
      targets: [candidate('linux', 'cpu')],
    },
    {
      name: 'Linux CUDA',
      hardware: hardware('linux', 'x86_64', '590.48.01'),
      targets: [
        candidate('linux', 'cuda', {
          cudaVersion: '12.4',
          minNvidiaDriverVersion: '550.54',
        }),
        candidate('linux', 'cpu'),
      ],
    },
    {
      name: 'Windows CPU',
      hardware: hardware('windows', 'x86_64'),
      targets: [candidate('windows', 'cpu')],
    },
    {
      name: 'Windows native CUDA',
      hardware: hardware('windows', 'x86_64', '590.48.01'),
      targets: [
        candidate('windows', 'cuda', {
          cudaVersion: '12.4',
          minNvidiaDriverVersion: '550.54',
        }),
        candidate('windows', 'cpu'),
      ],
    },
    {
      name: 'driver-too-old CPU fallback',
      hardware: hardware('windows', 'x86_64', '500.10'),
      targets: [
        candidate('windows', 'cuda', {
          cudaVersion: '12.4',
          minNvidiaDriverVersion: '550.54',
        }),
        candidate('windows', 'cpu'),
      ],
    },
  ])('accepts $name', ({ hardware: host, targets }) => {
    expect(modelInstallBlock(modelWithTargets(targets), host)).toBeNull();
  });

  it('explains an old driver when no CPU fallback is published', () => {
    const block = modelInstallBlock(
      modelWithTargets([
        candidate('windows', 'cuda', {
          cudaVersion: '12.4',
          minNvidiaDriverVersion: '550.54',
        }),
      ]),
      hardware('windows', 'x86_64', '500.10'),
    );
    expect(block?.kind).toBe('cuda');
    expect(block?.reason).toContain('550.54 or newer');
    expect(block?.detected).toContain('500.10');
  });

  it('reports memory and no-compatible-target errors in product language', () => {
    const lowMemory = hardware('linux', 'x86_64');
    lowMemory.totalMemoryBytes = 16 * 1024 ** 3;
    const memoryBlock = modelInstallBlock(
      modelWithTargets([candidate('linux', 'cpu', { minRamGb: 32 })]),
      lowMemory,
    );
    expect(memoryBlock?.kind).toBe('memory');
    expect(memoryBlock?.reason).toContain('at least 32 GB of memory');

    const platformBlock = modelInstallBlock(
      modelWithTargets([candidate('linux', 'cpu')]),
      hardware('windows', 'x86_64'),
    );
    expect(platformBlock?.kind).toBe('host-os');
    expect(platformBlock?.reason).toContain('Windows');
    expect(platformBlock?.reason).not.toContain('/');
  });

  it('uses an explicitly validated Linux CPU target through WSL2 on Windows', () => {
    const windows = hardware('windows', 'x86_64');
    windows.wsl2Available = true;
    windows.wslDistribution = 'Ubuntu-24.04';
    const block = modelInstallBlock(
      modelWithTargets([
        candidate('linux', 'cpu', {
          hostEnvironments: ['windows-wsl2'],
        }),
      ]),
      windows,
    );
    expect(block).toBeNull();
  });

  it('exposes both oncology Linux CPU boxes natively and through WSL2', () => {
    const linux = hardware('linux', 'x86_64');
    const windows = hardware('windows', 'x86_64');
    windows.wsl2Available = true;
    windows.wslDistribution = 'Ubuntu-24.04';

    expect(modelInstallBlock(MHCFLURRY_CLASS1_PRESENTATION_METADATA, linux)).toBeNull();
    expect(modelInstallBlock(MHCFLURRY_CLASS1_PRESENTATION_METADATA, windows)).toBeNull();
    expect(toolRuntimeInstallBlock(PVACTOOLS_TOOL_RUNTIME_METADATA, linux)).toBeNull();
    expect(toolRuntimeInstallBlock(PVACTOOLS_TOOL_RUNTIME_METADATA, windows)).toBeNull();
  });

  it('explains that WSL2 must be ready before a Windows install', () => {
    const windows = hardware('windows', 'x86_64');
    windows.wslError = 'No WSL2 distribution was found.';
    const block = modelInstallBlock(
      modelWithTargets([
        candidate('linux', 'cpu', { hostEnvironments: ['windows-wsl2'] }),
      ]),
      windows,
    );
    expect(block?.kind).toBe('runtime-target');
    expect(block?.summary).toContain('WSL2');
  });

  it('keeps every installable Runtime Box model tied to at least one published target', () => {
    const runtimeBoxModels = RUNTIME_BOX_AI_MODEL_REGISTRY.filter(
      (model) => model.install?.method === 'runtime-box',
    );
    expect(runtimeBoxModels.length).toBeGreaterThan(0);
    for (const model of runtimeBoxModels) {
      const targets = model.install?.runtimeBox?.publishedTargets;
      expect(targets?.length, model.id).toBeGreaterThan(0);
      expect(targets?.every((item) => item.hostEnvironments.length > 0), model.id).toBe(true);
    }
  });

  it('carries validated activation metadata from a Job into Result provenance', () => {
    const activation = {
      schemaVersion: 3,
      selectedTarget: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
      release: { kind: 'liatir.runtime-box.release' },
      signedRelease: { schemaVersion: 3 },
    } as unknown as LiatirRuntimeBoxActivationMetadata;
    const fromJob = runtimeBoxActivationFromMetadata({ runtimeBoxActivation: activation });
    expect(fromJob).toBe(activation);
    expect(runtimeBoxResultProvenance({
      ok: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      runtimeBoxActivation: fromJob,
    })).toEqual({ runtimeBoxActivation: activation });
  });

  it('does not treat schema-v1 activation metadata as runnable provenance', () => {
    expect(runtimeBoxActivationFromMetadata({
      runtimeBoxActivation: {
        schemaVersion: 1,
        selectedTarget: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
        release: { kind: 'liatir.runtime-box.release' },
      },
    })).toBeUndefined();
  });
});
