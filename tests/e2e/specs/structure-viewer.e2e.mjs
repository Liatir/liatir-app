/**
 * Native coverage for the 3D structure viewer.
 *
 * 3Dmol.js is third-party, downloaded on demand, and deliberately not bundled, so these tests do not
 * assert how it draws. They assert the part Liatir owns: that a missing runtime is offered for
 * install instead of failing, that the payload handed across the sandbox boundary is the structure
 * and style the user asked for, that a runtime which fails leaves the user looking at their own
 * coordinates, and that a runtime recorded as installed whose files are gone is reported as missing
 * rather than as a filesystem error.
 *
 * The stand-in runtime below is what makes that possible offline: it validates what it is given and
 * either reports success or throws, so both branches are reachable without a network download.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
  reloadLiatirApp,
} from '../support/liatir-app.mjs';

const RUN_ID = 'e2e-structure-viewer-result';
const RUNTIME_ID = 'viewer-3dmol-js';
const RUNTIME_REL_DIR = `viewer-runtimes/managed/${RUNTIME_ID}`;
const ENTRY_FILE = '3Dmol-min.js';

/** The first residues of ubiquitin (PDB 1UBQ), in real fixed-column PDB records. */
const PDB_FIXTURE = [
  'HEADER    TEST STRUCTURE                          17-SEP-26   TEST',
  'ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00  9.67           N',
  'ATOM      2  CA  MET A   1      26.266  25.413   2.842  1.00 10.38           C',
  'ATOM      3  C   MET A   1      26.913  26.639   3.531  1.00  9.62           C',
  'ATOM      4  O   MET A   1      27.886  26.463   4.263  1.00  9.62           O',
  'ATOM      5  CB  MET A   1      25.112  24.880   3.649  1.00 13.77           C',
  'ATOM      6  N   GLN A   2      26.335  27.770   3.258  1.00  9.27           N',
  'END',
].join('\n');
const PDB_ATOM_COUNT = 6;

/**
 * A stand-in for 3Dmol.js that passes only when it is driven correctly.
 *
 * Nothing outside the iframe can read what the library received — the frame has an opaque origin —
 * so the assertions live inside the stand-in itself: a wrong format, style or empty structure throws,
 * which the viewer reports as a runtime failure instead of a ready frame.
 */
const WORKING_STUB = `window.$3Dmol = {
  createViewer: function (element, options) {
    if (!element) throw new Error('stub: the viewer element was missing');
    if (!options || options.backgroundColor !== 'white') throw new Error('stub: unexpected viewer options');
    return {
      addModel: function (content, format) {
        if (format !== 'pdb') throw new Error('stub: unexpected format ' + format);
        if (content.indexOf('ATOM      1  N   MET A   1') === -1) throw new Error('stub: the structure did not reach the runtime');
      },
      setStyle: function (selector, style) {
        if (!style || !style.cartoon) throw new Error('stub: unexpected style ' + JSON.stringify(style));
      },
      zoomTo: function () {},
      render: function () {},
      resize: function () {}
    };
  }
};`;

const FAILING_STUB = `window.$3Dmol = {
  createViewer: function () { throw new Error('stub runtime failure'); }
};`;

async function writeAppJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_app_write_text', {
      rel: file,
      content: JSON.stringify(content, null, 2),
      createDirs: true,
    });
  }, rel, value);
}

async function writeRunJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_fs_write_text', {
      rel: file,
      contents: JSON.stringify(content, null, 2),
      permanent: true,
      createDirs: true,
    });
  }, rel, value);
}

/**
 * Puts a viewer runtime on disk exactly as a finished install leaves it: the entry file, the
 * aggregate state and the durable install marker. Passing `null` as the source records the same
 * install with no files behind it, which is the state a trashed runtime directory leaves.
 */
