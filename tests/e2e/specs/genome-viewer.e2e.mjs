/**
 * Native coverage for the Genome Track Viewer with the real JBrowse 2 runtime.
 *
 * JBrowse runs in the sandboxed viewer frame, which has an opaque origin: no Web Storage and no
 * access to local files. These tests prove the whole path a user takes. The runtime is installed from
 * Dependencies, the viewer is opened on the bundled yeast demo files, and JBrowse must report every
 * track drawn. The BAM track also proves byte-range reads, which is how JBrowse reads an indexed
 * file, and that the app indexes a BAM that arrives without one.
 *
 * The install downloads the pinned JBrowse bundle, so these tests need the network.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

const RUNTIME_ID = 'viewer-jbrowse-2';
const DEMO_DIR = path.resolve(import.meta.dirname, '../../../src-tauri/resources/demo-files/Find mutations in a yeast genome');
const REFERENCE = 'yeast_reference_chrI.fasta';
const GENES = 'yeast_genes_chrI.gff3';

function fixtureDir(artifactsDir) {
  const dir = path.join(artifactsDir, 'reports', 'genome-viewer-e2e');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copies a demo file into the fixture folder, so the demo set is never touched. */
function demoFixture(dir, name) {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(DEMO_DIR, name), file);
  return file;
}

/**
 * A small SAM of perfect 100 bp reads tiling chromosome I from position 1,000. The reads are cut from
 * the reference itself, so every one aligns and the coverage track has a known shape.
 */
function readsSam(referencePath) {
  const sequence = fs.readFileSync(referencePath, 'utf8').split('\n').slice(1).join('').replace(/\s/g, '');
  const lines = ['@HD\tVN:1.6\tSO:unsorted', `@SQ\tSN:I\tLN:${sequence.length}`];
  for (let index = 0; index < 80; index += 1) {
    const position = 1000 + index * 150;
    lines.push([`read${index}`, 0, 'I', position, 60, '100M', '*', 0, 0, sequence.slice(position - 1, position + 99), '*'].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

/** Runs a bundled native tool through the app's own job system and waits for it to finish. */
async function runNativeTool(browser, cmd, args) {
  const jobId = await browser.execute(async (command, argv) => (
    (await window.Liatir.invoke('lia_jobs_spawn', {
      cmd: command,
      args: argv,
      workspaceId: '__test__',
      label: 'Genome viewer fixture',
      kind: 'dependency-verification',
    })).jobId
  ), cmd, args);
  let status = null;
  await browser.waitUntil(async () => {
    status = (await browser.execute((id) => window.Liatir.invoke('lia_jobs_status', { jobId: id }), jobId)).status;
    return status.type !== 'running';
  }, { timeout: 60_000, timeoutMsg: `${cmd} ${args.join(' ')} did not finish` });
  if (status.type !== 'done') throw new Error(`${cmd} ${args.join(' ')} ended as ${JSON.stringify(status)}`);
}

/** Installs JBrowse 2 from Dependencies exactly as a user does, unless it is already installed. */
async function installJBrowse(browser) {
  await navigateInApp(browser, '/deps');
  const row = `[data-testid="viewer-runtime-row"][data-runtime-id="${RUNTIME_ID}"]`;
  await (await browser.$(row)).waitForDisplayed({ timeout: 20_000 });
  const status = () => browser.execute((selector) => document.querySelector(selector)?.getAttribute('data-status') ?? null, row);
  if (await status() === 'installed') return;
  await browser.execute((selector) => {
    Array.from(document.querySelectorAll(`${selector} button`)).find((button) => button.textContent.trim() === 'Install')?.click();
  }, row);
  await browser.waitUntil(async () => (await status()) === 'installed', {
    timeout: 180_000,
    timeoutMsg: 'JBrowse 2 did not install from Dependencies',
  });
}

/** Opens the viewer on a track and waits for JBrowse to report every track drawn or failed. */
async function openGenomeViewer(browser, trackPath, referencePath) {
  await navigateInApp(browser, `/tools/visualization/genome?track=${encodeURIComponent(trackPath)}&reference=${encodeURIComponent(referencePath)}`);
  let state = null;
  await browser.waitUntil(async () => {
    ({ state } = await browser.execute(() => ({
      state: document.querySelector('[data-testid="genome-viewer"]')?.getAttribute('data-jbrowse') ?? null,
    })));
    return state === 'ready' || state === 'error';
  }, { timeout: 90_000, timeoutMsg: `JBrowse never reported its tracks (last state: ${state})` });
  const errors = await browser.execute(() => (
    Array.from(document.querySelectorAll('[data-testid="genome-viewer-track-errors"] li'), (item) => item.textContent.trim())
  ));
  return { state, errors };
}

export const tests = [
  {
    name: 'draws a GFF annotation track on the reference in JBrowse 2',
    async run({ browser, expect, artifactsDir, screenshotDir }) {
      await openSandboxWorkspace(browser);
      const dir = fixtureDir(artifactsDir);
      const reference = demoFixture(dir, REFERENCE);
      const genes = demoFixture(dir, GENES);
      await installJBrowse(browser);

      const result = await openGenomeViewer(browser, genes, reference);
      expect(result).toEqual({ state: 'ready', errors: [] });
      await browser.saveScreenshot(path.join(screenshotDir, 'genome-viewer-gff.png'));
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'indexes a BAM that has none and draws it from byte-range reads',
    async run({ browser, expect, artifactsDir, screenshotDir }) {
      await openSandboxWorkspace(browser);
      const dir = fixtureDir(artifactsDir);
      const reference = demoFixture(dir, REFERENCE);
      const sam = path.join(dir, 'reads.sam');
      const bam = path.join(dir, 'reads.bam');
      fs.writeFileSync(sam, readsSam(reference));
      fs.rmSync(`${bam}.bai`, { force: true });
      await runNativeTool(browser, 'samtools', ['sort', '-o', bam, sam]);
      await installJBrowse(browser);

      const result = await openGenomeViewer(browser, bam, reference);
      expect(result).toEqual({ state: 'ready', errors: [] });
      // The viewer created the index JBrowse needs, beside the BAM, where every genome browser looks.
      expect(fs.existsSync(`${bam}.bai`)).toBe(true);
      await browser.saveScreenshot(path.join(screenshotDir, 'genome-viewer-bam.png'));
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
