import { waitForLiatirBridge } from '../support/liatir-app.mjs';
import {
  installSecurityFixture,
  invokeOutcome,
  runSecurityFixtureVersion,
  SECURITY_BOX_ID,
  SECURITY_RUNTIME_ID,
  SECURITY_STATE_FILE,
  setSecurityRegistryState,
} from '../support/runtime-box-security.mjs';

const REQUIRED_ENV = [
  'LIATIR_RUNTIME_BOX_SECURITY_CONTROL_TOKEN',
  'LIATIR_RUNTIME_BOX_SECURITY_REGISTRY_URL',
  'LIATIR_RUNTIME_BOX_SECURITY_TARGET_JSON',
  'LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE',
];

async function expectRejectedInstall(browser, expect, expectedText, suffix) {
  const outcome = await installSecurityFixture(browser, `security-rejected-${suffix}-${Date.now()}`);
  expect(outcome.ok).toBe(false);
  expect(outcome.failure).toContain(expectedText);
}

export const tests = [{
  name: 'retains floors across restart and fails closed without disabling installed runtimes',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await waitForLiatirBridge(browser);

    // This is a new native app process using the same isolated app-data root as the install phase.
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    });

    await setSecurityRegistryState('a', 'b');
    await expectRejectedInstall(browser, expect, 'older than the newest document', 'old-channel');

    await setSecurityRegistryState('equivocal-b', 'b');
    await expectRejectedInstall(browser, expect, 'equivocal', 'equivocal-channel');

    await setSecurityRegistryState('b', 'a');
    await expectRejectedInstall(browser, expect, 'older than the newest document', 'old-revocations');

    await setSecurityRegistryState('b', 'equivocal-b');
    await expectRejectedInstall(browser, expect, 'equivocal', 'equivocal-revocations');

    await setSecurityRegistryState('b', 'missing');
    await expectRejectedInstall(browser, expect, 'disappeared', 'missing-revocations');

    await setSecurityRegistryState('b', 'b');
    const corrupted = await invokeOutcome(browser, 'lia_app_write_text', {
      rel: SECURITY_STATE_FILE,
      content: '{ damaged security state',
      createDirs: true,
    });
    expect(corrupted.ok).toBe(true);
    await expectRejectedInstall(browser, expect, 'security state is unreadable or corrupt', 'corrupt-update');

    // Runtime activation verifies its immutable signed release, not mutable install/update state.
    expect(await runSecurityFixtureVersion(browser)).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    });

    const removed = await invokeOutcome(browser, 'lia_ai_runtime_box_remove', {
      runtimeId: SECURITY_RUNTIME_ID,
      boxId: SECURITY_BOX_ID,
    });
    expect(removed).toEqual({ ok: true, value: true });
    await expectRejectedInstall(browser, expect, 'security state is unreadable or corrupt', 'corrupt-install');
  },
}];
