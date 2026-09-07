import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GitHub rejects a whole workflow file when an expression names a context that is not available
 * where it is written, and a rejected file produces a run with zero jobs and no logs — it looks
 * like nothing happened rather than like a failure. `phase3-dependency-lock.yml` shipped with
 * `${{ runner.temp }}` in `jobs.<id>.env` and was rejected exactly that way on push.
 *
 * `jobs.<job_id>.env` may only use github, needs, strategy, matrix, vars, secrets and inputs.
 * `runner`, `job`, `steps` and `env` become available one level down, in a step's `env` or `run`.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability
 */
const WORKFLOWS_DIR = resolve('.github/workflows');
const FORBIDDEN_AT_JOB_LEVEL = ['runner', 'job', 'steps', 'env'];

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Returns each `jobs.<job_id>.env` entry as `<job>.<key>: <raw value>`. */
function jobLevelEnvEntries(source: string): string[] {
  const lines = source.split(/\r?\n/u);
  const entries: string[] = [];
  let job: string | null = null;
  let inJobs = false;
  let envIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      inJobs = line.startsWith('jobs:');
      job = null;
      envIndent = null;
      continue;
    }
    if (!inJobs) continue;
    if (indent === 2 && line.trimEnd().endsWith(':')) {
      job = line.trim().slice(0, -1);
      envIndent = null;
      continue;
    }
    if (envIndent !== null && indent > envIndent) {
      entries.push(`${job}.${line.trim()}`);
      continue;
    }
    envIndent = null;
    if (indent === 4 && job && line.trim() === 'env:') envIndent = indent;
  }
  return entries;
}

describe('GitHub workflow expression placement', () => {
  const workflows = readdirSync(WORKFLOWS_DIR).filter((file) => file.endsWith('.yml'));

  it('finds the workflow directory', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)('keeps %s free of contexts unavailable in job-level env', (file) => {
    const entries = jobLevelEnvEntries(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8'));
    const invalid = entries.filter((entry) => FORBIDDEN_AT_JOB_LEVEL.some(
      (context) => new RegExp(String.raw`\$\{\{\s*${context}\.`, 'u').test(entry),
    ));
    expect(invalid, `${file} uses a context GitHub does not allow in jobs.<id>.env`).toEqual([]);
  });

  it('detects the exact placement GitHub rejected on 2026-09-07', () => {
    const rejected = [
      'jobs:',
      '  lock:',
      '    runs-on: ubuntu-24.04',
      '    env:',
      '      PIXI_HOME: ${{ runner.temp }}/liatir-phase3-pixi',
      '      PIXI_VERSION: v0.73.0',
      '    steps:',
      '      - run: echo ${{ runner.temp }}',
    ].join('\n');
    const entries = jobLevelEnvEntries(rejected);
    expect(entries).toEqual([
      'lock.PIXI_HOME: ${{ runner.temp }}/liatir-phase3-pixi',
      'lock.PIXI_VERSION: v0.73.0',
    ]);
    // The same expression inside a step is legal and must not be reported.
    expect(entries.some((entry) => entry.includes('echo'))).toBe(false);
  });
});
