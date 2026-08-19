import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { confShellInvocation } from '../../scripts/run-conf.mjs';

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const scripts: Record<string, string> = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).scripts;

/**
 * The generated Tauri/Cargo configuration comes from the `*conf.sh` scripts, and on Windows the
 * first `bash` on PATH is `System32\bash.exe` — the WSL launcher. Running them there works by
 * accident through `/mnt/c` and makes a Windows build depend on a Linux distribution and on the
 * tools installed inside it, which is how `prod-conf.sh` came to need a `jq` that is not on the
 * Windows host at all.
 */
describe('conf script shell resolution', () => {
  it('keeps plain bash off Windows', () => {
    expect(confShellInvocation('prod-conf.sh', { platform: 'darwin' })).toEqual({
      command: 'bash',
      args: ['scripts/prod-conf.sh'],
    });
  });

  it('resolves the Git for Windows shell rather than the WSL launcher', () => {
    expect(confShellInvocation('local-dev-conf.sh', {
      platform: 'win32',
      environment: { ProgramFiles: 'C:\\Program Files' },
      fileExists: (candidate: string) => candidate === GIT_BASH,
    })).toEqual({
      command: GIT_BASH,
      args: ['scripts/local-dev-conf.sh'],
    });
  });

  it('prefers an explicitly configured shell', () => {
    expect(confShellInvocation('dev-conf.sh', {
      platform: 'win32',
      environment: { LIATIR_BASH: 'D:\\msys64\\usr\\bin\\bash.exe', ProgramFiles: 'C:\\Program Files' },
      fileExists: () => true,
    }).command).toBe('D:\\msys64\\usr\\bin\\bash.exe');
  });

  it('fails loudly instead of falling back to a shell that is not a POSIX environment', () => {
    expect(() => confShellInvocation('prod-conf.sh', {
      platform: 'win32',
      environment: { ProgramFiles: 'C:\\Program Files' },
      fileExists: () => false,
    })).toThrow(/No POSIX shell was found/);
  });

  it('routes every conf entry point through the resolver', () => {
    for (const name of ['devconf', 'localdevconf', 'prodconf']) {
      expect(scripts[name], name).toMatch(/^node scripts\/run-conf\.mjs [a-z-]+-conf\.sh$/);
    }
  });
});
