/** Resolves shell-free JavaScript CLI invocations for repository child processes. */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

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