async function seedRuntime(browser, source) {
  return browser.execute(async (relDir, entryFile, runtimeId, script) => {
    // Written through the data scope, then read back for its absolute path: the marker records where
    // the install put the file, which is what the viewer later reads.
    const rel = `${relDir}/${entryFile}`;
    await window.Liatir.invoke('lia_fs_write_text', {
      rel,
      contents: script ?? '// removed after install',
      permanent: true,
      createDirs: true,
    });
    const entryPath = (await window.Liatir.invoke('lia_fs_stat', { rel, permanent: true })).path;
    const localPath = entryPath.slice(0, entryPath.length - entryFile.length - 1);
    if (script === null) {
      await window.Liatir.invoke('lia_managed_remove', { path: localPath, recursive: true });
    }
    const state = { status: 'installed', localPath, entryPath, updatedAt: Date.now() };
    await window.Liatir.invoke('lia_app_write_text', {
      rel: `viewer-runtime-installs/${runtimeId}.json`,
      content: JSON.stringify(state, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'viewer-runtimes.json',
      content: JSON.stringify({ runtimes: { [runtimeId]: state } }, null, 2),
      createDirs: true,
    });
    return entryPath;
  }, RUNTIME_REL_DIR, ENTRY_FILE, RUNTIME_ID, source);
}

/** Forgets every trace of the runtime, so the viewer meets a user who has never installed it. */
async function clearRuntime(browser) {
  await browser.execute(async (relDir, runtimeId) => {
    await window.Liatir.invoke('lia_fs_rm', { rel: relDir, permanent: true, recursive: true }).catch(() => {});
    await window.Liatir.invoke('lia_app_remove', { rel: `viewer-runtime-installs/${runtimeId}.json`, recursive: false }).catch(() => {});
    await window.Liatir.invoke('lia_app_remove', { rel: 'viewer-runtimes.json', recursive: false }).catch(() => {});
  }, RUNTIME_REL_DIR, RUNTIME_ID);
}

/** Seeds one finished run whose Result is a single structure section pointing at `structurePath`. */
async function seedStructureResult(browser, structurePath, overrides = {}) {
  await writeAppJson(browser, 'workspaces/__test__/analysis-runs/index.json', [{
    id: RUN_ID,
    tool: 'viewer-structure-3d',
    label: 'Structure viewer coverage',
    inputs: [structurePath],
    outputFiles: [],
    params: {},
    status: 'done',
    startedAt: Date.now() - 100,
    endedAt: Date.now(),
    durationMs: 100,
    error: null,
  }]);
  await writeRunJson(browser, `workspaces/__test__/runs/${RUN_ID}/result.json`, {
    sections: [{
      type: 'structure-viewer',
      label: 'Predicted structure',
      description: 'Structure viewer native coverage.',
      path: structurePath,
      format: 'pdb',
      style: 'cartoon',
      height: 360,
      ...overrides,
    }],
  });
}

async function openStructureResult(browser) {
  await reloadLiatirApp(browser);
  await openSandboxWorkspace(browser);
  await navigateInApp(browser, `/results?run=${RUN_ID}`);
}

/** Waits for the viewer to settle into one of the states it reports, and returns that state. */
async function waitForViewerState(browser, states, timeoutMsg) {
  let observed = null;
  await browser.waitUntil(async () => {
    observed = await browser.execute(() => (
      document.querySelector('[data-testid="structure-viewer"]')?.getAttribute('data-state') ?? null
    ));
    return states.includes(observed);
  }, { timeout: 30_000, timeoutMsg: `${timeoutMsg} (last state: ${observed})` });
  return observed;
}

function writeFixture(artifactsDir, name, contents) {
  const dir = path.join(artifactsDir, 'reports', 'structure-viewer-e2e');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

export const tests = [
  {
    name: 'offers the 3D runtime for install instead of failing when it is missing',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const structurePath = writeFixture(artifactsDir, 'structure.pdb', PDB_FIXTURE);
      await clearRuntime(browser);
      await seedStructureResult(browser, structurePath);
      await openStructureResult(browser);

      await waitForViewerState(browser, ['error'], 'The viewer never reported the missing runtime');
      const message = await (await browser.$('[data-testid="structure-viewer-error"]')).getText();
      expect(message).toContain('not installed');
      // The user is told what to do, and never shown the filesystem error underneath.
      expect(message).not.toContain('os error');
      expect(await (await browser.$('body')).getText()).toContain('Open Dependencies');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'hands the structure and style to the installed runtime, then goes fullscreen',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const structurePath = writeFixture(artifactsDir, 'structure.pdb', PDB_FIXTURE);
      await seedRuntime(browser, WORKING_STUB);
      await seedStructureResult(browser, structurePath);
      await openStructureResult(browser);

      // The stand-in only reports ready when it was given this file as `pdb` with a cartoon style.
      await waitForViewerState(browser, ['runtime-ready'], 'The installed runtime never reported a rendered structure');
      expect(await browser.execute(() => Boolean(document.querySelector('[data-testid="structure-viewer-frame"]')))).toBe(true);

      const expanded = () => browser.execute(() => (
        document.querySelector('[data-testid="visualization-shell"]')?.getAttribute('data-expanded') ?? null
      ));
      expect(await expanded()).toBe('false');
      await (await browser.$('[data-testid="viewer-fullscreen"]')).click();
      await browser.waitUntil(
        async () => (await expanded()) === 'true',
        { timeout: 10_000, timeoutMsg: 'The viewer did not expand to fullscreen' },
      );
      await (await browser.$('[data-testid="viewer-fullscreen"]')).click();
      await browser.waitUntil(
        async () => (await expanded()) === 'false',
        { timeout: 10_000, timeoutMsg: 'The viewer did not leave fullscreen' },
      );
      // Leaving fullscreen must give the page its scrolling back.
      expect(await browser.execute(() => document.body.style.overflow)).not.toBe('hidden');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'answers a screenshot request with a real PNG or the platform limit, never a silent success',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const structurePath = writeFixture(artifactsDir, 'structure.pdb', PDB_FIXTURE);
      await seedRuntime(browser, WORKING_STUB);
      await seedStructureResult(browser, structurePath);
      await openStructureResult(browser);
      await waitForViewerState(browser, ['runtime-ready'], 'The installed runtime never reported a rendered structure');

      // The capture button photographs the viewer's live rectangle through the OS; this is that call,
      // with the rectangle the component would pass.
      const capture = await browser.execute(async () => {
        const element = document.querySelector('[data-testid="structure-viewer"]');
        const rect = element.getBoundingClientRect();
        try {
          const result = await window.Liatir.invoke('lia_visual_capture_region', {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            filename: 'structure-viewer-e2e.png',
          });
          const size = await window.Liatir.invoke('lia_file_size', { path: result.path });
          return { ok: true, path: result.path, size };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      });

      if (process.platform === 'darwin') {
        expect(capture.ok).toBe(true);
        expect(capture.path.endsWith('structure-viewer-e2e.png')).toBe(true);
        expect(capture.size).toBeGreaterThan(0);
      } else {
        // Native region capture is macOS-only today. It must say so, not pretend to have saved a file.
        expect(capture.ok).toBe(false);
        expect(capture.message).toContain('macOS');
      }
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'draws the structure from its own coordinates when the runtime fails',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const structurePath = writeFixture(artifactsDir, 'structure.pdb', PDB_FIXTURE);
      await seedRuntime(browser, FAILING_STUB);
      await seedStructureResult(browser, structurePath);
      await openStructureResult(browser);

      await waitForViewerState(browser, ['fallback'], 'The viewer did not fall back to its own projection');
      expect(await browser.execute(() => (
        document.querySelectorAll('[data-testid="structure-fallback-atom"]').length
      ))).toBe(PDB_ATOM_COUNT);
      const warning = await (await browser.$('[data-testid="structure-viewer-runtime-warning"]')).getText();
      expect(warning).toContain('3Dmol.js runtime failed');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'treats a runtime recorded as installed whose files are gone as not installed',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const structurePath = writeFixture(artifactsDir, 'structure.pdb', PDB_FIXTURE);
      // The marker survives a trashed runtime directory, which is how this state occurs in the wild.
      await seedRuntime(browser, null);
      await seedStructureResult(browser, structurePath);
      await openStructureResult(browser);

      await waitForViewerState(browser, ['error'], 'The viewer never reported the emptied runtime');
      const message = await (await browser.$('[data-testid="structure-viewer-error"]')).getText();
      expect(message).toContain('not installed');
      expect(message).not.toContain('os error');

      // And Dependencies must offer the install again rather than keep claiming the runtime is there.
      await navigateInApp(browser, '/deps');
      const row = `[data-testid="viewer-runtime-row"][data-runtime-id="${RUNTIME_ID}"]`;
      await (await browser.$(row)).waitForDisplayed({ timeout: 20_000 });
      expect(await browser.execute((selector) => (
        document.querySelector(selector)?.getAttribute('data-status') ?? null
      ), row)).toBe('available');
      expect(await browser.execute((selector) => (
        Array.from(document.querySelectorAll(`${selector} button`), (button) => button.textContent.trim())
      ), row)).toContain('Install');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'names the mistake when the file is not a structure',
    async run({ browser, expect, artifactsDir }) {
      await openSandboxWorkspace(browser);
      const fastaPath = writeFixture(artifactsDir, 'not-a-structure.pdb', '>seq1\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG\n');
      await seedRuntime(browser, WORKING_STUB);
      await seedStructureResult(browser, fastaPath);
      await openStructureResult(browser);

      await waitForViewerState(browser, ['error'], 'The viewer accepted a file that is not a structure');
      expect(await (await browser.$('[data-testid="structure-viewer-error"]')).getText())
        .toContain('does not look like a PDB structure');
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
