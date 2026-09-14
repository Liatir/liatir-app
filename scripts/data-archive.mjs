/**
 * Deterministic ZIPs of plain data — reference indexes, tool suites, test fixtures — written by the
 * same Scrollcase archiver as a Runtime Box, so identical inputs give identical bytes.
 */

import { createDeterministicZip } from 'scrollcase/build';
import { boxTargetAdapter } from 'scrollcase/contract';

const LINUX_CPU = boxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });

/**
 * Scrollcase asks which runtime's layout grants the executable bit. A data archive runs nothing,
 * and `native` grants it only under `venv/bin`, which no data payload has, so every entry is 0644.
 */
export function createDataArchive(payloadDir, archivePath) {
  return createDeterministicZip(payloadDir, archivePath, LINUX_CPU, { runtimeId: 'native' });
}
