/** Helpers shared by the two-process Runtime Box security lifecycle proof. */

export const SECURITY_BOX_ID = 'security-fixture-box';
export const SECURITY_MODEL_ID = 'security-fixture-model';
export const SECURITY_RUNTIME_ID = 'security-fixture-runtime';
export const SECURITY_STATE_FILE = 'runtime-box-control-floors.json';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; run npm run runtime-box:test:security.`);
  return value;
}

export function securityFixtureEnvironment() {
  return {
    controlToken: requiredEnvironment('LIATIR_RUNTIME_BOX_SECURITY_CONTROL_TOKEN'),
    registryBaseUrl: requiredEnvironment('LIATIR_RUNTIME_BOX_SECURITY_REGISTRY_URL'),
    target: JSON.parse(requiredEnvironment('LIATIR_RUNTIME_BOX_SECURITY_TARGET_JSON')),
  };
}

export async function setSecurityRegistryState(channel, revocations) {
  const { controlToken, registryBaseUrl } = securityFixtureEnvironment();
  const controlUrl = new URL('/_security-fixture/control', registryBaseUrl);
  const response = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${controlToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ channel, revocations }),
  });
  if (!response.ok) throw new Error(`Security fixture registry control failed: ${response.status} ${await response.text()}`);
}

export async function invokeOutcome(browser, command, payload) {
  return browser.execute(async (input) => {
    try {
      return { ok: true, value: await window.Liatir.invoke(input.command, input.payload) };
    } catch (error) {
      // `error` is reserved by the W3C WebDriver response envelope; returning that key from the
      // page would make a successfully captured product rejection look like a harness failure.
      return { ok: false, failure: String(error?.message ?? error) };
    }
  }, { command, payload });
}

export async function installSecurityFixture(browser, downloadId) {
  const { registryBaseUrl, target } = securityFixtureEnvironment();
  return invokeOutcome(browser, 'lia_ai_runtime_box_install', {
    boxId: SECURITY_BOX_ID,
    modelId: SECURITY_MODEL_ID,
    channel: 'beta',
    registryBaseUrl,
    targetCandidates: [{ target, hostEnvironments: ['native'] }],
    downloadId,
  });
}

export async function runSecurityFixtureVersion(browser) {
  const outcome = await invokeOutcome(browser, 'lia_ai_python_run', {
    runtimeId: SECURITY_RUNTIME_ID,
    script: [
      'import json',
      'import os',
      'print(json.dumps({"version": os.environ.get("LIATIR_SECURITY_FIXTURE_VERSION")}))',
    ].join('\n'),
    args: [],
    inputJson: {},
    timeoutSeconds: 30,
  });
  if (!outcome.ok) return outcome;
  const result = outcome.value;
  if (!result.ok) return { ok: false, failure: result.stderr || `Python exited with ${result.exitCode}` };
  return { ok: true, value: JSON.parse(result.stdout.trim()) };
}
