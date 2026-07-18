/** Resolves a shell-free npm invocation that also works with Node on Windows. */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Runs npm through its JavaScript CLI on Windows so child_process never spawns npm.cmd. */
export function runtimeBoxNpmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { command: 'npm', args: [...args] };

  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const npmExecutable = options.npmExecutable ?? process.env.npm_execpath;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [
    npmExecutable,
    resolve(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate) => (
    typeof candidate === 'string'
    && /\.m?js$/i.test(candidate)
    && fileExists(candidate)
  ));
  if (candidates.length === 0) {
    throw new Error('Runtime Box npm CLI could not be resolved for a shell-free Windows process.');
  }
  return {
    command: nodeExecutable,
    args: [candidates[0], ...args],
  };
}
