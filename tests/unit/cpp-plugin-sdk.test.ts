import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile as exec, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { init } from '../../packages/liatir-cli/src/commands/init';
import {
  build,
  buildDevBundle,
} from '../../packages/liatir-cli/src/commands/build';
import { dev } from '../../packages/liatir-cli/src/commands/dev';
import { liatirNativeTarget } from '@liatir/core';

const execFile = promisify(exec);
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const JSZip = require(resolve(root, 'packages/liatir-cli/node_modules/jszip'));
const temporary = mkdtempSync(join(tmpdir(), 'liatir-cpp-'));
const cmake = process.env.LIATIR_CMAKE ?? 'cmake';
const hasCmake = (() => {
  // Like the R tests, compiled SDK checks opt in to an optional author toolchain.
  if (!process.env.LIATIR_CMAKE) return false;
  try {
    execFileSync(cmake, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const nativeProject = join(temporary, 'native');
const wasmProject = join(temporary, 'wasm');
const executable = join(
  nativeProject,
  '.liatir/cpp-build/native/bin',
  process.platform === 'win32' ? 'liatir_plugin.exe' : 'liatir_plugin',
);

async function inProject<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  try {
    process.chdir(project);
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
async function bundle(project: string) {
  const file = readdirSync(join(project, '.liatir')).find((name) =>
    name.endsWith('.lia'),
  )!;
  return JSZip.loadAsync(readFileSync(join(project, '.liatir', file)));
}
async function runNative(input: unknown, env: Record<string, string> = {}) {
  const file = join(nativeProject, 'test-input-🧬.json');
  writeFileSync(file, JSON.stringify(input));
  return execFile(executable, [], {
    cwd: nativeProject,
    env: { ...process.env, ...env, LIATIR_INPUT_FILE: file },
  });
}
function result(stdout: string) {
  return JSON.parse(
    stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('__LIATIR_RESULT__'))!
      .slice('__LIATIR_RESULT__'.length),
  );
}

const main = `#include "liatir.hpp"
int main() {
 auto plugin = liatir::define_plugin();
 plugin.input("text", liatir::field::string().required(true))
 .input("count", liatir::field::number().default_value(2))
 .input("enabled", liatir::field::boolean().default_value(false))
 .input("file", liatir::field::file().accept({"txt"}))
 .input("mode", liatir::field::string().default_value("valid"))
 .output("text", liatir::field::string().required(true))
 .output("count", liatir::field::number()).output("enabled", liatir::field::boolean())
 .output("file", liatir::field::file().ext({"txt"}))
 .output("json", liatir::field::json()).output("stats", liatir::field::stats());
 if (std::getenv("LIATIR_TEST_BAD_DEFAULT")) plugin.input("bad", liatir::field::number().default_value("wrong"));
 if (std::getenv("LIATIR_TEST_BAD_TYPE")) plugin.input("bad", liatir::field::json());
 return plugin.main([](const liatir::Context& ctx) {
  std::ofstream("handler-called") << "yes";
  const auto mode = ctx.str("mode");
  if(mode == "raw") return liatir::json{{"text", "raw"}, {"json", ctx.input()}};
  if(mode == "missing-output") return liatir::json::object();
  if(mode == "wrong-output") return liatir::json{{"text", true}};
  if(mode == "undeclared") return liatir::json{{"text", "x"}, {"extra", 1}};
  if(mode == "bad-file") return liatir::json{{"text", "x"}, {"file", {{"invalid", true}}}};
  if(mode == "bad-stats") return liatir::json{{"text", "x"}, {"stats", {1, 2}}};
  if(mode == "nonfinite") return liatir::json{{"text", "x"}, {"count", std::numeric_limits<double>::infinity()}};
  if(mode == "file-path") return liatir::json{{"text", "x"}, {"file", {{"path", "/report.txt"}}}};
  if(mode == "file-base64") return liatir::json{{"text", "x"}, {"file", {{"content", "YQ=="}, {"fileName", "x.bin"}, {"base64", true}}}};
  if(mode == "bad-integer") return liatir::json{{"text", std::to_string(ctx.i64("count"))}};
  if(mode == "handler-error") liatir::fail("Requested handler failure");
#ifndef __wasi__
  if(mode == "bridge") {
   liatir::invoke("lia_plugin_log", {{"jobId", liatir::job_id()}, {"level", "info"}, {"message", "C++ bridge"}});
   liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"total", 1}, {"current", 0}});
   liatir::invoke("lia_deps_check", {{"binary", "node"}});
   liatir::invoke("lia_app_info");
   liatir::invoke("lia_fs_write_text", {{"permanent", false}, {"rel", "cpp.txt"}, {"contents", "C++"}});
   liatir::paths(); liatir::run("node", {"-v"});
  }
#endif
  if (!ctx.get("file").is_null()) (void)ctx.path("file");
  return liatir::json{{"text", ctx.str("text")}, {"count", ctx.f64("count")},
   {"enabled", ctx.boolean("enabled")}, {"file", {{"content", ctx.str("text")}, {"fileName", "cpp.txt"}}},
   {"json", {1, 2}}, {"stats", {{"summary", ctx.i64("count")}}}};
 });
}`;

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

it('scaffolds managed C++ projects for both runtimes and keeps Rust defaults', async () => {
  for (const runtime of ['native', 'wasm']) {
    const project = join(temporary, `scaffold-${runtime}`);
    await init([project, `--${runtime}`, '--cpp', '--yes']);
    expect(readFileSync(join(project, 'src/liatir.hpp'), 'utf8')).toContain(
      'managed by @liatir/cli',
    );
    expect(readFileSync(join(project, 'src/main.cpp'), 'utf8')).toContain(
      'define_plugin()',
    );
    expect(existsSync(join(project, 'CMakeLists.txt'))).toBe(true);
    expect(existsSync(join(project, 'Cargo.toml'))).toBe(false);
    expect(existsSync(join(project, 'src/liatir_bridge.hpp'))).toBe(
      runtime === 'native',
    );
    expect(
      JSON.parse(readFileSync(join(project, '.lia-manifest.json'), 'utf8')),
    ).toMatchObject({ runtime, build: { language: 'cpp' } });
  }
  await init([join(temporary, 'cpp-alias'), '--cpp', '--yes']);
  expect(
    JSON.parse(
      readFileSync(join(temporary, 'cpp-alias/.lia-manifest.json'), 'utf8'),
    ).runtime,
  ).toBe('native');
  await init([join(temporary, 'default-native'), '--native', '--yes']);
  expect(existsSync(join(temporary, 'default-native/Cargo.toml'))).toBe(true);
  for (const args of [
    ['--node', '--cpp'],
    ['--python', '--cpp'],
    ['--rust', '--cpp'],
    ['--cpp', '--ts'],
  ]) {
    await expect(
      init([join(temporary, 'invalid'), ...args, '--yes']),
    ).rejects.toThrow(/require|Conflicting|combined/);
    expect(existsSync(join(temporary, 'invalid'))).toBe(false);
  }
});

it('rejects unknown explicit build languages without falling back to Rust', async () => {
  const project = join(temporary, 'unknown-language');
  await init([project, '--cpp', '--yes']);
  const manifest = JSON.parse(
    readFileSync(join(project, '.lia-manifest.json'), 'utf8'),
  );
  manifest.build.language = 'go';
  writeFileSync(join(project, '.lia-manifest.json'), JSON.stringify(manifest));
  await expect(inProject(project, build)).rejects.toThrow(
    'Unsupported compiled build.language',
  );
});

describe.skipIf(!hasCmake)('compiled C++ SDK', () => {
  beforeAll(async () => {
    await init([nativeProject, '--native', '--cpp', '--yes']);
    writeFileSync(join(nativeProject, 'src/main.cpp'), main);
    await inProject(nativeProject, build);
  }, 90_000);

  it('extracts the shared code contract without invoking the handler and packages a real executable', async () => {
    expect(existsSync(join(nativeProject, 'handler-called'))).toBe(false);
    const packed = await bundle(nativeProject);
    const manifest = JSON.parse(
      await packed.file('manifest.json').async('string'),
    );
    expect(await packed.file('_sig').async('string')).toBe('LIATIR/1');
    expect(manifest).toMatchObject({
      runtime: 'native',
      inputSchema: {
        text: { type: 'string', required: true },
        count: { default: 2 },
      },
      outputSchema: { file: { type: 'file' } },
    });
    expect(manifest.build).toBeUndefined();
    expect(manifest.native.cargo).toBeUndefined();
    expect(
      manifest.native.targets[
        liatirNativeTarget(process.platform, process.arch)
      ],
    ).toContain('liatir_plugin');
    const output = result(
      (await runNative({ text: 'héllo 🧬', extra: 'bookkeeping' })).stdout,
    );
    expect(output).toMatchObject({
      text: 'héllo 🧬',
      count: 2,
      enabled: false,
      file: { content: 'héllo 🧬', fileName: 'cpp.txt' },
      json: [1, 2],
      stats: { summary: 2 },
    });
    expect(
      result(
        (
          await runNative({
            text: 'x',
            count: null,
            enabled: true,
            file: '/input.txt',
          })
        ).stdout,
      ),
    ).toMatchObject({ count: 2, enabled: true });
    expect(
      result((await runNative({ text: 'x', mode: 'file-path' })).stdout).file
        .path,
    ).toBe('/report.txt');
    expect(
      result((await runNative({ text: 'x', mode: 'file-base64' })).stdout).file,
    ).toMatchObject({ content: 'YQ==', base64: true });
  });

  it('rejects invalid input/output values, invalid declarations and handler errors', async () => {
    for (const [payload, error] of [
      [{ text: 4, mode: 'raw' }, 'must be string'],
      [{}, 'missing required input'],
      [{ text: 4 }, 'must be string'],
      [{ text: 'x', count: true }, 'must be number'],
      [{ text: 'x', enabled: 1 }, 'must be boolean'],
      [{ text: 'x', file: {} }, 'must be file'],
      [[], 'must be an object'],
    ] as const) {
      rmSync(join(nativeProject, 'handler-called'), { force: true });
      await expect(runNative(payload)).rejects.toThrow(error);
      expect(existsSync(join(nativeProject, 'handler-called'))).toBe(false);
    }
    for (const mode of [
      'missing-output',
      'wrong-output',
      'undeclared',
      'bad-file',
      'bad-stats',
      'nonfinite',
      'handler-error',
    ])
      await expect(runNative({ text: 'x', mode })).rejects.toThrow();
    await expect(
      runNative({ text: 'x', count: 2.5, mode: 'bad-integer' }),
    ).rejects.toThrow('must be an integer');
    for (const [flag, message] of [
      ['LIATIR_TEST_BAD_DEFAULT', 'Invalid default'],
      ['LIATIR_TEST_BAD_TYPE', 'Invalid Plugin field type'],
    ]) {
      await expect(
        runNative({}, { [flag]: '1', LIATIR_EMIT_CONTRACT: '1' }),
      ).rejects.toThrow(message);
    }
  });

  it('refreshes managed headers, refuses user-owned files, and uses the normal dev bundle path', async () => {
    const header = join(nativeProject, 'src/liatir.hpp');
    const original = readFileSync(header, 'utf8');
    writeFileSync(header, original + '\n// stale managed content\n');
    const built = await inProject(nativeProject, buildDevBundle);
    expect(readFileSync(header, 'utf8')).toBe(original);
    expect(realpathSync(built.path)).toBe(
      realpathSync(join(nativeProject, '.lia-dev/current.lia')),
    );
    writeFileSync(header, '// user owned\n');
    try {
      await expect(inProject(nativeProject, build)).rejects.toThrow(
        'not the CLI-managed',
      );
    } finally {
      writeFileSync(header, original);
    }
  }, 60_000);

  it('uses the authenticated bridge and preserves the development session and parent Job', async () => {
    const calls: any[] = [];
    let rejectCommand = false;
    const server = createServer(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer cpp-test');
      const buffers = [];
      for await (const chunk of request) buffers.push(chunk);
      const call = JSON.parse(Buffer.concat(buffers).toString());
      calls.push(call);
      if (rejectCommand) {
        response.end(
          JSON.stringify({ ok: false, error: 'Expected bridge rejection' }),
        );
        return;
      }
      let value: unknown = null;
      if (call.cmd === 'lia_fs_paths')
        value = { data: '/data', cache: '/cache' };
      if (call.cmd === 'lia_jobs_spawn') value = { jobId: 'child' };
      if (call.cmd === 'lia_jobs_status')
        value = { id: 'child', status: { type: 'done', exitCode: 0 } };
      if (call.cmd === 'lia_jobs_get_output')
        value = { stdout: ['ok'], stderr: [] };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, result: value }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const file = join(nativeProject, 'ipc.json');
    writeFileSync(
      file,
      JSON.stringify({
        port: (server.address() as any).port,
        token: 'cpp-test',
      }),
    );
    try {
      expect(
        result(
          (
            await runNative(
              { text: 'bridge', mode: 'bridge' },
              {
                LIATIR_IPC_FILE: file,
                LIATIR_JOB_ID: 'parent',
                LIATIR_RUN_SCOPE: 'plugin-dev',
                LIATIR_DEV_SESSION_ID: 'cpp-session',
                LIATIR_WORKSPACE_ID: 'sandbox',
              },
            )
          ).stdout,
        ).text,
      ).toBe('bridge');
      expect(
        calls.every(
          (call) => call.payload.__liatirDevContext.sessionId === 'cpp-session',
        ),
      ).toBe(true);
      expect(
        calls
          .filter(
            (call) =>
              call.cmd === 'lia_plugin_log' ||
              call.cmd === 'lia_plugin_progress',
          )
          .every((call) => call.payload.jobId === 'parent'),
      ).toBe(true);
      expect(calls.map((call) => call.cmd)).toEqual(
        expect.arrayContaining([
          'lia_fs_write_text',
          'lia_jobs_get_output',
          'lia_deps_check',
          'lia_app_info',
        ]),
      );
      rejectCommand = true;
      await expect(
        runNative(
          { text: 'bridge', mode: 'bridge' },
          { LIATIR_IPC_FILE: file, LIATIR_JOB_ID: 'parent' },
        ),
      ).rejects.toThrow('Expected bridge rejection');
      writeFileSync(file, JSON.stringify({ port: 1.5, token: 'cpp-test' }));
      await expect(
        runNative(
          { text: 'bridge', mode: 'bridge' },
          { LIATIR_IPC_FILE: file, LIATIR_JOB_ID: 'parent' },
        ),
      ).rejects.toThrow('Invalid Liatir app connection');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('opens a C++ Dev Runner session through the same CLI lifecycle', async () => {
    const calls: any[] = [];
    const server = createServer(async (request, response) => {
      const buffers = [];
      for await (const chunk of request) buffers.push(chunk);
      const call = JSON.parse(Buffer.concat(buffers).toString());
      calls.push(call);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          ok: true,
          result: call.cmd === 'lia_plugin_dev_get_session' ? null : {},
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const file = join(nativeProject, 'dev-ipc.json');
    writeFileSync(
      file,
      JSON.stringify({
        port: (server.address() as any).port,
        token: 'dev-test',
      }),
    );
    const previous = process.env.LIATIR_IPC_FILE;
    process.env.LIATIR_IPC_FILE = file;
    try {
      await inProject(nativeProject, () => dev([]));
      expect(calls.map((c) => c.cmd)).toEqual(
        expect.arrayContaining([
          'lia_plugin_dev_update_session',
          'lia_plugin_dev_open_session',
          'lia_plugin_dev_get_session',
        ]),
      );
    } finally {
      if (previous === undefined) delete process.env.LIATIR_IPC_FILE;
      else process.env.LIATIR_IPC_FILE = previous;
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 60_000);
});

describe.skipIf(!hasCmake || !process.env.WASI_SDK_PATH)(
  'C++ WASI Preview 1 SDK',
  () => {
    beforeAll(async () => {
      await init([wasmProject, '--wasm', '--cpp', '--yes']);
      writeFileSync(join(wasmProject, 'src/main.cpp'), main);
      await inProject(wasmProject, build);
      writeFileSync(
        join(wasmProject, 'run.mjs'),
        `import {WASI} from 'node:wasi';import {readFileSync} from 'node:fs';const wasi=new WASI({version:'preview1',args:['plugin.wasm'],env:{},preopens:{'.':process.cwd()},returnOnExit:true});const module=await WebAssembly.compile(readFileSync(process.argv[2]));const instance=await WebAssembly.instantiate(module,wasi.getImportObject());process.exit(wasi.start(instance));`,
      );
    }, 90_000);

    it('runs real WASM with shared defaults, typed values and standard outputs', async () => {
      const packed = await bundle(wasmProject);
      const manifest = JSON.parse(
        await packed.file('manifest.json').async('string'),
      );
      expect(manifest).toMatchObject({
        runtime: 'wasm',
        inputSchema: { text: { type: 'string' } },
        outputSchema: { stats: { type: 'stats' } },
      });
      expect(manifest.build).toBeUndefined();
      const module = await WebAssembly.compile(
        await packed.file('plugin.wasm').async('nodebuffer'),
      );
      expect(
        WebAssembly.Module.imports(module).every(
          (entry) => entry.module === 'wasi_snapshot_preview1',
        ),
      ).toBe(true);
      const wasm = join(
        wasmProject,
        '.liatir/cpp-build/wasm/bin/liatir_plugin.wasm',
      );
      const child = execFile(
        process.execPath,
        [join(wasmProject, 'run.mjs'), wasm],
        { cwd: wasmProject },
      );
      child.child.stdin?.end('{"text":"héllo 🧬"}');
      expect(JSON.parse((await child).stdout)).toMatchObject({
        text: 'héllo 🧬',
        count: 2,
        enabled: false,
        file: { fileName: 'cpp.txt' },
      });
      for (const input of [
        { text: false },
        { text: 'x', mode: 'undeclared' },
        { text: 'x', mode: 'bad-stats' },
        { text: 'x', mode: 'handler-error' },
      ]) {
        const child = execFile(
          process.execPath,
          [join(wasmProject, 'run.mjs'), wasm],
          { cwd: wasmProject },
        );
        child.child.stdin?.end(JSON.stringify(input));
        await expect(child).rejects.toThrow();
      }
      const built = await inProject(wasmProject, buildDevBundle);
      expect(built.runtime).toBe('wasm');
    }, 60_000);
  },
);
