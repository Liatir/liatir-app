import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

export const tests = [
  {
    name: 'loads dependency checks through the real Tauri bridge',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/deps');

      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Dependencies')),
        { timeout: 20_000, timeoutMsg: 'Dependencies page did not load' },
      );
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.toLowerCase().includes('python')),
        { timeout: 60_000, timeoutMsg: 'Python dependency result did not appear' },
      );

      const state = await browser.execute(() => ({
        text: document.body.innerText,
        hasLiatir: Boolean(window.Liatir?.isAvailable),
      }));

      expect(state.hasLiatir).toBe(true);
      expect(state.text).toContain('python');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'installs, executes, and removes the checksummed managed SeqKit release',
    heavy: true,
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/deps');

      const installButton = await browser.$('[data-testid="managed-install-seqkit"]');
      await installButton.waitForDisplayed({ timeout: 60_000 });
      await installButton.click();

      await browser.waitUntil(
        async () => browser.execute(async () => {
          try {
            const raw = await window.Liatir.invoke('lia_fs_read_text', {
              rel: 'managed-bins/index.json',
              permanent: true,
              windowLabel: null,
              pluginStoragePlugin: null,
            });
            return Boolean(JSON.parse(raw).bins?.seqkit?.path);
          } catch {
            return false;
          }
        }),
        { timeout: 120_000, timeoutMsg: 'Managed SeqKit install did not persist' },
      );

      const installed = await browser.execute(async () => {
        const raw = await window.Liatir.invoke('lia_fs_read_text', {
          rel: 'managed-bins/index.json',
          permanent: true,
          windowLabel: null,
          pluginStoragePlugin: null,
        });
        const record = JSON.parse(raw).bins.seqkit;
        const { jobId } = await window.Liatir.invoke('lia_jobs_spawn', {
          cmd: 'seqkit',
          args: ['version'],
          workspaceId: '__test__',
          label: 'Managed SeqKit verification',
          kind: 'dependency-verification',
        });
        return { record, jobId };
      });
      expect(installed.record.version).toBe('2.13.0');

      await browser.waitUntil(
        async () => browser.execute(async (jobId) => {
          const job = await window.Liatir.invoke('lia_jobs_status', { jobId });
          return job.status?.type === 'done';
        }, installed.jobId),
        { timeout: 30_000, timeoutMsg: 'Managed SeqKit did not execute' },
      );
      const output = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId }),
        installed.jobId,
      );
      expect(output.stdout.join('\n')).toContain('seqkit v2.13.0');

      await browser.execute(async (record) => {
        await window.Liatir.invoke('lia_managed_remove', {
          path: record.path,
          recursive: false,
        });
        await window.Liatir.invoke('lia_fs_write_text', {
          rel: 'managed-bins/index.json',
          permanent: true,
          contents: JSON.stringify({ bins: {} }, null, 2),
          createDirs: true,
          append: false,
          windowLabel: null,
          pluginStoragePlugin: null,
        });
      }, installed.record);

      const removed = await browser.execute(async (path) => {
        try {
          await window.Liatir.invoke('lia_file_size', { path });
          return false;
        } catch {
          return true;
        }
      }, installed.record.path);
      expect(removed).toBe(true);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
