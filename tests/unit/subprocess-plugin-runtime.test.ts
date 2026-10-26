import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile as exec } from 'node:child_process';
import { promisify } from 'node:util';
import { verify, createPublicKey, createHash } from 'node:crypto';
import { bundleSigningDigest, generateKeypair, writePrivateKey } from '../../packages/liatir-cli/src/signing';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { init } from '../../packages/liatir-cli/src/commands/init';
import { dev } from '../../packages/liatir-cli/src/commands/dev';
import { build, buildDevBundle } from '../../packages/liatir-cli/src/commands/build';
import { liatirNativeTarget, liatirPluginRuntime } from '@liatir/core';

const execFile = promisify(exec);
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const JSZip = require(resolve(root, 'packages/liatir-cli/node_modules/jszip'));
const temporary = mkdtempSync(join(tmpdir(), 'liatir-subprocess-'));
const nativeProject = join(temporary, 'native-plugin');
const rscript = process.env.LIATIR_RSCRIPT;
const rLibrary = process.env.LIATIR_TEST_R_LIBRARY;
const target = liatirNativeTarget(process.platform, process.arch);
let nativeBundle: any;
let nativeExecutable: string;

async function bundle(project: string): Promise<any> {
  const name = readdirSync(join(project, '.liatir')).find(file => file.endsWith('.lia'))!;
  return JSZip.loadAsync(readFileSync(join(project, '.liatir', name)));
}
async function inProject<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  try { process.chdir(project); return await fn(); }
  finally { process.chdir(previous); }
}

