/** Proves that the non-distributable release build exposes exactly its checked candidate. */
import { navigateInApp, openSandboxWorkspace } from '../support/liatir-app.mjs';

const REQUIRED_ENV = ['LIATIR_RUNTIME_BOX_RELEASE_CANDIDATE_ID'];

export const tests = [{
  name: 'exposes the checked release candidate without changing the product catalog',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await openSandboxWorkspace(browser);
    const candidateId = process.env.LIATIR_RUNTIME_BOX_RELEASE_CANDIDATE_ID;
    const route = ['openvax-mhcflurry-class1-presentation', 'bowang-scgpt-whole-human', 'ctheodoris-geneformer-v1-10m', 'snap-stanford-uce-4layer'].includes(candidateId)
      ? `/ai/${candidateId}`
      : candidateId === 'griffithlab-pvactools-pvacseq'
        ? '/tools/oncology/neoantigen-prioritization'
        : candidateId === 'openmm-openmm'
          ? '/tools/molecular-simulation/relaxation'
        : ['jwohlwend-boltz-2', 'bytedance-protenix-base-v1-0-0', 'bytedance-protenix-v2', 'bytedance-protenix-mini-default-v0-5-0'].includes(candidateId)
          ? '/tools/structure/prediction'
        : null;
    if (!route) throw new Error(`Unsupported Runtime Box release candidate: ${candidateId}`);

    await navigateInApp(browser, route);
    let state = { installRequired: false, notPublished: false };
    await browser.waitUntil(async () => {
      state = await browser.execute(() => ({
        installRequired: document.body.textContent?.includes('Install required') ?? false,
        notPublished: document.body.textContent?.includes('Runtime not published') ?? false,
      }));
      return state.installRequired || state.notPublished;
    }, { timeout: 20_000, timeoutMsg: 'Release candidate page did not settle' });

    expect(state.notPublished).toBe(false);
    expect(state.installRequired).toBe(true);
  },
}];
