#!/usr/bin/env node

/**
 * The scrollcase command line.
 *
 * Four verbs, one job: turn a recipe into a portable, locked, self-contained box and prove it works.
 * `lock` resolves dependencies once so a human can review and commit the result, `build` installs
 * only from that lock, `verify` re-runs a consumer's install-time checks, and `keygen` produces the
 * signing key that makes any of it trustworthy.
 *
 * Every command resolves its paths through the workspace, so the tool runs from anywhere against any
 * project that declares a scrollcase.config.json.
 */

import { join, resolve } from 'node:path';
import { buildBox } from './build/box.mjs';
import { findPixi, pixiLockArguments } from './build/pixi.mjs';
import { fail, run } from './build/process.mjs';
import { readRecipe } from './build/recipe.mjs';
import { verifyBox } from './build/verify.mjs';
import { configureWorkspace, getWorkspace, workspaceOverridesFromFlags } from './build/workspace.mjs';
import { generateSigningKey } from './sign/index.mjs';

/** Minimal flag parser supporting `--name=value`, `--name value`, and bare `--name` (true). */
function parseArgs(values) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags };
}

const text = (flags, name) => (flags.has(name) ? String(flags.get(name)) : null);

/** Signing key locations, defaulting into the workspace's key directory. */
function keyPaths(flags) {
  const keysDir = getWorkspace().keysDir;
  return {
    privatePath: resolve(text(flags, 'private-key') || join(keysDir, 'signing-private.pem')),
    publicPath: resolve(text(flags, 'public-key') || join(keysDir, 'signing-public.json')),
  };
}

async function keygen(flags) {
  const { privatePath, publicPath } = keyPaths(flags);
  const created = await generateSigningKey({
    privatePath,
    publicPath,
    keyId: text(flags, 'key-id'),
    force: Boolean(flags.get('force')),
  });
  console.log(`Created signing key ${created.keyId}`);
  console.log(`  private: ${created.privatePath}`);
  console.log(`  public:  ${created.publicPath}`);
}

/**
 * `lock` — resolve the recipe's pixi manifest into a fully pinned lock file.
 *
 * Run by a human when dependencies change; the result is committed and reviewed. Builds then only
 * *install* from it, so what ships is exactly what was reviewed. The manifest pins the channels and
 * the single target platform, which is what makes resolution independent of the machine doing it.
 */
async function lock(name, flags) {
  const { dir, recipe } = await readRecipe(name);
  const pixi = findPixi({ requiredVersion: recipe.pixiVersion, path: text(flags, 'pixi') });
  run(pixi, pixiLockArguments(join(dir, 'pixi.toml')));
  console.log(`Updated ${join(dir, 'pixi.lock')}`);
}

async function build(name, flags) {
  await buildBox(name, {
    ...keyPaths(flags),
    allowDirty: Boolean(flags.get('allow-dirty')),
    channel: text(flags, 'channel') || 'beta',
    assetBaseUrl: text(flags, 'asset-base-url'),
    namespace: text(flags, 'namespace') || undefined,
    signerCommand: text(flags, 'signer-command'),
    pixiPath: text(flags, 'pixi'),
    condaPackPath: text(flags, 'conda-pack'),
  });
}

async function verify(path, flags) {
  await verifyBox(path, {
    publicPath: keyPaths(flags).publicPath,
    archive: text(flags, 'archive'),
    selfTest: Boolean(flags.get('self-test')),
  });
}

function usage() {
  console.log(`Usage: scrollcase <command> [options]

Commands:
  keygen                     Create a local ed25519 signing key
  lock <recipe>              Resolve the recipe's pixi manifest into pixi.lock
  build <recipe>             Build, self-test, archive, and sign a box
  verify <release.json>      Verify signature, archive hash, and layout

Build options:
  --channel <name>           Channel the signed pointer names (default beta)
  --asset-base-url <url>     Override the recipe's published base URL
  --namespace <ns>           Document kind namespace (default scrollcase.box)
  --allow-dirty              Permit a build from an uncommitted source tree
  --pixi <path>              Use this pixi executable
  --conda-pack <path>        Use this conda-pack executable

Verify options:
  --archive <path>           Archive to check, if not beside the release document
  --self-test                Extract and import with the box's own interpreter

Signing:
  --private-key <path>       Local signing key (default <keys>/signing-private.pem)
  --public-key <path>        Trusted key set (default <keys>/signing-public.json)
  --signer-command <cmd>     Sign through an external command instead of a local key.
                             It receives the payload on stdin and returns the signed
                             document as JSON on stdout; the result is verified locally.

Workspace:
  Paths come from scrollcase.config.json at the project root, discovered by walking
  up from the working directory, and can be overridden per invocation:
  --config <file>            Use this workspace config explicitly
  --project-root <dir>       Treat this directory as the project root
  --recipes-dir <dir>        Where recipes live (default recipes)
  --build-dir <dir>          Payload scratch space (default .scrollcase/build)
  --out-dir <dir>            Built artefacts (default .scrollcase/dist)
  --keys-dir <dir>           Local signing keys (default .scrollcase/keys)
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  // Resolve the workspace before any command touches a path, so flags win over the project config.
  configureWorkspace({ overrides: workspaceOverridesFromFlags(flags) });
  if (command === 'keygen') return keygen(flags);
  if (command === 'lock') return lock(positional[0] || fail('lock requires a recipe name.'), flags);
  if (command === 'build') return build(positional[0] || fail('build requires a recipe name.'), flags);
  if (command === 'verify') return verify(positional[0] || fail('verify requires a signed release document.'), flags);
  fail(`Unknown command: ${command}`);
}

// Single failure path: every `fail()` anywhere lands here as a one-line message and a non-zero exit
// code, so CI and shell callers can rely on the status.
main().catch((error) => {
  console.error(`scrollcase: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
