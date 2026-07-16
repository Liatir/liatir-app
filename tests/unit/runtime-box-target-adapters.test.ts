import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  createDeterministicZip,
  extractZipArchive,
  listZipEntries,
} from '../../scripts/runtime-box/archive.mjs';
import { sha256File } from '../../scripts/runtime-box/filesystem.mjs';
import {
  discoverStandalonePythonRoot,
  findPythonRelocationLeaks,
  stageStandalonePython,
} from '../../scripts/runtime-box/python.mjs';
import {
  assertRuntimeBoxNativeHost,
  assertRuntimeBoxPythonEntryPoint,
  runtimeBoxLockArguments,
  runtimeBoxTorchBackendArguments,
  runtimeBoxTargetAdapter,
  runtimeBoxTargetAdapters,
} from '../../scripts/runtime-box/targets.mjs';

const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-adapter-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Runtime Box target adapters', () => {
  it('freezes the exact native host, uv target, Python layout, archive, and inspection contract', () => {
    expect(runtimeBoxTargetAdapters()).toMatchObject([
      {
        id: 'macos-aarch64',
        host: { platform: 'darwin', arch: 'arm64' },
        uvPlatform: 'aarch64-apple-darwin',
        python: { entryPoint: 'venv/bin/python', scriptsDirectory: 'venv/bin', executableSuffix: '' },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'otool' },
      },
      {
        id: 'linux-x86_64',
        host: { platform: 'linux', arch: 'x64' },
        uvPlatform: 'x86_64-unknown-linux-gnu',
        python: { entryPoint: 'venv/bin/python', scriptsDirectory: 'venv/bin', executableSuffix: '' },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'ldd' },
      },
      {
        id: 'windows-x86_64',
        host: { platform: 'win32', arch: 'x64' },
        uvPlatform: 'x86_64-pc-windows-msvc',
        python: { entryPoint: 'venv/python.exe', scriptsDirectory: 'venv/Scripts', executableSuffix: '.exe' },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'dumpbin' },
      },
    ]);
  });

  it('allows only the exact native host and adapter-owned Python entry point', () => {
    for (const adapter of runtimeBoxTargetAdapters()) {
      expect(() => assertRuntimeBoxNativeHost(adapter, adapter.host)).not.toThrow();
      expect(() => assertRuntimeBoxNativeHost(adapter, { platform: 'other', arch: adapter.host.arch })).toThrow(
        /must be built natively/,
      );
      expect(() => assertRuntimeBoxPythonEntryPoint(adapter, adapter.python.entryPoint)).not.toThrow();
      expect(() => assertRuntimeBoxPythonEntryPoint(adapter, 'venv/bin/other')).toThrow(/must use Python entry point/);
    }
  });

  it('uses the proven Windows executable path and lock target without POSIX path assumptions', () => {
    const adapter = runtimeBoxTargetAdapter({
      platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.1',
    });
    expect(win32.join('C:\\runtime-box', ...adapter.python.entryPoint.split('/')))
      .toBe('C:\\runtime-box\\venv\\python.exe');
    expect(runtimeBoxLockArguments(
      adapter,
      { pythonVersion: '3.11.9' },
      'requirements.in',
      'requirements.lock',
    )).toEqual(expect.arrayContaining([
      '--python-platform', 'x86_64-pc-windows-msvc',
      '--only-binary', ':all:',
      '--generate-hashes',
    ]));
  });

  it('pins CPU and CUDA PyTorch wheels to the exact target backend', () => {
    expect(runtimeBoxTorchBackendArguments({
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
      torchBackend: 'cpu',
    })).toEqual(['--torch-backend', 'cpu']);
    expect(runtimeBoxTorchBackendArguments({
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      torchBackend: 'cu124',
    })).toEqual(['--torch-backend', 'cu124']);
    expect(() => runtimeBoxTorchBackendArguments({
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      torchBackend: 'cpu',
    })).toThrow(/does not match target accelerator/);
  });

  it('detects build-host paths in Windows launchers and Python configuration files', async () => {
    const root = await temporaryRoot();
    const adapter = runtimeBoxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    await mkdir(join(root, 'Scripts'), { recursive: true });
    await mkdir(join(root, 'Lib', 'site-packages'), { recursive: true });
    await writeFile(join(root, 'Scripts', 'tool.exe'), Buffer.from('C:\\build\\python.exe\0fixture'));
    await writeFile(join(root, 'Lib', 'site-packages', 'fixture.pth'), 'C:\\build\\site-packages\n');
    expect(await findPythonRelocationLeaks(adapter, root, ['C:\\build'])).toEqual([
      'Lib/site-packages/fixture.pth',
      'Scripts/tool.exe',
    ]);
  });

  it('discovers the standalone root from sys.base_prefix instead of interpreter path depth', async () => {
    const root = await temporaryRoot();
    const distribution = join(root, 'nonstandard', 'standalone-root');
    const interpreter = join(distribution, 'unexpected', 'bin', 'python');
    await mkdir(join(distribution, 'unexpected', 'bin'), { recursive: true });
    await writeFile(interpreter, 'fixture\n');
    expect(discoverStandalonePythonRoot(interpreter, () => distribution)).toBe(distribution);
    expect(() => discoverStandalonePythonRoot(join(root, 'outside', 'python'), () => distribution))
      .toThrow(/outside sys.base_prefix/);
  });

  it('installs the exact managed Python before discovering and staging it', async () => {
    const root = await temporaryRoot();
    const sourceRoot = join(root, 'managed-python');
    const sourceInterpreter = join(sourceRoot, 'bin', 'python');
    const payloadDir = join(root, 'payload');
    const adapter = runtimeBoxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });
    await mkdir(dirname(sourceInterpreter), { recursive: true });
    await writeFile(sourceInterpreter, 'fixture\n');
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === 'uv' && args[1] === 'find') return sourceInterpreter;
      if (command === sourceInterpreter) return sourceRoot;
      return '';
    };

    const staged = await stageStandalonePython({
      adapter,
      payloadDir,
      pythonVersion: '3.11.9',
      run,
      uv: 'uv',
    });

    expect(calls.slice(0, 2)).toEqual([
      { command: 'uv', args: ['python', 'install', '3.11.9'] },
      {
        command: 'uv',
        args: ['python', 'find', '3.11.9', '--python-preference', 'only-managed'],
      },
    ]);
    expect(calls).toContainEqual({
      command: 'uv',
      args: [
        'pip', 'uninstall', 'pip', 'setuptools', '--python', staged.interpreter,
        '--system', '--break-system-packages', '--no-config',
      ],
    });
    expect(await readFile(staged.interpreter, 'utf8')).toBe('fixture\n');
  });

  it('uses one deterministic streaming ZIP implementation for creation, listing, and extraction', async () => {
    const root = await temporaryRoot();
    const payload = join(root, 'payload');
    const first = join(root, 'first.zip');
    const second = join(root, 'second.zip');
    const extracted = join(root, 'extracted');
    const adapter = runtimeBoxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'cpu' });
    await mkdir(join(payload, 'venv', 'bin'), { recursive: true });
    await writeFile(join(payload, 'box.json'), '{"schemaVersion":1}\n');
    await writeFile(join(payload, 'venv', 'bin', 'python'), 'fixture\n');

    await createDeterministicZip(payload, first, adapter);
    await createDeterministicZip(payload, second, adapter);
    expect(await sha256File(first)).toBe(await sha256File(second));
    expect(await listZipEntries(first)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'box.json', kind: 'file' }),
      expect.objectContaining({ path: 'venv/bin/python', kind: 'file', mode: 0o755 }),
    ]));
    await extractZipArchive(first, extracted);
    expect(await readFile(join(extracted, 'box.json'), 'utf8')).toBe('{"schemaVersion":1}\n');
  });

  it('rejects traversal entries before extraction', async () => {
    const root = await temporaryRoot();
    const payload = join(root, 'payload');
    const archive = join(root, 'traversal.zip');
    const adapter = runtimeBoxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'cpu' });
    await mkdir(join(payload, 'xx'), { recursive: true });
    await writeFile(join(payload, 'xx', 'escape.txt'), 'fixture\n');
    await createDeterministicZip(payload, archive, adapter);

    const bytes = await readFile(archive);
    const safeName = Buffer.from('xx/escape.txt');
    const unsafeName = Buffer.from('../escape.txt');
    let replaced = 0;
    for (let offset = bytes.indexOf(safeName); offset !== -1; offset = bytes.indexOf(safeName, offset + 1)) {
      unsafeName.copy(bytes, offset);
      replaced += 1;
    }
    expect(replaced).toBe(2);
    await writeFile(archive, bytes);
    await expect(extractZipArchive(archive, join(root, 'rejected'))).rejects.toThrow(/invalid relative path|Unsafe/);
  });

  it('rejects ZIP symbolic links before extraction', async () => {
    const root = await temporaryRoot();
    const archive = join(root, 'link.zip');
    const zip = new yazl.ZipFile();
    const output = pipeline(zip.outputStream, createWriteStream(archive));
    zip.addBuffer(Buffer.from('../outside'), 'linked-file', { mode: 0o120777 });
    zip.end();
    await output;
    await expect(extractZipArchive(archive, join(root, 'rejected'))).rejects.toThrow(
      /links and special entries are not allowed/,
    );
  });

  it('preserves forward-slash ZIP names for Windows paths longer than the legacy path limit', async () => {
    const root = await temporaryRoot();
    const payload = join(root, 'payload');
    const archive = join(root, 'windows-long-path.zip');
    const extracted = join(root, 'extracted');
    const adapter = runtimeBoxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    const longRelativePath = `${Array.from({ length: 26 }, (_, index) => `segment-${index.toString().padStart(2, '0')}`)
      .join('/')}/python.exe`;
    expect(longRelativePath.length).toBeGreaterThan(260);
    const fixturePath = join(payload, ...longRelativePath.split('/'));
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, 'fixture\n');

    await createDeterministicZip(payload, archive, adapter);
    const entries = await listZipEntries(archive);
    expect(entries).toContainEqual(expect.objectContaining({ path: longRelativePath, mode: 0o644 }));
    expect(entries.every((entry) => !entry.path.includes('\\'))).toBe(true);
    await extractZipArchive(archive, extracted);
    expect(await readFile(join(extracted, ...longRelativePath.split('/')), 'utf8')).toBe('fixture\n');
  });
});
