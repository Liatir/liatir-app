#!/usr/bin/env node

/**
 * Runs one of the repository's `*conf.sh` generators through a real POSIX shell.
 *
 * On Windows the `bash` that npm's cmd.exe finds first is `System32\bash.exe`, the WSL launcher.
 * The conf scripts happen to survive that — WSL sees the checkout through `/mnt/c` and the relative
 * paths still resolve — which is exactly why nobody noticed that generating a Windows build's
 * configuration silently depends on a Linux distribution and on the tools installed inside it.
 * `prod-conf.sh` needs `jq`, so a Windows production build fails there rather than on Windows.
 *
 * Git for Windows ships the MSYS2 shell the rest of this toolchain already assumes, so resolve it
 * explicitly and fail loudly when it is absent. Every other platform keeps plain `bash`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { packageAppVersion } from './app-version.mjs';

const ROOT = resolve(import.meta.dirname, '..');

// Windows paths are built with the win32 rules explicitly: the resolver takes its platform as an
// argument, so a caller asking about Windows must get the same answer on every host.
/** Shells that are a real POSIX environment for this checkout, most specific first. */
function windowsShellCandidates(environment) {
  return [
    environment.LIATIR_BASH,
    environment.ProgramFiles && win32.join(environment.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    environment['ProgramFiles(x86)'] && win32.join(environment['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    environment.LOCALAPPDATA && win32.join(environment.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
}

export function confShellInvocation(script, options = {}) {
  const platform = options.platform ?? process.platform;
  const args = [`scripts/${script}`];
  if (platform !== 'win32') return { command: 'bash', args };

  const environment = options.environment ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const shell = windowsShellCandidates(environment).find((candidate) => fileExists(candidate));
  if (!shell) {
    throw new Error(
      'No POSIX shell was found for the conf scripts. Install Git for Windows, or set LIATIR_BASH '
      + 'to a bash executable. The System32 bash.exe launcher runs WSL and is deliberately not used.',
    );
  }
  return { command: shell, args };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) {
  const script = process.argv[2];
  if (!/^[a-z0-9-]+-conf\.sh$/.test(script ?? '')) {
    console.error('Usage: node scripts/run-conf.mjs <name>-conf.sh');
    process.exit(2);
  }
  const invocation = confShellInvocation(script);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    env: { ...process.env, APP_VERSION: packageAppVersion() },
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
