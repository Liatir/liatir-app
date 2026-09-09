import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateHardwareResources } from '@liatir/core';
import { OPENMM_SCRIPT } from '../../frontend/src/lib/tools/molecular-simulation/python-scripts/openmm';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

function minimalPdb(x = '  11.104'): string {
  return [
    `ATOM      1  N   ALA A   1    ${x}  13.207  10.507  1.00 20.00           N`,
    'ATOM      2  CA  ALA A   1      12.560  13.207  10.507  1.00 20.00           C',
    'TER',
    'END',
    '',
  ].join('\n');
}

function dynamicsPayload(root: string): Record<string, unknown> {
  const structure = join(root, 'input.pdb');
  writeFileSync(structure, minimalPdb());
  return {
    action: 'preflight',
    mode: 'dynamics',
    inputStructure: structure,
    preparation: {
      addHydrogens: true,
      ph: 7.4,
      solvent: 'none',
    },
    dynamics: {
      preset: 'verification-10ps',
      temperatureKelvin: 300,
      saveIntervalPs: 1,
      seed: 17,
    },
  };
}

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', OPENMM_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
}

// The script runs inside the installed OpenMM box, and since the 2026-09-09 decision that box is
// only ever macOS, Linux, or Linux inside WSL2 — never native Windows. Exercising it against a
// Windows interpreter tests a configuration the product does not have, and fails for two reasons
// that say nothing about the script: `python -c` cannot carry 48 KB past Windows' 32,767-character
// command-line limit, and `socket.AF_UNIX`, which `deny_network()` uses to let local IPC through,
// does not exist on Windows. CI still runs this suite on both platforms the box targets.
describe.skipIf(process.platform === 'win32')('OpenMM product Python script', () => {
  it('runs the bounded standard-library preflight without importing OpenMM', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-preflight-'));
    const result = run(dynamicsPayload(root));
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      kind: 'liatir.openmm-preflight',
      mode: 'dynamics',
      workloadId: 'openmm:dynamics:none:standard',
      tokenCount: 1,
      atomCount: 10,
      inputAtomCount: 2,
      stepCount: 5000,
      ligandAtomCount: 0,
      outputItemCount: 10,
      inputBytes: Buffer.byteLength(minimalPdb()),
      networkAccess: false,
    });
  });

  it('rejects non-finite coordinates before the scientific stack can load', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-finite-'));
    const payload = dynamicsPayload(root);
    writeFileSync(payload.inputStructure as string, minimalPdb('     nan'));
    const result = run(payload);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PDB coordinate must be finite');
    expect(result.stderr).not.toContain('ModuleNotFoundError');
  });

  it('requires a retained measured envelope before importing OpenMM', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-envelope-'));
    const payload = {
      ...dynamicsPayload(root),
      action: 'run',
      outputDir: join(root, 'output'),
      runtimeBoxRelease: '8.5.1-beta.1',
      targetId: 'macos-aarch64-cpu',
      accelerator: 'cpu',
    };
    const result = run(payload);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('measured hardware preflight');
    expect(result.stderr).not.toContain('ModuleNotFoundError');
  });

  it('rejects a checkpoint from another release before importing OpenMM', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-checkpoint-'));
    const checkpointPath = join(root, 'resume.chk');
    const checkpointMetadataPath = join(root, 'resume.json');
    const checkpoint = Buffer.from('checkpoint-fixture');
    writeFileSync(checkpointPath, checkpoint);
    writeFileSync(checkpointMetadataPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'liatir.openmm-checkpoint',
      runtimeId: 'molecular-simulation-openmm-8-5-1',
      runtimeBoxRelease: '8.5.1-beta.0',
      targetId: 'macos-aarch64-cpu',
      forceFieldId: 'amber19-all+tip3p-fb+openff-2.3.0+nagl-am1bcc-1.0.0',
      checkpointSha256: createHash('sha256').update(checkpoint).digest('hex'),
    }));
    const payload = {
      ...dynamicsPayload(root),
      action: 'run',
      outputDir: join(root, 'output'),
      runtimeBoxRelease: '8.5.1-beta.1',
      targetId: 'macos-aarch64-cpu',
      accelerator: 'cpu',
      checkpointPath,
      checkpointMetadataPath,
      hardwareEstimate: {
        accepted: true,
        workloadId: 'openmm:dynamics:none:standard',
        tokenCount: 1,
        atomCount: 10,
        stepCount: 5000,
        outputItemCount: 10,
        evidenceRecord: 'runtime-boxes/measurements/openmm-macos-aarch64-cpu.json',
      },
    };
    const result = run(payload);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Checkpoint runtimeBoxRelease');
    expect(result.stderr).not.toContain('ModuleNotFoundError');
  });

  it('accepts the shared hardware result through the Python gate with all workload dimensions', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-accepted-'));
    const payload = dynamicsPayload(root);
    const preflight = run(payload);
    expect(preflight.status, preflight.stderr).toBe(0);
    const metrics = JSON.parse(preflight.stdout);
    const estimate = estimateHardwareResources(metrics, {
      schemaVersion: 1, profileId: 'contract-fixture', componentId: 'openmm-openmm',
      componentVersion: '8.5.1', runtimeBoxRelease: '8.5.1-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
      precision: 'mixed', measuredAt: '2026-09-05', evidenceRecord: 'test-fixture.json',
      samples: [{ fixtureId: 'contract-fixture', workloadId: metrics.workloadId, maxStepCount: 5000,
        maxTokenCount: 1, maxAtomCount: 10, maxOutputItemCount: 10, peakRamBytes: 1024,
        peakVramBytes: null, elapsedMs: 1, outputBytes: 1 }],
    });
    const result = run({ ...payload, action: 'run', hardwareEstimate: estimate,
      runtimeBoxRelease: '8.5.1-beta.1', targetId: 'macos-aarch64-cpu', accelerator: 'cpu',
      runtimePath: join(root, 'missing-runtime'), outputDir: join(root, 'output') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing its reviewed OpenMMForceFields source');
    expect(result.stderr).not.toContain('Hardware preflight');
  });

  it('includes preparation growth and simulation steps in the bounded preflight', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-workload-'));
    const payload = dynamicsPayload(root);
    const bare = JSON.parse(run(payload).stdout);
    const solvated = run({ ...payload, preparation: {
      addHydrogens: true, ph: 7.4, solvent: 'tip3p-fb', solventPaddingNm: 1, ionicStrengthM: 0.15,
    }});
    expect(solvated.status, solvated.stderr).toBe(0);
    expect(JSON.parse(solvated.stdout).atomCount).toBeGreaterThan(bare.atomCount);
    const longer = run({ ...payload, dynamics: {
      preset: 'short-100ps', temperatureKelvin: 300, saveIntervalPs: 10, seed: 17,
    }});
    expect(JSON.parse(longer.stdout)).toMatchObject({ stepCount: 50000, outputItemCount: 10 });
  });

  it.each([0, 2_147_483_648])('rejects the OpenMM automatic or overflowing seed %s', (seed) => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-seed-'));
    const payload = dynamicsPayload(root);
    const result = run({ ...payload, dynamics: { ...(payload.dynamics as object), seed } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OpenMM seed must be');
    expect(result.stderr).not.toContain('ModuleNotFoundError');
  });

  it('blocks DNS resolution and UDP as well as TCP connections', () => {
    const result = spawnSync(PYTHON, ['-c', [
      'import json, socket, sys',
      'scope = {"__name__": "offline_guard_test"}',
      'exec(json.load(sys.stdin)["script"], scope)',
      'scope["deny_network"]()',
      'attempts = [lambda: socket.getaddrinfo("example.com", 443),',
      '            lambda: socket.create_connection(("127.0.0.1", 9)),',
      '            lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("127.0.0.1", 9))]',
      'for attempt in attempts:',
      '    try:',
      '        attempt()',
      '    except RuntimeError as error:',
      '        assert "Network access is disabled" in str(error)',
      '    else:',
      '        raise AssertionError("Network attempt was not denied")',
      'print("blocked")',
    ].join('\n')], { encoding: 'utf8', input: JSON.stringify({ script: OPENMM_SCRIPT }) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('blocked');
  });

  it('pins the reviewed force fields, charge model and offline ordering', () => {
    expect(OPENMM_SCRIPT).toContain('OPENMM_VERSION = "8.5.1"');
    expect(OPENMM_SCRIPT).toContain('OPENMMFORCEFIELDS_VERSION = "0.16.0"');
    expect(OPENMM_SCRIPT).toContain('ForceField("amber19-all.xml", "amber19/tip3pfb.xml")');
    expect(OPENMM_SCRIPT).toContain('OPENFF_FORCE_FIELD = "openff-2.3.0"');
    expect(OPENMM_SCRIPT).toContain('NAGL_CHARGE_MODEL = "openff-gnn-am1bcc-1.0.0.pt"');
    expect(OPENMM_SCRIPT).toContain('7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee');
    expect(OPENMM_SCRIPT.indexOf('deny_network()')).toBeLessThan(OPENMM_SCRIPT.indexOf('prepared = prepare_system'));
    expect(OPENMM_SCRIPT.indexOf('require_measured_envelope(payload, metrics)'))
      .toBeLessThan(OPENMM_SCRIPT.indexOf('deny_network()'));
    expect(OPENMM_SCRIPT.indexOf('configure_runtime_source(payload)'))
      .toBeLessThan(OPENMM_SCRIPT.lastIndexOf('deny_network()'));
    expect(OPENMM_SCRIPT).not.toMatch(/https?:\/\//u);
  });
});
