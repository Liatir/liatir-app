#!/usr/bin/env node

/** Cross-platform command runner with a bounded, low-noise progress heartbeat. */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HEARTBEAT_SECONDS = 300;

/** Formats the one-line progress signal emitted only at meaningful intervals. */
export function heartbeatLine(label, elapsedMs) {
  const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
  return `[runtime-box heartbeat] ${label} is still running (${elapsedMinutes} min elapsed)`;
}

/** Runs one command without a shell while periodically proving that it is still alive. */
export async function runWithHeartbeat(command, args, options = {}) {
  const label = options.label || command;
  const configuredSeconds = Number(
    options.heartbeatSeconds
      ?? process.env.LIATIR_RUNTIME_BOX_HEARTBEAT_SECONDS
      ?? DEFAULT_HEARTBEAT_SECONDS,
  );
  if (!Number.isFinite(configuredSeconds) || configuredSeconds < 1) {
    throw new Error('Runtime Box heartbeat interval must be at least one second.');
  }
  const startedAt = Date.now();
  const output = { stdout: '', stderr: '' };
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  let bufferedBytes = 0;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (options.capture) {
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      stream.on('data', (chunk) => {
        bufferedBytes += chunk.byteLength;
        if (bufferedBytes > maxBuffer) {
          child.kill();
          return;
        }
        const text = chunk.toString();
        output[name] += text;
        (name === 'stdout' ? process.stdout : process.stderr).write(chunk);
      });
    }
  }
  const timer = setInterval(() => {
    console.error(heartbeatLine(label, Date.now() - startedAt));
  }, configuredSeconds * 1000);
  try {
    const result = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit({ code: code ?? 1, signal }));
    });
    if (bufferedBytes > maxBuffer) throw new Error(`${label} exceeded the bounded output buffer.`);
    return { ...result, ...output, elapsedMs: Date.now() - startedAt };
  } finally {
    clearInterval(timer);
  }
}

function parseCli(values) {
  const separator = values.indexOf('--');
  if (separator < 0 || separator === values.length - 1) {
    throw new Error('Usage: heartbeat.mjs [--label text] [--cwd path] -- command [args...]');
  }
  const options = {};
  for (let index = 0; index < separator; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Invalid heartbeat option: ${name ?? '<end>'}`);
    options[name.slice(2)] = value;
  }
  return { options, command: values[separator + 1], args: values.slice(separator + 2) };
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  const result = await runWithHeartbeat(parsed.command, parsed.args, {
    label: parsed.options.label,
    cwd: parsed.options.cwd ? resolve(parsed.options.cwd) : process.cwd(),
    heartbeatSeconds: parsed.options.heartbeatSeconds,
  });
  if (result.signal) throw new Error(`${parsed.options.label || parsed.command} terminated by ${result.signal}`);
  if (result.code !== 0) process.exitCode = result.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
