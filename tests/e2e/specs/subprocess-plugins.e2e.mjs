import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { npmInvocation } from '../../../scripts/node-cli.mjs';
import { waitForLiatirBridge, openSandboxWorkspace, reloadLiatirApp, navigateSidebar } from '../support/liatir-app.mjs';

function fixture(rootDir, artifactsDir, runtime) {
  const project = path.join(artifactsDir, 'subprocess-plugins', runtime);
  if (fs.existsSync(project)) fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(project), { recursive: true });
  const cli = path.join(rootDir, 'packages/liatir-cli/dist/cli.js');
  execFileSync('node', [cli, 'init', project, `--${runtime}`, '--yes'], { stdio: 'pipe' });
  const file = runtime === 'r' ? 'main.R' : 'main.rs';
  const code = runtime === 'r' ? `source("liatir.R")
plugin <- define_plugin(inputs=list(file=field$file(required=TRUE), sleep=field$number(default=0), fail=field$boolean(default=FALSE)),
 outputs=list(file=field$file(ext=list("txt")), length=field$number()))
plugin$main(function(ctx) {
 if (!inherits(try(ctx$liatir$invoke("lia_liatir_native_trust", list(path="untrusted")), silent=TRUE), "try-error")) stop("Plugin granted executable trust")
 if (Sys.getenv("LIATIR_RUN_SCOPE") == "plugin-dev" && !inherits(try(ctx$liatir$invoke("lia_app_exit"), silent=TRUE), "try-error")) stop("Dev scope escaped")
 ctx$liatir$log$info("R bridge connected"); ctx$liatir$progress$start(1)
 ctx$liatir$deps$check("node"); ctx$liatir$deps$check_many(c("node")); ctx$liatir$desktop$app$info(); ctx$liatir$invoke("lia_fs_paths")
 ctx$liatir$desktop$fs$cache$write_text("r-check.txt", "R")
 ctx$liatir$desktop$fs$plugin_fs("r-check")$write_text("scoped.txt", "R")
 if (ctx$input$fail) stop("requested failure")
 if (ctx$input$sleep > 0) Sys.sleep(ctx$input$sleep)
 text <- paste(readLines(ctx$input$file, warn=FALSE), collapse="\\n")
 ctx$liatir$progress$done()
 list(file=list(content=paste0(text,"R"),fileName="r.txt"),length=nchar(text)+1)
})` : `mod liatir;
use liatir::{define_plugin,field}; use serde_json::json;
fn main() { define_plugin().input("file",field::file().required(true)).input("sleep",field::number().default_value(0))
.input("fail",field::boolean().default_value(false)).output("file",field::file().ext(&["txt"]))
.output("length",field::number()).main(|ctx| {
 if ctx.liatir.invoke("lia_liatir_native_trust",json!({"path":"untrusted"})).is_ok() {return Err("Plugin granted executable trust".into());}
 if std::env::var("LIATIR_RUN_SCOPE").ok().as_deref()==Some("plugin-dev") && ctx.liatir.invoke("lia_app_exit",json!({})).is_ok() {return Err("Dev scope escaped".into());}
 ctx.liatir.log().info("Native bridge connected",json!(null))?; ctx.liatir.progress().start(1,None)?;
 ctx.liatir.deps().check("node")?; ctx.liatir.deps().check_many(&["node"])?; ctx.liatir.desktop().app().info()?; ctx.liatir.invoke("lia_fs_paths",json!({}))?;
 ctx.liatir.desktop().fs().cache().write_text("native-check.txt","Native",true,false)?;
 ctx.liatir.desktop().fs().plugin_fs("native-check")?.write_text("scoped.txt","Native",true,false)?;
 if ctx.bool("fail")? { return Err("requested failure".into()); }
 std::thread::sleep(std::time::Duration::from_secs_f64(ctx.f64("sleep")?));
 let text=std::fs::read_to_string(ctx.path("file")?)?; ctx.liatir.progress().done()?;
 Ok(json!({"file":{"content":format!("{text}Native"),"fileName":"native.txt"},"length":text.chars().count()+6}))
}); }`;
  fs.writeFileSync(path.join(project, 'src', file), code);
  if (runtime === 'r' && process.env.LIATIR_TEST_R_LIBRARY) {
    fs.mkdirSync(path.join(project, '.liatir'), { recursive: true });
    fs.cpSync(process.env.LIATIR_TEST_R_LIBRARY, path.join(project, '.liatir/r-build-library'), { recursive: true });
  }
  execFileSync('node', [cli, 'build'], { cwd: project, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 });
  return path.join(project, '.liatir', fs.readdirSync(path.join(project, '.liatir')).find(file => file.endsWith('.lia')));
}