beforeAll(async () => {
  await init([nativeProject, '--native', '--yes']);
  await inProject(nativeProject, build);
  nativeBundle = await bundle(nativeProject);
  const manifest = JSON.parse(await nativeBundle.file('manifest.json').async('string'));
  nativeExecutable = join(nativeProject, 'target', 'release', process.platform === 'win32' ? 'native_plugin.exe' : 'native_plugin');
  expect(manifest.native.targets[target]).toBe(`native/${target}/${process.platform === 'win32' ? 'native_plugin.exe' : 'native_plugin'}`);
}, 60_000);

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe('first-class subprocess Plugins', () => {
  it('preserves legacy Node and explicitly rejects unknown runtimes on every host', () => {
    expect(liatirPluginRuntime(undefined)).toBe('node');
    for (const runtime of ['node', 'python', 'wasm', 'r', 'native']) expect(liatirPluginRuntime(runtime)).toBe(runtime);
    for (const value of [null, '', 'R', 'Native', 123]) expect(() => liatirPluginRuntime(value)).toThrow('Unsupported');
    expect(liatirNativeTarget('darwin', 'arm64')).toBe('macos-aarch64');
    expect(liatirNativeTarget('win32', 'x64')).toBe('windows-x86_64');
    expect(liatirNativeTarget('linux', 'x64')).toBe('linux-x86_64');
    expect(() => liatirNativeTarget('linux', 'riscv64')).toThrow('Unsupported');
  });

  it('builds a Native bundle from a code-declared contract and runs the actual Rust executable', async () => {
    const source = JSON.parse(readFileSync(join(nativeProject, '.lia-manifest.json'), 'utf8'));
    expect(source.inputSchema).toBeUndefined();
    const manifest = JSON.parse(await nativeBundle.file('manifest.json').async('string'));
    expect(manifest).toMatchObject({ runtime: 'native', inputSchema: { text: { type: 'string', default: 'hello from Liatir' } }, outputSchema: { length: { type: 'number' } } });
    expect(await nativeBundle.file('_sig').async('string')).toBe('LIATIR/1');
    const child = execFile(nativeExecutable, []);
    child.child.stdin?.end('{}');
    const { stdout } = await child;
    expect(stdout).toContain('__LIATIR_RESULT__{"length":17}');
    const input = join(temporary, 'input.json');
    writeFileSync(input, JSON.stringify({ text: 'hello 🧬' }));
    const result = await execFile(nativeExecutable, [], { env: { ...process.env, LIATIR_INPUT_FILE: input } });
    expect(result.stdout).toContain('"length":7');
    writeFileSync(input, '{"text":42}');
    await expect(execFile(nativeExecutable, [], { env: { ...process.env, LIATIR_INPUT_FILE: input } })).rejects.toThrow(/must be a string/);
  });

  it('rejects an unknown explicit runtime even when Cargo and package.json are present', async () => {
    const project = join(temporary, 'invalid-runtime'); mkdirSync(project);
    writeFileSync(join(project, '.lia-manifest.json'), '{"runtime":"nativ"}');
    writeFileSync(join(project, 'Cargo.toml'), ''); writeFileSync(join(project, 'package.json'), '{}');
    await expect(inProject(project, build)).rejects.toThrow('Unsupported Plugin runtime');
  });

  it('rejects malformed targets, path traversal and missing code contracts', async () => {
    const project = join(temporary, 'bad-native'); mkdirSync(project);
    for (const native of [{ protocol: 2 }, { protocol: 1, targets: {} }, { protocol: 1, targets: { 'linux-x86_64': '../escape' } }, { protocol: 1, targets: { bogus: 'x' } }]) {
      writeFileSync(join(project, '.lia-manifest.json'), JSON.stringify({ runtime: 'native', native }));
      await expect(inProject(project, build)).rejects.toThrow();
    }
  });

  it('signs Native executable payloads and detects byte tampering', async () => {
    const key = join(temporary, 'test-signing-key.pem');
    await writePrivateKey(key, generateKeypair().privateKeyPem);
    const previous = process.env.LIATIR_SIGNING_KEY;
    process.env.LIATIR_SIGNING_KEY = key;
    let packed: any;
    try { await inProject(nativeProject, build); packed = await bundle(nativeProject); }
    finally { if (previous === undefined) delete process.env.LIATIR_SIGNING_KEY; else process.env.LIATIR_SIGNING_KEY = previous; }
    const entries = await Promise.all(Object.keys(packed.files).filter(name => !packed.files[name].dir)
      .map(async name => ({ name, content: await packed.file(name).async('nodebuffer') })));
    const pub = Buffer.from(await packed.file('_pubkey').async('string'), 'base64');
    const signature = Buffer.from(await packed.file('_signature').async('string'), 'base64');
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
    expect(verify(null, bundleSigningDigest(entries), publicKey, signature)).toBe(true);
    const changed = entries.map(entry => entry.name.startsWith('native/') ? { ...entry, content: Buffer.from('tampered') } : entry);
    expect(verify(null, bundleSigningDigest(changed), publicKey, signature)).toBe(false);
  });

  it('packages multiple targets from identical generated contracts and rejects mismatches', async () => {
    const project = join(temporary, 'native-targets'); mkdirSync(project);
    const executableName = process.platform === 'win32' ? 'tool.exe' : 'tool';
    const executable = join(project, executableName); cpSync(nativeExecutable, executable);
    const crossName = process.platform === 'win32' ? 'cross-tool.exe' : 'cross-tool';
    const crossExecutable = join(project, crossName); cpSync(nativeExecutable, crossExecutable);
    const contractOutput = (await execFile(nativeExecutable, [], { env: { ...process.env, LIATIR_EMIT_CONTRACT: '1' } })).stdout;
    const contract = JSON.parse(contractOutput.trim().slice('__LIATIR_CONTRACT__'.length));
    const other = target === 'linux-x86_64' ? 'windows-x86_64' : 'linux-x86_64';
    const raw = { name: 'Multi target', version: '1.0.0', runtime: 'native', native: { protocol: 1, targets: { [target]: executableName, [other]: crossName } } };
    writeFileSync(join(project, '.lia-manifest.json'), JSON.stringify(raw));
    const executableSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
    writeFileSync(crossExecutable + '.contract.json', JSON.stringify({ executableSha256, contract }));
    await inProject(project, build);
    const packed = await bundle(project);
    const manifest = JSON.parse(await packed.file('manifest.json').async('string'));
    expect(Object.keys(manifest.native.targets).sort()).toEqual([target, other].sort());
    contract.outputs.extra = { type: 'boolean' };
    writeFileSync(crossExecutable + '.contract.json', JSON.stringify({ executableSha256, contract }));
    await expect(inProject(project, build)).rejects.toThrow('different I/O contracts');
    writeFileSync(crossExecutable + '.contract.json', JSON.stringify({ executableSha256: '0'.repeat(64), contract }));
    await expect(inProject(project, build)).rejects.toThrow('Stale Native contract metadata');
  });

  it('builds Native dev snapshots through the same packager', async () => {
    const built = await inProject(nativeProject, buildDevBundle);
    expect(built.runtime).toBe('native');
    expect(realpathSync(built.path)).toBe(realpathSync(join(nativeProject, '.lia-dev/current.lia')));
  });
});

