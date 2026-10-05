/** A Windows-owned WSL session keeps the complete study independent of chat lifetime. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBackground } from './single-cell-background.mjs';
import { LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION, LIATIR_SINGLE_CELL_STUDY_PC_LIMITS } from '../packages/liatir-core/dist/single-cell-showcase.js';

const [distribution, linuxUser, linuxRoot, entry, executionProfile = 'cautious-cpu'] = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('Launch this WSL2 supervisor from Windows.');
if (!distribution || !/^[a-z_][a-z0-9_-]*$/.test(linuxUser ?? '')
  || !linuxRoot?.startsWith('/') || path.posix.normalize(linuxRoot) !== linuxRoot
  || !entry?.startsWith(`${linuxRoot}/showcases/single-cell-foundation-benchmark/transfer/`)
  || path.posix.normalize(entry) !== entry || !['cautious-cpu', 'pc-cuda'].includes(executionProfile)) {
  throw new Error('Usage: node scripts/run-single-cell-wsl2.mjs <distribution> <linux-user> <absolute-linux-checkout> <study-entry-in-transfer> [cautious-cpu|pc-cuda]');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unit = `liatir-single-cell-${randomUUID()}`;
const pc = executionProfile === 'pc-cuda';
const threads = String(pc ? LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION.threads : 1);
// The Windows owner keeps WSL alive. A unique cgroup contains only this study;
// per-phase memory, disk, host availability and GPU guards remain independent.
const args = ['--distribution', distribution, '--user', 'root', '--exec',
  '/usr/bin/systemd-run', `--unit=${unit}`, '--wait', '--pipe', '--collect',
  '--property=MemorySwapMax=0', '--property=RuntimeMaxSec=86400', `--uid=${linuxUser}`,
  ...(pc ? [`--property=MemoryMax=${LIATIR_SINGLE_CELL_STUDY_PC_LIMITS.maxRssBytes}`] : []),
  `--working-directory=${linuxRoot}`,
  ...Object.entries({ OMP_NUM_THREADS: threads, OPENBLAS_NUM_THREADS: threads, MKL_NUM_THREADS: threads,
    NUMBA_NUM_THREADS: threads, JAX_PLATFORMS: 'cpu', PYTHONHASHSEED: '23',
    LIATIR_STUDY_PC_GPU: pc ? '1' : '0',
    NODE_OPTIONS: '--max-old-space-size=1152',
    PATH: `/home/${linuxUser}/.local/bin:/home/${linuxUser}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`,
  }).map(([name, value]) => `--setenv=${name}=${value}`),
  '/usr/local/bin/node', entry];
const result = launchBackground({ directory: path.join(root, 'showcases/single-cell-foundation-benchmark/transfer/windows-executions'),
  command: 'wsl.exe', args, cwd: root });
console.log(JSON.stringify({ ...result, distribution, linuxUser, linuxRoot, entry, unit, executionProfile }, null, 2));
