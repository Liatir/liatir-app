/**
 * Runs the test matrix: pick a profile (or individual suites), execute them in order, report what happened.
 *
 * The suites are declared in `test-matrix.mjs`; this file only decides *which* to run and drives them. Two
 * behaviours worth knowing about:
 *
 *   - **heavy suites are opt-in.** `heavy-ai-e2e` downloads and runs real models, which costs hours and
 *     gigabytes. It is skipped unless `--include-heavy` is passed, so `--profile all` on a laptop does not
 *     accidentally start a multi-gigabyte download.
 *   - **it stops on the first failure** unless `--continue-on-failure` is given. The suites build on each
 *     other — running the end-to-end tests after the build already failed only produces noise on top of the
 *     real error.
 *
 * A JSON report is written per run so CI can attribute a failure to a specific suite rather than to "the tests".
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTestArtifacts } from './support/artifact-cleanup.mjs';
import { testProfiles, testSuites } from './test-matrix.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReportDir = path.join(rootDir, 'tests', '.artifacts', 'reports');

/** Accepts both `--flag value` and `--flag=value` for every option. */
function parseArgs(argv) {
  const options = {
    continueOnFailure: false,
    dryRun: false,
    includeHeavy: false,
    list: false,
    profiles: [],
    reportDir: defaultReportDir,
    suites: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile' || arg === '--tier') {
      options.profiles.push(argv[++index]);
    } else if (arg.startsWith('--profile=')) {
      options.profiles.push(arg.slice('--profile='.length));
    } else if (arg.startsWith('--tier=')) {
      options.profiles.push(arg.slice('--tier='.length));
    } else if (arg === '--suite') {
      options.suites.push(argv[++index]);
    } else if (arg.startsWith('--suite=')) {
      options.suites.push(arg.slice('--suite='.length));
    } else if (arg === '--report-dir') {
      options.reportDir = path.resolve(rootDir, argv[++index]);
    } else if (arg.startsWith('--report-dir=')) {
      options.reportDir = path.resolve(rootDir, arg.slice('--report-dir='.length));
    } else if (arg === '--include-heavy') {
      options.includeHeavy = true;
    } else if (arg === '--continue-on-failure') {
      options.continueOnFailure = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--list') {
      options.list = true;
    } else {
      throw new Error(`Unknown test matrix argument: ${arg}`);
    }
  }

  if (options.profiles.length === 0 && options.suites.length === 0) {
    options.profiles.push('fast');
  }

  return options;
}

function unique(values) {
  return [...new Set(values)];
}

function suiteById() {
  return new Map(testSuites.map((suite) => [suite.id, suite]));
}

function selectSuites(options) {
  const byId = suiteById();
  const selectedIds = [];

  if (options.suites.length > 0) {
    selectedIds.push(...options.suites);
  } else {
    for (const profile of options.profiles) {
      const suiteIds = testProfiles[profile];
      if (!suiteIds) {
        throw new Error(`Unknown test profile "${profile}". Available profiles: ${Object.keys(testProfiles).join(', ')}`);
      }
      selectedIds.push(...suiteIds);
    }
  }

  const ids = unique(selectedIds);
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error(`Unknown test suite "${id}". Available suites: ${testSuites.map((suite) => suite.id).join(', ')}`);
    }
  }

  return testSuites.filter((suite) => ids.includes(suite.id));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function missingEnv(requiredEnv = []) {
  return requiredEnv.filter((name) => !process.env[name]);
}

function killProcess(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }
}