async function openDev(project: string, ipc: string): Promise<void> {
  const previous = process.env.LIATIR_IPC_FILE;
  process.env.LIATIR_IPC_FILE = ipc;
  try { await inProject(project, () => dev([])); }
  finally { if (previous === undefined) delete process.env.LIATIR_IPC_FILE; else process.env.LIATIR_IPC_FILE = previous; }
}

it('Native CLI dev opens a temporary app-backed session', async () => {
  const calls = await fakeBridge(ipc => openDev(nativeProject, ipc));
  expect(calls.map(call => call.cmd)).toEqual(expect.arrayContaining([
    'lia_plugin_dev_update_session', 'lia_plugin_dev_open_session', 'lia_plugin_dev_get_session',
  ]));
}, 30_000);

// Full SDK calls exercise the real HTTP transport and payloads, not source snippets.
async function fakeBridge(run: (ipc: string) => Promise<void>): Promise<Array<{ cmd: string; payload: any }>> {
  const calls: Array<{ cmd: string; payload: any }> = [];
  const server = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe('Bearer test-secret');
    const buffers = []; for await (const chunk of request) buffers.push(chunk);
    const call = JSON.parse(Buffer.concat(buffers).toString()); calls.push(call);
    let result: unknown = {};
    if (call.cmd === 'lia_plugin_dev_get_session') result = null;
    if (call.cmd === 'lia_fs_stat') result = { path: '/plugin-storage' };
    if (call.cmd === 'lia_fs_paths') result = { data: '/data', cache: '/cache' };
    if (call.cmd === 'lia_jobs_list') result = [];
    if (call.cmd === 'lia_jobs_spawn') result = { jobId: 'child' };
    if (call.cmd === 'lia_jobs_status') result = { status: { type: 'done', exitCode: 0 } };
    if (call.cmd === 'lia_jobs_get_output') result = { stdout: ['out'], stderr: ['err'], stdoutTotal: 1, stderrTotal: 1 };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const ipc = join(temporary, 'ipc.json');
  writeFileSync(ipc, JSON.stringify({ port: (server.address() as any).port, token: 'test-secret' }));
  try { await run(ipc); } finally { await new Promise<void>(done => server.close(() => done())); }
  return calls;
}

