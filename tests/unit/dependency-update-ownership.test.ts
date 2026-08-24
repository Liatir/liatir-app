/**
 * Who may update an installed dependency, decided from where the binary actually lives.
 *
 * The bug this pins: the Dependencies screen reported Nextflow as "Installed" (it was, at
 * `~/.local/bin/nextflow`, put there by Nextflow's own installer) and in the same row offered
 * "Check update", which ran `brew upgrade nextflow` and printed `Error: nextflow not installed`.
 * Both statements were true of different things, and together they read as nonsense to the user.
 *
 * The rule is one-sided on purpose. Homebrew on Intel macOS links into `/usr/local/bin`, a path
 * manual installs share, so anything there must keep its update button; only a path no package
 * manager could own loses it.
 */
import { describe, expect, it } from 'vitest';
import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
import {
  dependencyOwner,
  packageManagerUpdateCommand,
} from '$lib/dependencies/resolvers';

const BOTH_MANAGERS = { brewAvailable: true, condaAvailable: true };
const nextflow = DEP_REQUIREMENTS.nextflow;

describe('dependencyOwner', () => {
  it('claims the Homebrew prefixes, on both macOS architectures and on Linux', () => {
    expect(dependencyOwner('/opt/homebrew/bin/samtools')).toBe('brew');
    expect(dependencyOwner('/usr/local/Cellar/samtools/1.19/bin/samtools')).toBe('brew');
    expect(dependencyOwner('/usr/local/bin/samtools')).toBe('brew');
    expect(dependencyOwner('/home/linuxbrew/.linuxbrew/bin/samtools')).toBe('brew');
  });

  it('claims conda prefixes, including a named environment', () => {
    expect(dependencyOwner('/Users/x/miniconda3/bin/samtools')).toBe('conda');
    expect(dependencyOwner('/opt/conda/bin/samtools')).toBe('conda');
    expect(dependencyOwner('/Users/x/miniforge3/envs/bio/bin/samtools')).toBe('conda');
  });

  it('calls everything else foreign, and an unknown path nothing at all', () => {
    expect(dependencyOwner('/Users/x/.local/bin/nextflow')).toBe('other');
    expect(dependencyOwner('/usr/bin/java')).toBe('other');
    expect(dependencyOwner(null)).toBeNull();
    expect(dependencyOwner(undefined)).toBeNull();
  });
});

describe('packageManagerUpdateCommand', () => {
  it('offers no update for a Nextflow installed by its own script', () => {
    expect(
      packageManagerUpdateCommand(nextflow, BOTH_MANAGERS, '/Users/x/.local/bin/nextflow'),
    ).toBeNull();
  });

  it('still upgrades with brew what sits in a brew prefix', () => {
    expect(packageManagerUpdateCommand(nextflow, BOTH_MANAGERS, '/opt/homebrew/bin/nextflow')).toEqual({
      cmd: 'brew',
      args: ['upgrade', 'nextflow'],
    });
  });

  it('keeps the ambiguous /usr/local/bin eligible, since Intel macOS brew links there', () => {
    expect(packageManagerUpdateCommand(nextflow, BOTH_MANAGERS, '/usr/local/bin/nextflow')?.cmd).toBe(
      'brew',
    );
  });

  it('updates a conda-installed tool with conda even when brew is present', () => {
    expect(
      packageManagerUpdateCommand(nextflow, BOTH_MANAGERS, '/Users/x/miniconda3/bin/nextflow'),
    ).toEqual({
      cmd: 'conda',
      args: ['install', '-c', 'conda-forge', '-y', 'nextflow'],
    });
  });

  it('behaves exactly as before when the path is unknown', () => {
    expect(packageManagerUpdateCommand(nextflow, BOTH_MANAGERS)).toEqual({
      cmd: 'brew',
      args: ['upgrade', 'nextflow'],
    });
  });
});
