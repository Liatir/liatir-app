import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertRuntimeBoxNativeHost,
  assertRuntimeBoxPythonEntryPoint,
  fixtureUrl,
  runtimeBoxCondaSubdir,
  runtimeBoxPixiAccelerator,
  runtimeBoxTargetAdapter,
  runtimeBoxTargetAdapters,
  runtimeBoxTargetId,
  runtimeBoxTorchBackendArguments,
} from '../../src/contract/index.mjs';

const contract = JSON.parse(readFileSync(fixtureUrl('target-id-contract'), 'utf8'));

describe('target identity', () => {
  it('produces the exact identifier every golden case declares', () => {
    expect(contract.valid.length).toBeGreaterThan(0);
    for (const fixture of contract.valid) {
      expect(runtimeBoxTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
    }
  });

  it('rejects every unsupported target and invalid CUDA combination', () => {
    expect(contract.invalid.length).toBeGreaterThan(0);
    for (const fixture of contract.invalid) {
      expect(() => runtimeBoxTargetId(fixture.target), fixture.name).toThrow();
    }
  });

  it('rejects a target that is not an object at all', () => {
    for (const value of [null, undefined, 'macos-aarch64-metal', 42]) {
      expect(() => runtimeBoxTargetId(value)).toThrow(TypeError);
    }
  });
});

describe('target adapters', () => {
  it('covers every platform and architecture the identity rules accept', () => {
    const adapters = runtimeBoxTargetAdapters();
    const covered = new Set(adapters.map((adapter) => `${adapter.platform}/${adapter.arch}`));
    for (const fixture of contract.valid) {
      expect(covered, fixture.name).toContain(`${fixture.target.platform}/${fixture.target.arch}`);
      expect(() => runtimeBoxTargetAdapter(fixture.target)).not.toThrow();
    }
  });

  it('describes a payload layout consumers can rely on', () => {
    for (const adapter of runtimeBoxTargetAdapters()) {
      expect(adapter.python.payloadRoot, adapter.id).toBe('venv');
      expect(adapter.python.entryPoint, adapter.id).toMatch(/^venv\//);
      expect(adapter.archive.format, adapter.id).toBe('zip');
      // The scripts directory must sit inside the payload root, or an installed box cannot find it.
      expect(adapter.python.scriptsDirectory, adapter.id).toMatch(/^venv/);
    }
  });

  it('maps each target to its conda platform subdirectory', () => {
    expect(runtimeBoxCondaSubdir({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' })).toBe('osx-arm64');
    expect(runtimeBoxCondaSubdir({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' })).toBe('linux-64');
    expect(runtimeBoxCondaSubdir({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' })).toBe('win-64');
  });

  it('refuses a build on a host that is not the target it ships for', () => {
    const adapter = runtimeBoxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertRuntimeBoxNativeHost(adapter, { platform: 'linux', arch: 'x64' })).not.toThrow();
    expect(() => assertRuntimeBoxNativeHost(adapter, { platform: 'darwin', arch: 'arm64' })).toThrow(/must be built natively/);
  });

  it('refuses a recipe entry point that disagrees with the adapter layout', () => {
    const adapter = runtimeBoxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertRuntimeBoxPythonEntryPoint(adapter, 'venv/python.exe')).not.toThrow();
    expect(() => assertRuntimeBoxPythonEntryPoint(adapter, 'venv/bin/python')).toThrow(/entry point/);
  });
});

describe('accelerator selection', () => {
  it('binds the PyTorch backend to the target accelerator in both directions', () => {
    const cuda = { target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' }, torchBackend: 'cu129' };
    expect(runtimeBoxTorchBackendArguments(cuda)).toEqual(['--torch-backend', 'cu129']);
    const cpu = { target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' }, torchBackend: 'cpu' };
    expect(runtimeBoxTorchBackendArguments(cpu)).toEqual(['--torch-backend', 'cpu']);
    // A CPU target must never be able to declare a CUDA build, or the box would ship wheels it
    // cannot run and only fail on a user's machine.
    const mismatched = { target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' }, torchBackend: 'cu129' };
    expect(() => runtimeBoxTorchBackendArguments(mismatched)).toThrow(/does not match target accelerator/);
    expect(runtimeBoxTorchBackendArguments({ target: cpu.target })).toEqual([]);
  });

  it('describes the conda accelerator a recipe selects and rejects a versionless CUDA target', () => {
    expect(runtimeBoxPixiAccelerator({ target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' } }))
      .toEqual({ accelerator: 'metal', cudaVersion: null });
    expect(runtimeBoxPixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' } }))
      .toEqual({ accelerator: 'cuda', cudaVersion: '12.9' });
    expect(() => runtimeBoxPixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda' } }))
      .toThrow(/major.minor CUDA version/);
  });
});
