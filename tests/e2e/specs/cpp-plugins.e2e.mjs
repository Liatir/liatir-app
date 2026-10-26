import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { waitForLiatirBridge, openSandboxWorkspace, reloadLiatirApp, navigateSidebar } from '../support/liatir-app.mjs';

function fixture(rootDir, artifactsDir, runtime) {
  const project = path.join(artifactsDir, 'cpp-plugins', runtime);
  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(project), { recursive: true });
  const cli = path.join(rootDir, 'packages/liatir-cli/dist/cli.js');
  execFileSync('node', [cli, 'init', project, `--${runtime}`, '--cpp', '--yes'], { stdio: 'pipe' });
  fs.writeFileSync(path.join(project, 'src/main.cpp'), `#include "liatir.hpp"
int main() { return liatir::define_plugin()
 .input("file",liatir::field::file().required(true))
 .input("fail",liatir::field::boolean().default_value(false))
 .output("file",liatir::field::file().ext({"txt"}))
 .main([](const liatir::Context& ctx) {
  if(ctx.boolean("fail")) liatir::fail("Requested C++ failure");
#ifndef __wasi__
  liatir::invoke("lia_plugin_log",{{"jobId",liatir::job_id()},{"level","info"},{"message","C++ SDK bridge"}});
  liatir::invoke("lia_plugin_progress",{{"jobId",liatir::job_id()},{"current",1},{"total",1},{"done",true}});
  liatir::invoke("lia_deps_check",{{"binary","node"}});
#endif
  std::ifstream file(ctx.path("file")); if(!file) liatir::fail("Cannot read input file");
  const std::string text{std::istreambuf_iterator<char>(file),std::istreambuf_iterator<char>()};
  return liatir::json{{"file",{{"content",text+"C++"},{"fileName","cpp.txt"}}}};
 }); }
`);
  execFileSync('node', [cli, 'build'], { cwd: project, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 });
  return path.join(project, '.liatir', fs.readdirSync(path.join(project, '.liatir')).find(name => name.endsWith('.lia')));
}

async function settle(browser, jobId) {
  await browser.waitUntil(async () => (await browser.execute(id => window.Liatir.jobs.status(id), jobId)).status.type !== 'running', { timeout: 30_000 });
  return browser.execute(async id => ({ entry: await window.Liatir.jobs.status(id), output: await window.Liatir.invoke('lia_jobs_get_output', { jobId: id }) }), jobId);
}

