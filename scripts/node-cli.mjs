/** Resolves shell-free JavaScript CLI invocations for repository child processes. */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Runs npm through its JavaScript CLI on Windows instead of a command shim. */
export function npmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { command: 'npm', args: [...args] };

  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const npmExecutable = options.npmExecutable ?? process.env.npm_execpath;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [
    npmExecutable,
    resolve(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(nodeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate) => (
    typeof candidate === 'string'
    && /\.m?js$/i.test(candidate)
    && fileExists(candidate)
  ));
  if (candidates.length === 0) {
    throw new Error('npm CLI could not be resolved for a shell-free Windows process.');
  }
  return {
    command: nodeExecutable,
    args: [candidates[0], ...args],
  };
}

/** Runs a checked local package CLI through the current Node executable on every platform. */
export function localNodeCliInvocation(moduleId, args, options = {}) {
  const resolveModule = options.resolveModule ?? require.resolve;
  const fileExists = options.fileExists ?? existsSync;
  const cli = resolveModule(moduleId);
  if (!fileExists(cli)) throw new Error(`Local Node CLI is missing: ${moduleId}`);
  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [cli, ...args],
  };
}

/**
 * Resolves a package's declared executable from one of its public exports.
 *
 * npm's Windows command shims require shell parsing, which is the wrong boundary for quoted signer
 * commands. Resolving the checked package metadata lets every platform invoke the published CLI
 * through the current Node executable with an argument array.
 */
export function publishedNodeCliInvocation(packageName, publicExport, binName, args, options = {}) {
  const resolveModule = options.resolveModule
    ?? ((moduleId) => fileURLToPath(import.meta.resolve(moduleId)));
  const fileExists = options.fileExists ?? existsSync;
  const readText = options.readText ?? ((path) => readFileSync(path, 'utf8'));
  const publicEntry = resolveModule(`${packageName}/${publicExport}`);
  let packageRoot = dirname(publicEntry);
  let packageJsonPath = null;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(packageRoot, 'package.json');
    if (fileExists(candidate)) {
      packageJsonPath = candidate;
      break;
    }
    const parent = dirname(packageRoot);
    if (parent === packageRoot) break;
    packageRoot = parent;
  }
  if (!packageJsonPath) throw new Error(`Package metadata could not be resolved for ${packageName}.`);
  const packageJson = JSON.parse(readText(packageJsonPath));
  const relativeBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.[binName];
  if (typeof relativeBin !== 'string') {
    throw new Error(`Package ${packageName} does not declare the ${binName} executable.`);
  }
  const executable = resolve(packageRoot, relativeBin);
  if (!fileExists(executable)) throw new Error(`Published package CLI is missing: ${executable}`);
  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [executable, ...args],
  };
}
