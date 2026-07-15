import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { collectFiles, fileExists } from './filesystem.mjs';
import { fail } from './process.mjs';

/** Ensures a discovered interpreter root is absolute and actually owns the interpreter. */
function validateStandaloneRoot(root, interpreter) {
  if (!isAbsolute(root)) fail(`Managed Python returned a non-absolute sys.base_prefix: ${root}`);
  const relativeInterpreter = relative(root, resolve(interpreter));
  if (!relativeInterpreter || relativeInterpreter === '..' || relativeInterpreter.startsWith(`..${sep}`)) {
    fail(`Managed Python interpreter is outside sys.base_prefix: ${interpreter}`);
  }
}

/** Discovers the standalone distribution root from Python itself, never from path depth guesses. */
export function discoverStandalonePythonRoot(interpreter, run) {
  const root = run(interpreter, ['-c', 'import sys; print(sys.base_prefix)'], { capture: true });
  validateStandaloneRoot(root, interpreter);
  return resolve(root);
}

/** Copies the exact uv-managed standalone distribution into the adapter's payload layout. */
export async function stageStandalonePython({ adapter, payloadDir, pythonVersion, run, uv }) {
  const managedPython = run(uv, [
    'python', 'find', pythonVersion, '--python-preference', 'only-managed',
  ], { capture: true, env: { UV_NO_CONFIG: '1' } });
  const sourceRoot = discoverStandalonePythonRoot(managedPython, run);
  const destinationRoot = join(payloadDir, adapter.python.payloadRoot);
  await mkdir(dirname(destinationRoot), { recursive: true });
  await cp(sourceRoot, destinationRoot, {
    recursive: true,
    dereference: true,
    preserveTimestamps: false,
  });
  const interpreter = join(payloadDir, ...adapter.python.entryPoint.split('/'));
  if (!await fileExists(interpreter)) {
    fail(`${adapter.id} standalone Python is missing ${adapter.python.entryPoint}`);
  }
  return { interpreter, sourceRoot, destinationRoot };
}

/** Makes generated POSIX console scripts resolve Python relative to their own installed path. */
async function repairPosixLaunchers(adapter, payloadDir, forbiddenPaths) {
  const scriptsRoot = join(payloadDir, ...adapter.python.scriptsDirectory.split('/'));
  if (!await fileExists(scriptsRoot)) return;
  const pythonName = basename(adapter.python.entryPoint);
  for (const file of await collectFiles(scriptsRoot)) {
    const path = join(scriptsRoot, ...file.split('/'));
    const bytes = await readFile(path);
    if (!bytes.subarray(0, 2).equals(Buffer.from('#!'))) continue;
    const text = bytes.toString('utf8');
    const lineEnd = text.indexOf('\n');
    const shebang = lineEnd === -1 ? text : text.slice(0, lineEnd);
    if (!forbiddenPaths.some((value) => shebang.includes(value))) continue;
    const body = lineEnd === -1 ? '' : text.slice(lineEnd + 1);
    const launcher = [
      '#!/bin/sh',
      `'''exec' "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/${pythonName}" "$0" "$@"`,
      "' '''",
      body,
    ].join('\n');
    await writeFile(path, launcher);
    await chmod(path, 0o755);
  }
}

/** Selects files where Python tooling commonly records a build-host absolute path. */
function isRelocationSensitiveFile(adapter, relativePath) {
  const name = basename(relativePath).toLowerCase();
  const scriptsDirectory = `${adapter.python.scriptsDirectory.slice(adapter.python.payloadRoot.length + 1)}/`;
  return relativePath.startsWith(scriptsDirectory)
    || name.endsWith('.pth')
    || name === 'pyvenv.cfg'
    || name === 'python._pth'
    || name.startsWith('activate');
}

/** Finds forbidden build-host path references in launchers, .pth files, and Python config files. */
export async function findPythonRelocationLeaks(adapter, pythonRoot, forbiddenPaths) {
  const leaks = [];
  const needles = [...new Set(forbiddenPaths.flatMap((value) => [
    value,
    value.replaceAll('\\', '/'),
    value.replaceAll('/', '\\'),
  ]).filter(Boolean))];
  for (const file of await collectFiles(pythonRoot)) {
    if (!isRelocationSensitiveFile(adapter, file)) continue;
    const bytes = await readFile(join(pythonRoot, ...file.split('/')));
    const utf8 = bytes.toString('utf8');
    const utf16 = bytes.toString('utf16le');
    if (needles.some((needle) => utf8.includes(needle) || utf16.includes(needle))) leaks.push(file);
  }
  return leaks;
}

/** Repairs supported launchers and rejects every remaining absolute build-host path. */
export async function validateRelocatablePython({
  adapter,
  destinationRoot,
  interpreter,
  payloadDir,
  run,
  sourceRoot,
}) {
  const forbiddenPaths = [sourceRoot, payloadDir, resolve(payloadDir)];
  if (adapter.python.launcherKind === 'posix-polyglot') {
    await repairPosixLaunchers(adapter, payloadDir, forbiddenPaths);
  }
  const leaks = await findPythonRelocationLeaks(adapter, destinationRoot, forbiddenPaths);
  if (leaks.length > 0) {
    fail(`Standalone Python contains absolute build-host paths: ${leaks.slice(0, 10).join(', ')}`);
  }

  const probe = [
    adapter.selfTestPython,
    'import json, os, sys',
    'print(json.dumps({"basePrefix": os.path.realpath(sys.base_prefix), "executable": os.path.realpath(sys.executable)}))',
  ].join('\n');
  const result = JSON.parse(run(interpreter, ['-c', probe], { capture: true, cwd: payloadDir }));
  if (resolve(result.basePrefix) !== resolve(destinationRoot)) {
    fail(`Relocated Python resolved sys.base_prefix outside its payload: ${result.basePrefix}`);
  }
  const executableRelativePath = relative(destinationRoot, resolve(result.executable));
  if (executableRelativePath === '..' || executableRelativePath.startsWith(`..${sep}`)) {
    fail(`Relocated Python resolved its executable outside the payload: ${result.executable}`);
  }
}