it('Native Rust SDK exposes every bridge namespace and propagates dev context', async () => {
  const project = join(temporary, 'native-bridge'); cpSync(nativeProject, project, { recursive: true });
  writeFileSync(join(project, 'src/main.rs'), `
mod liatir;
use liatir::{define_plugin, field};
use serde_json::json;
fn main() {
 define_plugin().output("ok", field::boolean()).main(|ctx| {
  let b = &ctx.liatir;
  b.invoke("custom_command", json!({"value":true}))?; b.paths()?;
  b.deps().check("node")?; b.deps().check_many(&["node"])?; b.desktop().app().info()?;
  let fs = b.desktop().fs();
  for scope in [fs.data(), fs.cache(), fs.plugin_fs("demo")?] {
   scope.list_content("")?; scope.new_directory("x")?; scope.stat("x")?; scope.exists("x")?;
   scope.write_text("x", "α", true, false)?; scope.read_text("x")?;
   scope.write_bytes("x", "YQ==", true)?; scope.read_bytes("x")?;
   scope.copy("x", "y", false, true, false)?; scope.move_file("x", "y", true, false)?;
   scope.remove("y", false)?; scope.path()?;
  }
  b.log().info("info", json!({}))?; b.log().warn("warn", json!(null))?;
  b.log().error("error", json!(null))?; b.log().debug("debug", json!(null))?;
  b.progress().start(2, Some("work"))?; b.progress().advance(1, None)?; b.progress().update(2, None)?; b.progress().done()?;
  b.jobs().spawn("node", &["-v"], json!({}))?; b.jobs().list()?; b.jobs().status("child")?;
  b.jobs().get_output("child", None)?; b.jobs().kill("child")?;
  b.jobs().run("node", &["-v"], json!({}), |_| {}, |_| {})?;
  Ok(json!({"ok":true}))
 });
}`);
  const calls = await fakeBridge(async ipc => {
    await execFile('cargo', ['build', '--release', '--offline'], { cwd: project });
    const executable = join(project, 'target/release', process.platform === 'win32' ? 'native_plugin.exe' : 'native_plugin');
    const child = execFile(executable, [], { env: { ...process.env, LIATIR_IPC_FILE: ipc, LIATIR_JOB_ID: 'parent', LIATIR_RUN_SCOPE: 'plugin-dev', LIATIR_DEV_SESSION_ID: 'session-1', LIATIR_WORKSPACE_ID: 'sandbox' } });
    child.child.stdin?.end('{}');
    expect((await child).stdout).toContain('__LIATIR_RESULT__{"ok":true}');
  });
  expect(new Set(calls.map(call => call.cmd))).toEqual(new Set(['custom_command', 'lia_fs_paths', 'lia_fs_mkdir', 'lia_deps_check', 'lia_deps_check_many', 'lia_app_info', 'lia_fs_list_dir', 'lia_fs_stat', 'lia_fs_exists', 'lia_fs_write_text', 'lia_fs_read_text', 'lia_fs_write_bytes', 'lia_fs_read_bytes', 'lia_fs_copy', 'lia_fs_move', 'lia_fs_rm', 'lia_plugin_log', 'lia_plugin_progress', 'lia_jobs_spawn', 'lia_jobs_list', 'lia_jobs_status', 'lia_jobs_get_output', 'lia_jobs_kill']));
  expect(calls.every(call => call.payload.__liatirDevContext.sessionId === 'session-1')).toBe(true);
  expect(calls.filter(call => call.cmd === 'lia_plugin_progress').every(call => call.payload.jobId === 'parent')).toBe(true);
}, 60_000);