async function settle(browser, jobId) {
  await browser.waitUntil(async () => (await browser.execute(id => window.Liatir.jobs.status(id), jobId)).status.type !== 'running', { timeout: 30_000 });
  return browser.execute(async id => ({ entry: await window.Liatir.jobs.status(id), output: await window.Liatir.invoke('lia_jobs_get_output', { jobId: id }) }), jobId);
}

export const tests = ['native', 'r'].map(runtime => ({
  name: `${runtime} Plugin import, trust/readiness, bridge, failure, cancellation and dev isolation`,
  ...(runtime === 'r' ? { requiredEnv: ['LIATIR_RSCRIPT'] } : {}),
  async run({ rootDir, artifactsDir, browser, expect }) {
    const npm = npmInvocation(['run', 'build', '--prefix', 'packages/liatir-cli']);
    execFileSync(npm.command, npm.args, { cwd: rootDir, stdio: 'pipe' });
    const bundle = fixture(rootDir, artifactsDir, runtime);
    const input = path.join(artifactsDir, 'subprocess-plugins/input.txt'); fs.writeFileSync(input, 'Node');
    await waitForLiatirBridge(browser); await openSandboxWorkspace(browser);
    const setup = await browser.execute(async (file, runtime) => {
      const manifest = await window.Liatir.invoke('lia_liatir_read_manifest', { path: file });
      const before = await window.Liatir.pluginRuntimes.status(file);
      let rejected = '';
      if (runtime === 'native') {
        try { await window.Liatir.invoke('lia_liatir_run', { path: file, inputs: {} }); } catch (error) { rejected = String(error); }
        await window.Liatir.pluginRuntimes.trustNative(file);
      } else await window.Liatir.pluginRuntimes.prepare(file);
      return { manifest, before, rejected, after: await window.Liatir.pluginRuntimes.status(file) };
    }, bundle, runtime);
    expect(setup.manifest.runtime).toBe(runtime); expect(setup.after.ready).toBe(true);
    if (runtime === 'native') { expect(setup.before.trusted).toBe(false); expect(setup.rejected).toContain('Allow'); }
    const spawned = await browser.execute((file, input) => window.Liatir.invoke('lia_liatir_run', {
      path: file, inputs: { file: input }, workspaceId: '__test__', metadata: { parentRunId: 'mixed-test' },
    }), bundle, input);
    const done = await settle(browser, spawned.jobId);
    if (done.entry.status.type !== 'done') throw new Error(JSON.stringify(done));
    expect(done.entry.status.type).toBe('done'); expect(done.entry.metadata.parentRunId).toBe('mixed-test');
    if (runtime === 'r') expect(done.entry.metadata.runtimeVersion).toBe(setup.after.version);
    else expect(done.entry.metadata.runtimeTarget).toBe(setup.after.target);
    const runDirectory = runtime === 'native' ? path.dirname(path.dirname(path.dirname(done.entry.cmd))) : path.dirname(done.entry.args[1]);
    await browser.waitUntil(() => !fs.existsSync(runDirectory), {timeout:5000, timeoutMsg:'Plugin run payload was not cleaned'});
    const marker = done.output.stdout.find(line => line.startsWith('__LIATIR_RESULT__'));
    expect(JSON.parse(marker.slice('__LIATIR_RESULT__'.length)).file.content).toBe(`Node${runtime === 'r' ? 'R' : 'Native'}`);
    const failed = await browser.execute((file, input) => window.Liatir.invoke('lia_liatir_run', { path: file, inputs: { file: input, fail: true } }), bundle, input);
    expect((await settle(browser, failed.jobId)).entry.status.type).toBe('failed');
    const slow = await browser.execute((file, input) => window.Liatir.invoke('lia_liatir_run', { path: file, inputs: { file: input, sleep: 30 } }), bundle, input);
    await browser.execute(id => window.Liatir.jobs.kill(id), slow.jobId);
    expect((await settle(browser, slow.jobId)).entry.status.type).toBe('killed');
    const sessionId = `e2e-${runtime}`;
    await browser.execute(async (sessionId, file) => {
      await window.Liatir.invoke('lia_plugin_dev_update_session', { sessionId, projectDir: '/test-project', bundlePath: file });
    }, sessionId, bundle);
    const dev = await browser.execute((sessionId, input) => window.Liatir.invoke('lia_plugin_dev_run', { sessionId, inputs: { file: input } }), sessionId, input);
    const devDone = await settle(browser, dev.jobId);
    if (devDone.entry.status.type !== 'done') throw new Error(JSON.stringify(devDone));
    expect(devDone.entry.kind).toBe('lia-plugin-dev'); expect(devDone.entry.metadata.pluginDevSessionId).toBe(sessionId);
    expect(devDone.entry.status.type).toBe('done');
    await browser.execute(sessionId => window.Liatir.invoke('lia_plugin_dev_end_session', { sessionId }), sessionId);
  },
}));