function runSuite(suite, paths) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const logPath = path.join(paths.logDir, `${suite.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const e2eReportPath = suite.e2eReport
      ? path.join(paths.e2eReportDir, `${suite.id}.json`)
      : null;
    const env = {
      ...process.env,
      ...(e2eReportPath ? { LIATIR_E2E_REPORT: e2eReportPath } : {}),
    };
    let timedOut = false;

    console.log(`\n==> ${suite.label}`);
    console.log(`$ ${suite.command} ${suite.args.join(' ')}`);
    logStream.write(`$ ${suite.command} ${suite.args.join(' ')}\n\n`);

    const child = spawn(suite.command, suite.args, {
      cwd: rootDir,
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, suite.timeoutMs);

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });
    child.on('error', (error) => {
      logStream.write(`\nProcess error: ${error.stack ?? error.message}\n`);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const finishedAt = new Date();
      logStream.end();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const status = code === 0 && !timedOut ? 'passed' : 'failed';
      resolve({
        command: `${suite.command} ${suite.args.join(' ')}`,
        description: suite.description,
        durationMs,
        e2eReportPath,
        finishedAt: finishedAt.toISOString(),
        heavy: Boolean(suite.heavy),
        id: suite.id,
        label: suite.label,
        layer: suite.layer,
        logPath,
        signal,
        startedAt: startedAt.toISOString(),
        status,
        timeoutMs: suite.timeoutMs,
        timedOut,
        exitCode: code,
      });
    });
  });
}

function skippedResult(suite, reason) {
  const now = new Date().toISOString();
  return {
    command: `${suite.command} ${suite.args.join(' ')}`,
    description: suite.description,
    durationMs: 0,
    e2eReportPath: null,
    finishedAt: now,
    heavy: Boolean(suite.heavy),
    id: suite.id,
    label: suite.label,
    layer: suite.layer,
    logPath: null,
    reason,
    startedAt: now,
    status: 'skipped',
    timeoutMs: suite.timeoutMs,
  };
}

function summarize(results, durationMs) {
  return {
    durationMs,
    failed: results.filter((result) => result.status === 'failed').length,
    passed: results.filter((result) => result.status === 'passed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    total: results.length,
  };
}

function relativePath(filePath) {
  return filePath ? path.relative(rootDir, filePath) : '';
}

function loadE2EFailures(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!Array.isArray(report.tests)) return [];
    return report.tests
      .filter((test) => test.status === 'failed')
      .map((test) => ({
        durationMs: test.durationMs ?? 0,
        error: test.error ?? '',
        failureScreenshot: test.failureScreenshot ?? null,
        name: test.name,
        specPath: test.specPath,
      }));
  } catch (error) {
    return [{
      durationMs: 0,
      error: `Could not read E2E report: ${error instanceof Error ? error.message : String(error)}`,
      failureScreenshot: null,
      name: 'E2E report parse failure',
      specPath: relativePath(reportPath),
    }];
  }
}

function renderMarkdown(report) {
  const lines = [
    '# Liatir Test Report',
    '',
    `Generated: ${report.finishedAt}`,
    `Run ID: \`${report.runId}\``,
    `Profiles: ${report.profiles.length > 0 ? report.profiles.map((profile) => `\`${profile}\``).join(', ') : 'custom suites'}`,
    `Heavy tests enabled: ${report.includeHeavy ? 'yes' : 'no'}`,
    '',
    '## Summary',
    '',
    `Passed: ${report.summary.passed}`,
    `Failed: ${report.summary.failed}`,
    `Skipped: ${report.summary.skipped}`,
    `Total: ${report.summary.total}`,
    `Duration: ${formatDuration(report.summary.durationMs)}`,
    '',
    '## Suites',
    '',
    '| Status | Suite | Layer | Duration | Log |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const result of report.suites) {
    const log = result.logPath ? `\`${relativePath(result.logPath)}\`` : result.reason ?? '';
    lines.push(`| ${result.status} | ${result.label} | ${result.layer} | ${formatDuration(result.durationMs)} | ${log} |`);
  }

  const failed = report.suites.filter((result) => result.status === 'failed');
  if (failed.length > 0) {
    lines.push('', '## Failures', '');
    for (const result of failed) {
      lines.push(`- ${result.label}: ${result.timedOut ? 'timed out' : `exit code ${result.exitCode ?? 'unknown'}`}. Log: \`${relativePath(result.logPath)}\`.`);
      if (result.e2eReportPath) {
        lines.push(`  E2E report: \`${relativePath(result.e2eReportPath)}\`.`);
      }
    }
  }

  const skipped = report.suites.filter((result) => result.status === 'skipped');
  if (skipped.length > 0) {
    lines.push('', '## Skipped', '');
    for (const result of skipped) {
      lines.push(`- ${result.label}: ${result.reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildFailureReport(report) {
  const failedSuites = report.suites.filter((result) => result.status === 'failed');
  return {
    finishedAt: report.finishedAt,
    failures: failedSuites.map((result) => ({
      command: result.command,
      durationMs: result.durationMs,
      e2eFailures: loadE2EFailures(result.e2eReportPath),
      e2eReportPath: result.e2eReportPath,
      exitCode: result.exitCode,
      id: result.id,
      label: result.label,
      layer: result.layer,
      logPath: result.logPath,
      signal: result.signal,
      timedOut: Boolean(result.timedOut),
    })),
    runId: report.runId,
    summary: report.summary,
  };
}

function errorPreview(error) {
  return String(error || '')
    .split('\n')
    .slice(0, 8)
    .join('\n');
}

function renderFailureMarkdown(failureReport) {
  const lines = [
    '# Liatir Test Failures',
    '',
    `Generated: ${failureReport.finishedAt}`,
    `Run ID: \`${failureReport.runId}\``,
    '',
  ];

  if (failureReport.failures.length === 0) {
    lines.push('No failures were recorded in the latest test matrix run.', '');
    return lines.join('\n');
  }

  for (const failure of failureReport.failures) {
    lines.push(`## ${failure.label}`, '');
    lines.push(`- Suite: \`${failure.id}\``);
    lines.push(`- Layer: \`${failure.layer}\``);
    lines.push(`- Command: \`${failure.command}\``);
    lines.push(`- Duration: ${formatDuration(failure.durationMs)}`);
    lines.push(`- Exit: ${failure.timedOut ? 'timed out' : failure.exitCode ?? 'unknown'}`);
    if (failure.logPath) lines.push(`- Log: \`${relativePath(failure.logPath)}\``);
    if (failure.e2eReportPath) lines.push(`- E2E report: \`${relativePath(failure.e2eReportPath)}\``);
    lines.push('');

    if (failure.e2eFailures.length > 0) {
      lines.push('### Failed E2E Tests', '');
      for (const test of failure.e2eFailures) {
        lines.push(`- ${test.name} (${test.specPath}, ${formatDuration(test.durationMs)})`);
        if (test.failureScreenshot) lines.push(`  Screenshot: \`${relativePath(test.failureScreenshot)}\``);
        if (test.error) {
          lines.push('');
          lines.push('```text');
          lines.push(errorPreview(test.error));
          lines.push('```');
          lines.push('');
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeReport(report, reportDir, runDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  const markdown = renderMarkdown(report);
  const failureReport = buildFailureReport(report);
  const failureJson = JSON.stringify(failureReport, null, 2);
  const failureMarkdown = renderFailureMarkdown(failureReport);
  const timestampJson = path.join(runDir, 'report.json');
  const timestampMd = path.join(runDir, 'report.md');
  const timestampFailuresJson = path.join(runDir, 'failures.json');
  const timestampFailuresMd = path.join(runDir, 'failures.md');
  const latestJson = path.join(reportDir, 'latest.json');
  const latestMd = path.join(reportDir, 'latest.md');
  const latestFailuresJson = path.join(reportDir, 'latest-failures.json');
  const latestFailuresMd = path.join(reportDir, 'latest-failures.md');

  fs.writeFileSync(timestampJson, json);
  fs.writeFileSync(timestampMd, markdown);
  fs.writeFileSync(timestampFailuresJson, failureJson);
  fs.writeFileSync(timestampFailuresMd, failureMarkdown);
  fs.copyFileSync(timestampJson, latestJson);
  fs.copyFileSync(timestampMd, latestMd);
  fs.copyFileSync(timestampFailuresJson, latestFailuresJson);
  fs.copyFileSync(timestampFailuresMd, latestFailuresMd);

  return {
    latestFailuresJson,
    latestFailuresMd,
    latestJson,
    latestMd,
    timestampFailuresJson,
    timestampFailuresMd,
    timestampJson,
    timestampMd,
  };
}

async function main() {
  cleanupTestArtifacts(rootDir);

  const options = parseArgs(process.argv.slice(2));
  const suites = selectSuites(options);

  if (options.list) {
    for (const suite of testSuites) {
      console.log(`${suite.id}\t${suite.layer}\t${suite.heavy ? 'heavy' : 'default'}\t${suite.label}`);
    }
    return;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(options.reportDir, runId);
  const paths = {
    e2eReportDir: path.join(runDir, 'e2e'),
    logDir: path.join(runDir, 'logs'),
  };
  fs.mkdirSync(paths.logDir, { recursive: true });
  fs.mkdirSync(paths.e2eReportDir, { recursive: true });

  const startedAt = new Date();
  const results = [];

  for (const suite of suites) {
    const missing = missingEnv(suite.requiredEnv);
    if (suite.heavy && !options.includeHeavy) {
      results.push(skippedResult(suite, 'Heavy suite not enabled. Pass --include-heavy and required env vars to run it.'));
      continue;
    }
    if (missing.length > 0) {
      results.push(skippedResult(suite, `Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`));
      continue;
    }
    if (options.dryRun) {
      results.push(skippedResult(suite, 'Dry run.'));
      continue;
    }

    const result = await runSuite(suite, paths);
    results.push(result);
    if (result.status === 'failed' && !options.continueOnFailure) {
      break;
    }
  }

  const finishedAt = new Date();
  const report = {
    includeHeavy: options.includeHeavy,
    profiles: options.profiles,
    requestedSuites: options.suites,
    reportDir: options.reportDir,
    rootDir,
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    summary: summarize(results, finishedAt.getTime() - startedAt.getTime()),
    suites: results,
  };
  const reportPaths = writeReport(report, options.reportDir, runDir);

  console.log(`\nTest report: ${relativePath(reportPaths.latestMd)}`);
  console.log(`Machine report: ${relativePath(reportPaths.latestJson)}`);
  console.log(`Failure report: ${relativePath(reportPaths.latestFailuresMd)}`);

  if (report.summary.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