it.skipIf(!rscript || !rLibrary)('R init/build executes a locked SDK contract without running the handler during build', async () => {
  const project = join(temporary, 'r-plugin');
  await init([project, '--r', '--yes']);
  mkdirSync(join(project, '.liatir'), { recursive: true });
  cpSync(rLibrary!, join(project, '.liatir/r-build-library'), { recursive: true });
  const source = readFileSync(join(project, 'src/main.R'), 'utf8');
  writeFileSync(join(project, 'src/main.R'), source.replace('list(length = nchar', 'if (nzchar(Sys.getenv("LIATIR_EMIT_CONTRACT"))) stop("analysis executed during build")\n  list(length = nchar'));
  await inProject(project, build);
  const packed = await bundle(project);
  const manifest = JSON.parse(await packed.file('manifest.json').async('string'));
  expect(manifest).toMatchObject({ runtime: 'r', r: { entry: 'r/main.R', lockfile: 'r/renv.lock' }, inputSchema: { text: { type: 'string' } }, outputSchema: { length: { type: 'number' } } });
  expect(packed.file('r/liatir.R')).toBeTruthy();
  expect(packed.file('r/renv.lock')).toBeTruthy();
  const input = join(project, 'input.json'); writeFileSync(input, '{"text":"hello"}');
  const env = { ...process.env, R_LIBS_USER: join(project, '.liatir/r-build-library'), LIATIR_INPUT_FILE: input };
  expect((await execFile(rscript!, ['--vanilla', 'main.R'], { cwd: join(project, 'src'), env })).stdout).toContain('__LIATIR_RESULT__{"length":5}');
  writeFileSync(input, '{"text":17}');
  await expect(execFile(rscript!, ['--vanilla', 'main.R'], { cwd: join(project, 'src'), env })).rejects.toThrow(/must be string/);
  writeFileSync(input, '{"text":"hello"}');
  const validation = `source(${JSON.stringify(join(project, 'src/liatir.R'))})
stopifnot(grepl('"accept":["csv"]', .liatir_json(field$file(accept="csv")), fixed=TRUE))
expect_error <- function(expr) { caught <- tryCatch({force(expr); FALSE},error=function(e) TRUE); stopifnot(caught) }
expect_error(.liatir_validate(list(x=field$string(required=TRUE)),list()))
expect_error(.liatir_validate(list(x=field$number()),list(x=TRUE)))
expect_error(.liatir_validate(list(x=field$boolean()),list(x=1)))
expect_error(.liatir_validate(list(x=field$number()),list(extra=1),TRUE))
expect_error(.liatir_validate(list(x=field$file()),list(x=list(invalid=TRUE)),TRUE))
stopifnot(.liatir_validate(list(x=field$number(default=5)),list())$x == 5)
.liatir_validate(list(file=field$file(),stats=field$stats(),json=field$json()),
 list(file=list(content="abc",fileName="x.txt"),stats=list(sections=list()),json=list(a=TRUE)),TRUE)
`;
  await execFile(rscript!, ['--vanilla', '-e', validation], { env });
  const script = join(project, 'bridge.R');
  writeFileSync(script, `source(${JSON.stringify(join(project, 'src/liatir.R'))})
b <- liatir_bridge()
b$invoke("custom_command", list(value=TRUE)); b$paths(); b$deps$check("node"); b$deps$check_many(c("node")); b$desktop$app$info()
for (scope in list(b$desktop$fs$data, b$desktop$fs$cache, b$desktop$fs$plugin_fs("demo"))) {
 scope$list_content(); scope$new_directory("x"); scope$stat("x"); scope$exists("x")
 scope$write_text("x", "α"); scope$read_text("x"); scope$write_bytes("x", "YQ=="); scope$read_bytes("x")
 scope$copy("x", "y"); scope$move("x", "y"); scope$remove("y"); scope$path()
}
b$log$info("info"); b$log$warn("warn"); b$log$error("error"); b$log$debug("debug")
b$progress$start(2); b$progress$advance(); b$progress$update(2); b$progress$done()
b$jobs$spawn("node", c("-v")); b$jobs$list(); b$jobs$status("child"); b$jobs$get_output("child"); b$jobs$kill("child"); b$jobs$run("node", c("-v"))
`);
  const calls = await fakeBridge(async ipc => {
    await execFile(rscript!, ['--vanilla', script], { env: { ...env, LIATIR_IPC_FILE: ipc, LIATIR_JOB_ID: 'parent', LIATIR_RUN_SCOPE: 'plugin-dev', LIATIR_DEV_SESSION_ID: 'session-r', LIATIR_WORKSPACE_ID: 'sandbox' } });
  });
  const devCalls = await fakeBridge(ipc => openDev(project, ipc));
  expect(devCalls.map(call => call.cmd)).toEqual(expect.arrayContaining(['lia_plugin_dev_update_session', 'lia_plugin_dev_open_session', 'lia_plugin_dev_get_session']));
  expect(calls.length).toBeGreaterThan(50);
  expect(calls.every(call => call.payload.__liatirDevContext.sessionId === 'session-r')).toBe(true);
  expect(calls.filter(call => call.cmd === 'lia_plugin_progress').every(call => call.payload.jobId === 'parent')).toBe(true);
}, 60_000);