// Real file ports and the shared pipeline finalizer, with no runtime-specific wiring.
tests.push({
  name: 'Node -> R -> Native -> Python pipeline preserves file artifacts and run associations',
  requiredEnv: ['LIATIR_RSCRIPT'],
  async run({ rootDir, artifactsDir, browser, expect }) {
    const cli = path.join(rootDir, 'packages/liatir-cli/dist/cli.js');
    const rBundle = fixture(rootDir, artifactsDir, 'r');
    const nativeBundle = fixture(rootDir, artifactsDir, 'native');
    const projects = path.join(artifactsDir, 'subprocess-plugins');
    const node = path.join(projects, 'node'); fs.rmSync(node, { recursive: true, force: true }); fs.mkdirSync(path.join(node, 'src'), { recursive: true });
    fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify({ name: 'mixed-node', version: '1.0.0' }));
    fs.writeFileSync(path.join(node, 'src/index.js'), `export default {
      __liatirPlugin:true, inputs:{}, outputs:{file:{type:'file',ext:['txt']}},
      async run(){return {file:{content:'Node',fileName:'node.txt'}};}
    };`);
    execFileSync('node', [cli, 'build'], { cwd: node, stdio: 'pipe' });
    const python = path.join(projects, 'python');
    fs.rmSync(python, { recursive: true, force: true });
    execFileSync('node', [cli, 'init', python, '--python', '--yes'], { stdio: 'pipe' });
    const pyManifest = JSON.parse(fs.readFileSync(path.join(python, '.lia-manifest.json')));
    delete pyManifest.python.pythonRequirement;
    fs.writeFileSync(path.join(python, '.lia-manifest.json'), JSON.stringify(pyManifest));
    fs.writeFileSync(path.join(python, 'src/main.py'), `from liatir import define_plugin, field
from pathlib import Path
plugin=define_plugin(inputs={"file":field.file(required=True)},outputs={"file":field.file(ext=["txt"])})
@plugin.main
def main(ctx):
    text=Path(ctx.input["file"]).read_text(encoding="utf-8")
    return {"file":{"content":text+"Python","fileName":"python.txt"}}
`);
    execFileSync('node', [cli, 'build'], { cwd: python, stdio: 'pipe' });
    const paths = [path.join(node, '.liatir/mixed-node.lia'), rBundle, nativeBundle, path.join(python, '.liatir/python.lia')];
    await waitForLiatirBridge(browser); await openSandboxWorkspace(browser);
    await browser.execute(async paths => {
      const plugins = [];
      for (const [index, file] of paths.entries()) {
        const manifest = await window.Liatir.invoke('lia_liatir_read_manifest', { path: file });
        if (manifest.runtime === 'native') await window.Liatir.pluginRuntimes.trustNative(file);
        if (manifest.runtime === 'r') await window.Liatir.pluginRuntimes.prepare(file);
        plugins.push({ ...manifest, id: 'mixed-'+index, path: file, category: 'Testing', tags: [], addedAt: Date.now() });
      }
      const nodes = plugins.map((plugin,index) => ({ id:'step-'+index, type:'tool', position:{x:index*250,y:100},
        data:{stepId:'plugin:'+plugin.id,label:plugin.name,inputs:index ? {file:'@pipe:step-'+(index-1)+':file'} : {}} }));
      const edges = nodes.slice(1).map((node,index) => ({id:'edge-'+index,source:'step-'+index,target:node.id,sourceHandle:'file',targetHandle:'file'}));
      const pipeline = { id:'mixed-runtime',name:'Mixed runtime files',nodes,edges,updatedAt:Date.now() };
      for (const [rel,value] of [['liatir-plugins.json',plugins],['pipeline-workspace.json',{current:pipeline,saved:[pipeline],runtime:[]}]]) {
        await window.Liatir.invoke('lia_app_write_text',{rel:'workspaces/__test__/'+rel,content:JSON.stringify(value),createDirs:true});
      }
    }, paths);
    await reloadLiatirApp(browser); await openSandboxWorkspace(browser); await navigateSidebar(browser, '/pipelines');
    await (await browser.$('[data-testid="pipeline-card"][data-pipeline-id="mixed-runtime"] [data-testid="pipeline-card-open"]')).click();
    await (await browser.$('[data-testid="pipeline-run-button"]')).waitForDisplayed({timeout:20000});
    await (await browser.$('[data-testid="pipeline-run-button"]')).click();
    const read = () => browser.execute(async () => JSON.parse(await window.Liatir.invoke('lia_app_read_text', {rel:'workspaces/__test__/pipeline-workspace.json'})));
    await browser.waitUntil(async () => {
      const state = await read();
      const runtime = state.runtime.find(item => item.key === 'mixed-runtime');
      if (runtime?.nodeStates?.some(([,node]) => node.status === 'error' || node.status === 'failed')) throw new Error(JSON.stringify(runtime));
      return runtime && !runtime.running && Object.fromEntries(runtime.nodeStates)['step-3']?.status === 'done';
    }, { timeout:120_000, timeoutMsg:'Mixed-runtime pipeline did not complete' }).catch(async error => { throw new Error(String(error)+' '+JSON.stringify(await read())); });
    const state = await read();
    const runtime = state.runtime.find(item => item.key === 'mixed-runtime');
    const nodes = Object.fromEntries(runtime.nodeStates);
    for (let index=0;index<4;index++) expect(nodes['step-'+index].status).toBe('done');
    const final = nodes['step-3'].outputFiles.find(file => file.fieldKey === 'file') ?? nodes['step-3'].outputFiles[0];
    const text = await browser.execute(path => window.Liatir.invoke('lia_read_file_text',{path}), final.path);
    expect(text).toBe('NodeRNativePython');
    const jobs = await browser.execute(() => window.Liatir.jobs.list());
    expect(jobs.filter(job => job.metadata?.pipelineRunId === runtime.runId).length).toBeGreaterThanOrEqual(4);
  },
});
