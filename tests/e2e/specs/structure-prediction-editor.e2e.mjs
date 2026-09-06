import path from 'node:path';
import { navigateInApp, openSandboxWorkspace, expectNoVisibleRuntimeError } from '../support/liatir-app.mjs';

async function saved(browser) {
  await browser.waitUntil(async () => browser.execute(() =>
    document.querySelector('[data-testid="structure-save-status"]')?.textContent === 'Saved on this computer'),
  { timeout: 10_000, timeoutMsg: 'Prediction draft was not saved' });
}

export const tests = [{
  name: 'preserves independent structure drafts, explicit accuracy consent and invalid advanced input across navigation',
  requiredEnv: ['LIATIR_STRUCTURE_EDITOR_E2E'],
  async run({ browser, expect, screenshotDir }) {
    await openSandboxWorkspace(browser);
    await navigateInApp(browser, '/tools/structure/prediction');
    const label = await browser.$('[data-testid="structure-draft-label"]');
    await label.waitForDisplayed({ timeout: 20_000 });
    await label.setValue('First molecule');
    await (await browser.$('[data-testid="complex-sequence"]')).setValue('MSTNPKPQR');
    expect(await (await browser.$('[data-testid="structure-input-errors"]')).getText()).toContain('explicitly select single-sequence');
    await (await browser.$('[data-testid="complex-single-sequence"]')).click();
    expect(await (await browser.$('[data-testid="structure-input-errors"]')).getText()).toContain('acknowledging');
    await (await browser.$('[data-testid="complex-accuracy-acceptance"]')).click();
    await (await browser.$('[data-testid="structure-input-valid"]')).waitForDisplayed({ timeout: 5000 });
    await saved(browser);
    const firstId = await browser.execute(() => document.querySelector('[data-testid="structure-prediction-draft"]').dataset.draftId);
    await browser.saveScreenshot(path.join(screenshotDir, 'structure-editor-simple.png'));

    await (await browser.$('[data-testid="structure-new-draft"]')).click();
    await (await browser.$('[data-testid="structure-draft-label"]')).setValue('Independent second molecule');
    const fresh = await browser.execute(() => ({
      sequence: document.querySelector('[data-testid="complex-sequence"]').value,
      consent: document.querySelector('[data-testid="complex-single-sequence"]').checked,
    }));
    expect(fresh).toEqual({ sequence: '', consent: false });
    await saved(browser);
    await (await browser.$(`[data-testid="structure-saved-draft"][data-draft-id="${firstId}"]`)).click();
    expect(await browser.execute(() => document.querySelector('[data-testid="complex-sequence"]').value)).toBe('MSTNPKPQR');
    expect(await browser.execute(() => document.querySelector('[data-testid="complex-accuracy-acceptance"]').checked)).toBe(true);
    await (await browser.$('[data-testid="complex-editor-mode"]')).click();
    const invalid = '{"unfinished":';
    await (await browser.$('[data-testid="complex-advanced-json"]')).setValue(invalid);
    await saved(browser);
    await navigateInApp(browser, '/jobs');
    await navigateInApp(browser, '/tools/structure/prediction');
    await (await browser.$('[data-testid="complex-advanced-json"]')).waitForDisplayed({ timeout: 20_000 });
    expect(await browser.execute(() => document.querySelector('[data-testid="complex-advanced-json"]').value)).toBe(invalid);
    expect(await browser.execute(() => document.querySelector('[data-testid="complex-advanced-json"]').getAttribute('aria-invalid'))).toBe('true');
    expect(await browser.execute(() => document.querySelectorAll('[data-testid="structure-saved-draft"]').length)).toBe(2);
    await browser.saveScreenshot(path.join(screenshotDir, 'structure-editor-invalid-restored.png'));

    // Affinity owns its own drafts and applies the shared one-protein/one-ligand rule from core
    // while the user types, before any chemistry toolkit exists to count ligand atoms.
    await navigateInApp(browser, '/tools/structure/affinity');
    await (await browser.$('[data-testid="structure-draft-label"]')).waitForDisplayed({ timeout: 20_000 });
    await (await browser.$('[data-testid="complex-copies"]')).setValue('2');
    expect(await (await browser.$('[data-testid="structure-input-errors"]')).getText())
      .toContain('one copy of the protein');
    // Binding probability and log10(IC50) must never read as one number.
    const affinityText = await browser.execute(() => document.body.innerText);
    expect(affinityText).toContain('Binding probability');
    expect(affinityText).toContain('Log10(IC50)');
    expect(affinityText).toContain('more than 56 raises a warning; more than 128 stops prediction');
    await browser.saveScreenshot(path.join(screenshotDir, 'structure-editor-affinity-shape.png'));
    await expectNoVisibleRuntimeError(browser);
  },
}];
