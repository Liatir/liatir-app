import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  createDeterministicZip,
  extractRecipeArchive,
  extractZipArchive,
  listZipEntries,
} from '../../scripts/runtime-box/archive.mjs';
import { sha256File } from '../../scripts/runtime-box/filesystem.mjs';
import {
  discoverStandalonePythonRoot,
  findPythonRelocationLeaks,
  repairPosixLaunchers,
  stageStandalonePython,
  syncLockedPythonDependencies,
  validateRelocatablePython,
} from '../../scripts/runtime-box/python.mjs';
import {
  assertRuntimeBoxNativeHost,
  assertRuntimeBoxPythonEntryPoint,
  runtimeBoxCondaSubdir,
  runtimeBoxLockArguments,
  runtimeBoxPixiAccelerator,
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
        condaSubdir: 'osx-arm64',
        python: { entryPoint: 'venv/bin/python', scriptsDirectory: 'venv/bin', executableSuffix: '' },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'otool' },
      },
      {
        id: 'linux-x86_64',
        host: { platform: 'linux', arch: 'x64' },
        uvPlatform: 'x86_64-unknown-linux-gnu',
        condaSubdir: 'linux-64',
        python: { entryPoint: 'venv/bin/python', scriptsDirectory: 'venv/bin', executableSuffix: '' },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'ldd' },
      },
      {
        id: 'windows-x86_64',
        host: { platform: 'win32', arch: 'x64' },
        uvPlatform: 'x86_64-pc-windows-msvc',
        condaSubdir: 'win-64',
        python: {
          entryPoint: 'venv/python.exe',
          scriptsDirectory: 'venv/Scripts',
          executableSuffix: '.exe',
          launcherKind: 'uv-windows-pe',
        },
        archive: { writer: 'yazl@3.3.1', reader: 'yauzl@3.4.0', zip64: true },
        nativeLibraryInspection: { command: 'dumpbin' },
      },
    ]);
  });

  it('maps every target to its conda subdir and rejects target drift', () => {
    expect(runtimeBoxCondaSubdir({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' })).toBe('osx-arm64');
    expect(runtimeBoxCondaSubdir({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' })).toBe('linux-64');
    expect(runtimeBoxCondaSubdir({
      platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4',
    })).toBe('win-64');
    expect(() => runtimeBoxCondaSubdir({ platform: 'solaris', arch: 'x86_64', accelerator: 'cpu' })).toThrow(
      /Unsupported Runtime Box target/,
    );
  });

  it('derives the conda accelerator descriptor and pins CUDA to a numeric version', () => {
    expect(runtimeBoxPixiAccelerator({ target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' } }))
      .toEqual({ accelerator: 'metal', cudaVersion: null });
    expect(runtimeBoxPixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' } }))
      .toEqual({ accelerator: 'cpu', cudaVersion: null });
    expect(runtimeBoxPixiAccelerator({
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
    })).toEqual({ accelerator: 'cuda', cudaVersion: '12.4' });
    expect(() => runtimeBoxPixiAccelerator({
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda' },
    })).toThrow(/numeric major\.minor CUDA version/);
    expect(() => runtimeBoxPixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'tpu' } }))
      .toThrow(/Unsupported Runtime Box accelerator/);
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

  it('marks Windows wheel installation relocatable only while uv generates launchers', async () => {
    const root = await temporaryRoot();
    const destinationRoot = join(root, 'payload', 'venv');
    const interpreter = join(destinationRoot, 'python.exe');
    const lockPath = join(root, 'requirements.lock');
    const markerPath = join(destinationRoot, 'pyvenv.cfg');
    const adapter = runtimeBoxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    await mkdir(destinationRoot, { recursive: true });
    await writeFile(interpreter, 'fixture\n');
    await writeFile(lockPath, 'fixture==1.0.0\n');
    const calls: Array<{ command: string; args: string[] }> = [];

    await syncLockedPythonDependencies({
      adapter,
      destinationRoot,
      interpreter,
      lockPath,
      run: (command: string, args: string[]) => {
        expect(readFileSync(markerPath, 'utf8')).toBe('relocatable = true\n');
        calls.push({ command, args });
      },
      uv: 'uv',
      extraArgs: ['--torch-backend', 'cpu'],
    });

    expect(calls).toEqual([{
      command: 'uv',
      args: [
        'pip', 'sync', lockPath, '--python', interpreter,
        '--system', '--break-system-packages', '--require-hashes', '--strict', '--no-config',
        '--torch-backend', 'cpu',
      ],
    }]);
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(syncLockedPythonDependencies({
      adapter,
      destinationRoot,
      interpreter,
      lockPath,
      run: () => { throw new Error('fixture sync failed'); },
      uv: 'uv',
    })).rejects.toThrow('fixture sync failed');
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs uv long-path POSIX launchers before relocation validation', async () => {
    const root = await temporaryRoot();
    const payloadDir = join(root, 'long-build-path', 'payload');
    const destinationRoot = join(payloadDir, 'venv');
    const scriptsRoot = join(destinationRoot, 'bin');
    const interpreter = join(scriptsRoot, 'python');
    const launcher = join(scriptsRoot, 'f2py');
    const sourceRoot = join(root, 'managed-python');
    const adapter = runtimeBoxTargetAdapter({
      platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4',
    });
    await mkdir(scriptsRoot, { recursive: true });
    await writeFile(interpreter, 'fixture\n');
    await writeFile(launcher, [
      '#!/bin/sh',
      `'''exec' '${interpreter}' "$0" "$@"`,
      "' '''",
      '# -*- coding: utf-8 -*-',
      'import sys',
      '',
    ].join('\n'));
    const canonicalDestinationRoot = await realpath(destinationRoot);
    const canonicalInterpreter = join(canonicalDestinationRoot, 'bin', 'python');

    await validateRelocatablePython({
      adapter,
      destinationRoot,
      interpreter,
      payloadDir,
      sourceRoot,
      run: () => JSON.stringify({
        basePrefix: canonicalDestinationRoot,
        executable: canonicalInterpreter,
      }),
    });

    const repaired = await readFile(launcher, 'utf8');
    expect(repaired).toContain('$(dirname -- "$0")');
    expect(repaired).not.toContain(payloadDir);
    expect(repaired).toContain('# -*- coding: utf-8 -*-');
    expect(await findPythonRelocationLeaks(adapter, destinationRoot, [payloadDir])).toEqual([]);
  });

  it('repairs conda console-script trampolines that close their quote on the same line', async () => {
    const root = await temporaryRoot();
    const payloadDir = join(root, 'payload');
    const scriptsRoot = join(payloadDir, 'venv', 'bin');
    const buildPrefix = join(root, 'pixi-workspace', '.pixi', 'envs', 'default');
    const adapter = runtimeBoxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' });
    await mkdir(scriptsRoot, { recursive: true });
    await writeFile(join(scriptsRoot, 'python'), 'fixture\n');
    // conda writes `'''exec' "<abs python>" "$0" "$@" #'''` — the closing quote sits on that line.
    await writeFile(join(scriptsRoot, 'tqdm'), [
      '#!/bin/sh',
      `'''exec' "${buildPrefix}/bin/python3.11" "$0" "$@" #'''`,
      '# -*- coding: utf-8 -*-',
      'import sys',
      '',
    ].join('\n'));

    await repairPosixLaunchers(adapter, payloadDir, [buildPrefix]);

    const repaired = await readFile(join(scriptsRoot, 'tqdm'), 'utf8');
    expect(repaired).not.toContain(buildPrefix);
    expect(repaired).toContain('$(dirname -- "$0")');
    expect(repaired).toContain('# -*- coding: utf-8 -*-');
    expect(repaired).toContain('import sys');
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

  it('merges recipe archives without deleting previously staged assets', async () => {
    const root = await temporaryRoot();
    const archivePayload = join(root, 'archive-payload');
    const archive = join(root, 'asset.zip');
    const destination = join(root, 'payload', 'model-cache', 'uce', 'model_files');
    const adapter = runtimeBoxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'cpu' });
    await mkdir(join(archivePayload, 'protein_embeddings'), { recursive: true });
    await writeFile(join(archivePayload, 'protein_embeddings', 'human.pt'), 'embedding\n');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'species_offsets.pkl'), 'offsets\n');
    await createDeterministicZip(archivePayload, archive, adapter);

    await extractRecipeArchive(archive, 'zip', destination);

    expect(await readFile(join(destination, 'species_offsets.pkl'), 'utf8')).toBe('offsets\n');
    expect(await readFile(join(destination, 'protein_embeddings', 'human.pt'), 'utf8')).toBe('embedding\n');
  });

  it('rejects recipe archive collisions with previously staged assets', async () => {
    const root = await temporaryRoot();
    const archivePayload = join(root, 'archive-payload');
    const archive = join(root, 'asset.zip');
    const destination = join(root, 'payload');
    const adapter = runtimeBoxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'cpu' });
    await mkdir(archivePayload, { recursive: true });
    await writeFile(join(archivePayload, 'asset.bin'), 'replacement\n');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'asset.bin'), 'verified-original\n');
    await createDeterministicZip(archivePayload, archive, adapter);

    await expect(extractRecipeArchive(archive, 'zip', destination)).rejects.toThrow(/already exists/);
    expect(await readFile(join(destination, 'asset.bin'), 'utf8')).toBe('verified-original\n');
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
