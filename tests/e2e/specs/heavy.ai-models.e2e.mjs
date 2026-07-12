/**
 * The heavy AI suite: installs real models and runs real inference.
 *
 * Deliberately gated behind `--include-heavy` — it downloads gigabytes and takes a long time, so it is never part
 * of a routine run. But it is the only thing that proves the *whole* chain works: a signed Runtime Box downloads,
 * verifies, self-tests, activates, and then produces a usable result on this machine. Every other test mocks
 * something in that path.
 */
import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

const DEFAULT_HEAVY_MODEL_IDS = ['instadeep-nt-v2-50m-multi-species'];

function heavyModelIds() {
  return (process.env.LIATIR_HEAVY_AI_MODELS ?? DEFAULT_HEAVY_MODEL_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function installTimeoutMs() {
  return Number(process.env.LIATIR_HEAVY_AI_INSTALL_TIMEOUT_MS ?? 2_700_000);
}

async function openAIModelsPage(browser) {
  await openSandboxWorkspace(browser);
  await navigateSidebar(browser, '/ai');
  const search = await browser.$('[data-testid="ai-models-search"]');
  await search.waitForDisplayed({ timeout: 20_000 });
  return search;
}

async function revealModelCard(browser, modelId) {
  const search = await browser.$('[data-testid="ai-models-search"]');
  await search.setValue(modelId);
  const selector = `[data-testid="ai-model-card"][data-model-id="${modelId}"]`;
  await browser.waitUntil(
    async () => browser.execute((cardSelector) => Boolean(document.querySelector(cardSelector)), selector),
    { timeout: 20_000, timeoutMsg: `AI Model card was not found for ${modelId}` },
  );
  return selector;
}

async function waitForModelActionState(browser, modelId) {
  const selector = await revealModelCard(browser, modelId);
  await browser.waitUntil(
    async () => browser.execute((cardSelector) => {
      const card = document.querySelector(cardSelector);
      if (!card) return false;
      const text = card.textContent?.toLowerCase() ?? '';
      return !text.includes('checking');
    }, selector),
    { timeout: 180_000, timeoutMsg: `AI Model action checks did not settle for ${modelId}` },
  );
  return browser.execute((cardSelector) => {
    const card = document.querySelector(cardSelector);
    return {
      canFixDependency: Boolean(card?.querySelector('[data-testid="ai-model-fix-dependency-button"]')),
      canInstall: Boolean(card?.querySelector('[data-testid="ai-model-install-button"]')),
      canRun: Boolean(card?.querySelector('[data-testid="ai-model-run-button"]')),
      statusText: card?.textContent ?? '',
    };
  }, selector);
}

export const tests = [
  {
    name: 'checks selected heavy AI Models without installing by default',
    heavy: true,
    async run({ browser, expect }) {
      await openAIModelsPage(browser);

      for (const modelId of heavyModelIds()) {
        const state = await waitForModelActionState(browser, modelId);
        expect(state.canFixDependency || state.canInstall || state.canRun).toBe(true);
      }

      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'installs selected heavy AI Models when explicitly requested',
    heavy: true,
    requiredEnv: ['LIATIR_HEAVY_AI_INSTALL'],
    async run({ browser, expect }) {
      if (process.env.LIATIR_HEAVY_AI_INSTALL !== '1') {
        throw new Error('Set LIATIR_HEAVY_AI_INSTALL=1 to run heavy AI installation checks.');
      }

      await openAIModelsPage(browser);

      for (const modelId of heavyModelIds()) {
        const initialState = await waitForModelActionState(browser, modelId);
        if (initialState.canRun) continue;
        if (initialState.canFixDependency) {
          throw new Error(`AI Model ${modelId} is blocked by a dependency check: ${initialState.statusText}`);
        }
        expect(initialState.canInstall).toBe(true);

        const selector = `[data-testid="ai-model-card"][data-model-id="${modelId}"]`;
        await browser.execute((cardSelector) => {
          document.querySelector(cardSelector)?.querySelector('[data-testid="ai-model-install-button"]')?.click();
        }, selector);

        await browser.waitUntil(
          async () => browser.execute((cardSelector) => {
            const card = document.querySelector(cardSelector);
            if (!card) return false;
            const text = card.textContent?.toLowerCase() ?? '';
            return Boolean(card.querySelector('[data-testid="ai-model-run-button"]')) || text.includes('installed');
          }, selector),
          {
            timeout: installTimeoutMs(),
            timeoutMsg: `AI Model ${modelId} did not finish installing before timeout`,
          },
        );
      }

      await expectNoVisibleRuntimeError(browser);
    },
  },
];
