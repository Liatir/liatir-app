import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0'
};

const result = spawnSync(
  'cargo',
  ['tauri', 'build', '--debug', '--features', 'wdio', '--bundles', 'app', '--ci'],
  {
    cwd: 'src-tauri',
    env,
    stdio: 'inherit'
  }
);

process.exit(result.status ?? 1);
