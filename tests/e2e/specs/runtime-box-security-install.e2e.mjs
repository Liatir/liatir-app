import { activateCleanSandbox } from '../support/runtime-box.mjs';
import {
  installSecurityFixture,
  installSecurityToolRuntimeFixture,
  invokeOutcome,
  runSecurityFixtureVersion,
  SECURITY_RUNTIME_ID,
  SECURITY_STATE_FILE,
  securityFixtureEnvironment,
  setSecurityRegistryState,
} from '../support/runtime-box-security.mjs';

const REQUIRED_ENV = [
  'LIATIR_RUNTIME_BOX_SECURITY_CONTROL_TOKEN',
  'LIATIR_RUNTIME_BOX_SECURITY_REGISTRY_URL',
  'LIATIR_RUNTIME_BOX_SECURITY_TARGET_JSON',
  'LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE',
];

export const tests = [{
  name: 'installs A, updates to B, persists global floors, and rolls back to A',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await activateCleanSandbox(browser);
    await setSecurityRegistryState('a', 'a');

    const installedA = await installSecurityFixture(browser, `security-a-${Date.now()}`);
    expect(installedA.ok).toBe(true);
    expect(installedA.value.version).toBe('1.0.0');
    expect(installedA.value.rollbackAvailable).toBe(false);
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    });

    // The same signed fixture can coexist in the independent Tool Runtime root. This proves the
    // generic surface without weakening the compatibility alias exercised above.
    const toolA = await installSecurityToolRuntimeFixture(browser, `security-tool-a-${Date.now()}`);
    expect(toolA).toMatchObject({
      ok: true,
      value: {
        componentKind: 'tool-runtime',
        componentId: 'security-fixture-model',
        version: '1.0.0',
      },
    });
    const toolStatusA = await invokeOutcome(browser, 'lia_runtime_box_status', {
      componentKind: 'tool-runtime',
      runtimeId: SECURITY_RUNTIME_ID,
      packages: [],
      update: null,
    });
    const aiStatusA = await invokeOutcome(browser, 'lia_runtime_box_status', {
      componentKind: 'ai-model',
      runtimeId: SECURITY_RUNTIME_ID,
      packages: [],
      update: null,
    });
    expect(toolStatusA).toMatchObject({ ok: true, value: { installed: true, componentKind: 'tool-runtime' } });
    expect(aiStatusA).toMatchObject({ ok: true, value: { installed: true, componentKind: 'ai-model' } });
    const toolRoot = process.platform === 'win32' ? 'tool' : 'tool-runtimes';
    const aiRoot = process.platform === 'win32' ? 'ai' : 'ai-runtimes';
    expect(toolStatusA.value.runtimeDir.replaceAll('\\', '/'))
      .toMatch(new RegExp(`/${toolRoot}/${SECURITY_RUNTIME_ID}$`));
    expect(aiStatusA.value.runtimeDir.replaceAll('\\', '/'))
      .toMatch(new RegExp(`/${aiRoot}/${SECURITY_RUNTIME_ID}$`));

    await setSecurityRegistryState('b', 'b');
    const toolUpdate = await invokeOutcome(browser, 'lia_runtime_box_status', {
      componentKind: 'tool-runtime',
      runtimeId: SECURITY_RUNTIME_ID,
      packages: [],
      update: {
        componentId: 'security-fixture-model',
        boxId: 'security-fixture-box',
        channel: 'beta',
        registryBaseUrl: securityFixtureEnvironment().registryBaseUrl,
        targetCandidates: [{ target: securityFixtureEnvironment().target, hostEnvironments: ['native'] }],
      },
    });
    expect(toolUpdate).toMatchObject({
      ok: true,
      value: {
        installed: true,
        update: {
          currentVersion: '1.0.0',
          availableVersion: '2.0.0',
          updateAvailable: true,
        },
      },
    });
    const toolB = await installSecurityToolRuntimeFixture(browser, `security-tool-b-${Date.now()}`);
    expect(toolB).toMatchObject({ ok: true, value: { version: '2.0.0', rollbackAvailable: true } });
    const toolRollback = await invokeOutcome(browser, 'lia_runtime_box_rollback', {
      componentKind: 'tool-runtime',
      runtimeId: SECURITY_RUNTIME_ID,
    });
    expect(toolRollback).toMatchObject({ ok: true, value: { restored: true, componentKind: 'tool-runtime' } });
    const removedTool = await invokeOutcome(browser, 'lia_runtime_box_remove', {
      componentKind: 'tool-runtime',
      runtimeId: SECURITY_RUNTIME_ID,
      boxId: 'security-fixture-box',
    });
    expect(removedTool).toEqual({ ok: true, value: true });
    const removedToolStatus = await invokeOutcome(browser, 'lia_runtime_box_status', {
      componentKind: 'tool-runtime',
      runtimeId: SECURITY_RUNTIME_ID,
      packages: [],
      update: null,
    });
    expect(removedToolStatus).toMatchObject({ ok: true, value: { installed: false } });
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    });

    await setSecurityRegistryState('b', 'b');
    const installedB = await installSecurityFixture(browser, `security-b-${Date.now()}`);
    expect(installedB.ok).toBe(true);
    expect(installedB.value.version).toBe('2.0.0');
    expect(installedB.value.rollbackAvailable).toBe(true);
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '2.0.0' },
    });

    const stateOutcome = await invokeOutcome(browser, 'lia_app_read_text', {
      rel: SECURITY_STATE_FILE,
    });
    expect(stateOutcome.ok).toBe(true);
    const state = JSON.parse(stateOutcome.value);
    expect(state.schemaVersion).toBe(1);
    expect(state.entries).toHaveLength(2);
    const channelFloor = state.entries.find((entry) => entry.identity.kind === 'channel');
    const revocationFloor = state.entries.find((entry) => entry.identity.kind === 'revocations');
    expect(channelFloor.identity.registryBaseUrl).toBe(securityFixtureEnvironment().registryBaseUrl);
    expect(channelFloor.updatedAt).toBe('2026-08-11T10:00:00.000Z');
    expect(revocationFloor.identity.registryBaseUrl).toBe(securityFixtureEnvironment().registryBaseUrl);
    expect(revocationFloor.updatedAt).toBe('2026-08-11T11:00:00.000Z');

    const rollback = await invokeOutcome(browser, 'lia_ai_runtime_box_rollback', {
      runtimeId: SECURITY_RUNTIME_ID,
    });
    expect(rollback).toMatchObject({ ok: true, value: { restored: true } });
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    });
  },
}];
