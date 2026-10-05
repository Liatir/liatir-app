/** A Windows-owned WSL session keeps the complete study independent of chat lifetime. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBackground } from './single-cell-background.mjs';

const [distribution, linuxUser, linuxRoot, entry] = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('Launch this WSL2 supervisor from Windows.');
if (!distribution || !/^[a-z_][a-z0-9_-]*$/.test(linuxUser ?? '')
  || !linuxRoot?.startsWith('/') || path.posix.normalize(linuxRoot) !== linuxRoot
  || !entry?.startsWith(`${linuxRoot}/showcases/single-cell-foundation-benchmark/transfer/`)
  || path.posix.normalize(entry) !== entry) {
  throw new Error('Usage: node scripts/run-single-cell-wsl2.mjs <distribution> <linux-user> <absolute-linux-checkout> <study-entry-in-transfer>');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unit = `liatir-single-cell-${randomUUID()}`;
// Only this execution's descendants refuse swapping. All original scientific
// process-family RSS, host-memory, disk and host-wide swap guards still apply.
const args = ['--distribution', distribution, '--user', 'root', '--exec',
  '/usr/bin/systemd-run', `--unit=${unit}`, '--wait', '--pipe', '--collect',
  '--property=MemorySwapMax=0', '--property=RuntimeMaxSec=86400', `--uid=${linuxUser}`,
  `--working-directory=${linuxRoot}`,
  ...Object.entries({ OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1',
    NUMBA_NUM_THREADS: '1', JAX_PLATFORMS: 'cpu', PYTHONHASHSEED: '23',
    NODE_OPTIONS: '--max-old-space-size=1152',
    PATH: `/home/${linuxUser}/.local/bin:/home/${linuxUser}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`,
  }).map(([name, value]) => `--setenv=${name}=${value}`),
  '/usr/local/bin/node', entry];
const result = launchBackground({ directory: path.join(root, 'showcases/single-cell-foundation-benchmark/transfer/windows-executions'),
  command: 'wsl.exe', args, cwd: root });
console.log(JSON.stringify({ ...result, distribution, linuxUser, linuxRoot, entry, unit }, null, 2));