export const tests = [
  {
    name: 'Managed C++ Native SDK uses the app bridge, enforces the contract and keeps its Dev Runner owner',
    requiredEnv: ['LIATIR_CMAKE'],
    async run({ rootDir, artifactsDir, browser, expect }) {
      const bundle = fixture(rootDir, artifactsDir, 'native');
      const input = path.join(artifactsDir, 'cpp-plugins/input.txt'); fs.writeFileSync(input, 'Native');
      await waitForLiatirBridge(browser); await openSandboxWorkspace(browser);
      await browser.execute(file => window.Liatir.pluginRuntimes.trustNative(file), bundle);
      const run = async inputs => {
        const spawned = await browser.execute((file, inputs) => window.Liatir.invoke('lia_liatir_run', { path: file, inputs, workspaceId: '__test__', metadata: { parentRunId: 'cpp-sdk' } }), bundle, inputs);
        return settle(browser, spawned.jobId);
      };
      const done = await run({ file: input });
      expect(done.entry.status.type).toBe('done'); expect(done.entry.metadata.parentRunId).toBe('cpp-sdk');
      expect(done.output.stderr.join('\n')).toContain('C++ SDK bridge');
      const marker = done.output.stdout.find(line => line.startsWith('__LIATIR_RESULT__'));
      expect(JSON.parse(marker.slice('__LIATIR_RESULT__'.length)).file.content).toBe('NativeC++');
      expect((await run({ file: 123 })).entry.status.type).toBe('failed');
      expect((await run({ file: input, fail: true })).entry.status.type).toBe('failed');
      const sessionId = 'cpp-sdk-session';
      await browser.execute((sessionId, file) => window.Liatir.invoke('lia_plugin_dev_update_session', { sessionId, projectDir: '/cpp-project', bundlePath: file }), sessionId, bundle);
      const dev = await browser.execute((sessionId, file) => window.Liatir.invoke('lia_plugin_dev_run', { sessionId, inputs: { file } }), sessionId, input);
      const devDone = await settle(browser, dev.jobId);
      expect(devDone.entry.status.type).toBe('done'); expect(devDone.entry.metadata.pluginDevSessionId).toBe(sessionId);
      await browser.execute(sessionId => window.Liatir.invoke('lia_plugin_dev_end_session', { sessionId }), sessionId);
    },
  },
  {
    name: 'Managed C++ Native -> WASM pipeline preserves shared file outputs and Results associations',
    requiredEnv: ['LIATIR_CMAKE', 'WASI_SDK_PATH'],
    async run({ rootDir, artifactsDir, browser, expect }) {
      const paths = [fixture(rootDir, artifactsDir, 'native'), fixture(rootDir, artifactsDir, 'wasm')];
      const input = path.join(artifactsDir, 'cpp-plugins/pipeline-input-🧬.txt'); fs.writeFileSync(input, 'Pipeline');
      await waitForLiatirBridge(browser); await openSandboxWorkspace(browser);
      await browser.execute(async (paths, input) => {
        const plugins = [];
        for (const [index, file] of paths.entries()) {
          const manifest = await window.Liatir.invoke('lia_liatir_read_manifest', { path: file });
          if (manifest.runtime === 'native') await window.Liatir.pluginRuntimes.trustNative(file);
          plugins.push({ ...manifest, id: 'cpp-' + index, path: file, category: 'Testing', tags: [], addedAt: Date.now() });
        }
        const nodes = plugins.map((plugin, index) => ({ id: 'cpp-step-' + index, type: 'tool', position: { x: index * 250, y: 100 },
          data: { stepId: 'plugin:' + plugin.id, label: plugin.name, inputs: { file: index ? '@pipe:cpp-step-0:file' : input } } }));
        const pipeline = { id: 'cpp-sdk-pipeline', name: 'C++ Native and WASM', nodes,
          edges: [{ id: 'cpp-edge', source: 'cpp-step-0', target: 'cpp-step-1', sourceHandle: 'file', targetHandle: 'file' }], updatedAt: Date.now() };
        for (const [rel, value] of [['liatir-plugins.json', plugins], ['pipeline-workspace.json', { current: pipeline, saved: [pipeline], runtime: [] }]])
          await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/' + rel, content: JSON.stringify(value), createDirs: true });
      }, paths, input);
      await reloadLiatirApp(browser); await openSandboxWorkspace(browser); await navigateSidebar(browser, '/pipelines');
      await (await browser.$('[data-testid="pipeline-card"][data-pipeline-id="cpp-sdk-pipeline"] [data-testid="pipeline-card-open"]')).click();
      await (await browser.$('[data-testid="pipeline-run-button"]')).waitForDisplayed({ timeout: 20_000 });
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();
      const read = () => browser.execute(async () => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/pipeline-workspace.json' })));
      await browser.waitUntil(async () => {
        const state = await read(); const runtime = state.runtime.find(item => item.key === 'cpp-sdk-pipeline');
        if (runtime?.nodeStates?.some(([, node]) => node.status === 'error' || node.status === 'failed')) throw new Error(JSON.stringify(runtime));
        return runtime && !runtime.running && Object.fromEntries(runtime.nodeStates)['cpp-step-1']?.status === 'done';
      }, { timeout: 90_000 });
      const state = await read(); const runtime = state.runtime.find(item => item.key === 'cpp-sdk-pipeline');
      const final = Object.fromEntries(runtime.nodeStates)['cpp-step-1'].outputFiles.find(file => file.fieldKey === 'file');
      expect(await browser.execute(file => window.Liatir.invoke('lia_read_file_text', { path: file }), final.path)).toBe('PipelineC++C++');
      const jobs = await browser.execute(() => window.Liatir.jobs.list());
      expect(jobs.filter(job => job.metadata?.pipelineRunId === runtime.runId).length).toBeGreaterThanOrEqual(2);
    },
  },
];
