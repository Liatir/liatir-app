/**
 * The Dependencies screen: detection, the diagnosis shown for a broken dependency, and the offered fix.
 *
 * Driven through the real app because the value of that screen is precisely what it *shows the user* when a tool
 * is missing or shadowed — which is not something a unit test can observe.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

export const tests = [
  {
    name: 'loads dependency checks through the real Tauri bridge',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/deps');

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
    /**
     * Replaced the managed-SeqKit install/execute/remove test on 2026-08-21. That
     * test downloaded a checksummed upstream release and ran it — but every
     * binary the managed registry could still offer is now inside the bundled
     * environment, so its Install button no longer exists and the path it proved
     * has no subject left on a platform that has a bundle.
     *
     * What replaces it is the claim that actually needs proving: that a bare tool
     * name spawned through the shared Jobs backend runs the binary the
     * application shipped, and not whatever happens to be on the user's PATH.
     */
    name: 'runs a bundled Native Tool from inside the application, not from PATH',
    async run({ artifactsDir, browser, expect }) {
      await openSandboxWorkspace(browser);

      const environment = await browser.execute(
        async () => window.Liatir.invoke('lia_native_tools_environment', {}),
      );
      expect(environment.available).toBe(true);
      // Windows carries the same tools but reaches them through WSL2.
      expect(environment.execution).toBe(process.platform === 'win32' ? 'wsl2' : 'native');
      expect(environment.tools).toContain('seqkit');
      const shipped = environment.manifest.tools.find((tool) => tool.id === 'seqkit');

      const probe = await browser.execute(async () => {
        const { jobId } = await window.Liatir.invoke('lia_jobs_spawn', {
          cmd: 'seqkit',
          args: ['version'],
          workspaceId: '__test__',
          label: 'Bundled SeqKit verification',
          kind: 'dependency-verification',
        });
        return { jobId };
      });

      await browser.waitUntil(
        async () => browser.execute(async (jobId) => {
          const job = await window.Liatir.invoke('lia_jobs_status', { jobId });
          return job.status?.type === 'done';
        }, probe.jobId),
        { timeout: 30_000, timeoutMsg: 'Bundled SeqKit did not execute' },
      );
      const output = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId }),
        probe.jobId,
      );
      // The version that ran is the version the build recorded. A host SeqKit at
      // a different version would fail here, which is the point.
      expect(output.stdout.join('\n')).toContain(`v${shipped.version}`);

      // A real input under a directory whose name contains a space. On Windows this
      // is the whole reason the crossing sends paths over stdin and reads them with
      // `IFS= read -r` instead of putting them on a command line, and no test had
      // ever actually carried one: a space that survives Windows argument parsing,
      // `wslpath`, and the tool's own argv is what a user named "Nome Cognome" is.
      // Elsewhere it costs one extra job and still proves the tool opens the file.
      const spacedDirectory = path.join(artifactsDir, 'bundled-tool-path', 'Nome Cognome');
      fs.mkdirSync(spacedDirectory, { recursive: true });
      const spacedInput = path.join(spacedDirectory, 'reads.fastq');
      const sequence = 'ACGT'.repeat(30);
      fs.writeFileSync(
        spacedInput,
        Array.from(
          { length: 40 },
          (_unused, index) => `@read${index}\n${sequence}\n+\n${'I'.repeat(sequence.length)}\n`,
        ).join(''),
      );

      const spaced = await browser.execute(async (input) => {
        const { jobId } = await window.Liatir.invoke('lia_jobs_spawn', {
          cmd: 'seqkit',
          args: ['stats', input],
          workspaceId: '__test__',
          label: 'Bundled SeqKit path handling',
          kind: 'dependency-verification',
        });
        return { jobId };
      }, spacedInput);
      await browser.waitUntil(
        async () => browser.execute(async (jobId) => {
          const job = await window.Liatir.invoke('lia_jobs_status', { jobId });
          return ['done', 'failed', 'killed'].includes(job.status?.type);
        }, spaced.jobId),
        { timeout: 30_000, timeoutMsg: 'Bundled SeqKit never settled on a spaced path' },
      );
      const spacedJob = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_status', { jobId }),
        spaced.jobId,
      );
      const spacedOutput = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId }),
        spaced.jobId,
      );
      // Reading the file is the assertion: 40 records means the whole path arrived,
      // not a prefix cut at the space.
      expect(spacedJob.status).toEqual({ type: 'done', exitCode: 0 });
      expect(spacedOutput.stdout.join('\n')).toMatch(/\breads\.fastq\b[\s\S]*\b40\b/);
      // The Job keeps the path the user gave, whatever the backend had to do with it.
      expect(spacedJob.args.at(-1)).toBe(spacedInput);

      // A network location has no Linux equivalent, so `wslpath` cannot map it and
      // WSL2 cannot reach it. It must be refused here, with something the user can
      // act on — forwarding it produces the tool's own
      // `stat \\server\share\...: no such file or directory`, which is true and
      // useless. The refusal happens before any Job exists, so this is a rejected
      // invoke rather than a failed Job.
      if (process.platform === 'win32') {
        const networkPath = String.raw`\\liatir-no-such-host\share\reads.fastq`;
        const refusal = await browser.execute(async (input) => {
          try {
            await window.Liatir.invoke('lia_jobs_spawn', {
              cmd: 'seqkit',
              args: ['stats', input],
              workspaceId: '__test__',
              label: 'Bundled SeqKit network path',
              kind: 'dependency-verification',
            });
            return null;
          } catch (error) {
            return String(error?.message ?? error);
          }
        }, networkPath);
        expect(refusal).toContain('network location');
        expect(refusal).toContain('Copy the file to a drive on this computer');
        expect(refusal).toContain(networkPath);
      }

      // And the Dependencies screen must say so, rather than reporting a tool
      // that works as one the user still has to install.
      await navigateInApp(browser, '/deps');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Included with Liatir')),
        { timeout: 30_000, timeoutMsg: 'Dependencies did not report a bundled tool' },
      );
      const hasInstallButton = await browser.execute(
        () => Boolean(document.querySelector('[data-testid="managed-install-seqkit"]')),
      );
      expect(hasInstallButton).toBe(false);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
