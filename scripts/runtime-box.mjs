#!/usr/bin/env node

/** Stable Liatir Runtime Box operator surface; implementation ownership lives in focused modules. */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchRuntimeBox } from './runtime-box/scrollcase-adapter.mjs';

async function main() {
  const [command, ...values] = process.argv.slice(2);
  await dispatchRuntimeBox(command, values);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`runtime-box: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
