/** Package the first-party showcase with the existing unsigned development Plugin builder. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npmInvocation } from './node-cli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = npmInvocation(['run', 'build', '--prefix', 'packages/liatir-cli']);
execFileSync(command.command, command.args, { cwd: root, stdio: 'inherit' });
const { buildDevBundle } = await import(pathToFileURL(path.join(root, 'packages/liatir-cli/dist/commands/build.js')));
process.chdir(path.join(root, 'showcases/single-cell-foundation-benchmark'));
const bundle = await buildDevBundle();
const destination = path.join(root, 'frontend/static/showcases');
await fs.mkdir(destination, { recursive: true });
await fs.copyFile(bundle.path, path.join(destination, 'single-cell-benchmark.lia'));
