/**
 * Liatir's checked boundary around the published Scrollcase CLI.
 *
 * Generic pixi box work goes through the package executable. Liatir injects its frozen document
 * namespace, translates its private signer into Scrollcase's command contract, and writes CI
 * receipts only after the package has returned success. Distribution and the temporary uv
 * compatibility path remain explicitly Liatir-owned.
 */

import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { boxReleaseStem, sha256File } from 'scrollcase/build';
import { verifySignedDocument } from 'scrollcase/sign';
import { publishedNodeCliInvocation } from '../node-cli.mjs';
import { fail, runResult as defaultRunResult } from './process.mjs';
import {
  configureWorkspace,
  getWorkspace,
  workspaceOverridesFromFlags,
} from './workspace.mjs';
import { runLegacyRuntimeBoxCommand } from './legacy-cli.mjs';
import { liatirSignerCommand } from './signer-command.mjs';

export const LIATIR_SCROLLCASE_NAMESPACE = 'liatir.runtime-box';
const DISTRIBUTION_COMMANDS = new Set(['serve', 'publish', 'publish-key', 'promote', 'revoke']);
const VALUE_FLAGS = new Set([
  'archive',
  'asset-base-url',
  'build-dir',
  'channel',
  'conda-pack',
  'config',
  'key-id',
  'keys-dir',
  'namespace',
  'out-dir',
  'pixi',
  'private-key',
  'project-root',
  'public-key',
  'receipt',
  'recipes-dir',
  'signer',
  'signer-audience',
  'signer-command',
  'toolchain-dir',
  'weights',
]);

/** Parses flags without changing the original argv that will be forwarded to a child CLI. */
export function parseRuntimeBoxArguments(values) {
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
    else if (VALUE_FLAGS.has(name) && values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function withoutFlags(values, names) {
  const skipped = new Set(names);
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      result.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (!skipped.has(name)) {
      result.push(value);
      if (inline === undefined && VALUE_FLAGS.has(name)
        && values[index + 1] && !values[index + 1].startsWith('--')) {
        result.push(values[index + 1]);
        index += 1;
      }
      continue;
    }
    if (inline === undefined && VALUE_FLAGS.has(name)
      && values[index + 1] && !values[index + 1].startsWith('--')) {
      index += 1;
    }
  }
  return result;
}

async function writeReceipt(path, value) {
  if (!path) return;
  const output = resolve(String(path));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

function recipePath(name) {
  const recipes = getWorkspace().recipesDir;
  const path = resolve(recipes, name, 'recipe.json');
  if (!path.startsWith(`${recipes}${sep}`)) fail(`Invalid recipe: ${name}`);
  return path;
}

async function readRecipe(name) {
  const recipe = JSON.parse(await readFile(recipePath(name), 'utf8'));
  if (recipe.schemaVersion !== 1 || recipe.recipeId !== name) {
    fail(`Invalid recipe contract: ${name}`);
  }
  return recipe;
}

function publicKeyPath(flags) {
  return resolve(String(flags.get('public-key')
    || join(getWorkspace().keysDir, 'signing-public.json')));
}

/** Creates the compact verification receipt consumed by Liatir's evidence builder. */
export async function verificationReceipt(releaseDocumentPath, flags, {
  selfTest = Boolean(flags.get('self-test')),
} = {}) {
  const releasePath = resolve(releaseDocumentPath);
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = await verifySignedDocument(signed, publicKeyPath(flags));
  if (release.kind !== 'liatir.runtime-box.release') {
    fail('Document is not a Liatir Runtime Box release.');
  }
  const archivePath = resolve(String(flags.get('archive')
    || join(dirname(releasePath), `${boxReleaseStem(release)}.zip`)));
  const archive = await stat(archivePath);
  if (archive.size !== release.archive.sizeBytes) fail('Archive size mismatch after verification.');
  if (await sha256File(archivePath) !== release.archive.sha256) {
    fail('Archive SHA-256 mismatch after verification.');
  }
  return {
    schemaVersion: 1,
    status: 'passed',
    localSignatureVerified: true,
    signingKeyIds: signed.signatures.map((signature) => signature.keyId),
    releasePayloadSha256: signed.payloadSha256,
    archiveSha256: release.archive.sha256,
    archiveSizeBytes: release.archive.sizeBytes,
    selfTest: selfTest ? 'passed' : 'not-requested',
  };
}

function checkedNamespace(flags) {
  const requested = flags.get('namespace');
  if (requested !== undefined && requested !== LIATIR_SCROLLCASE_NAMESPACE) {
    fail(`Liatir builds require --namespace ${LIATIR_SCROLLCASE_NAMESPACE}.`);
  }
}

function scrollcaseArguments(command, values, flags) {
  let forwarded = withoutFlags(values, ['receipt']);
  if (command === 'build') {
    checkedNamespace(flags);
    if (flags.has('signer-command')) {
      fail('Liatir owns the protected signer command; pass --signer and --signer-audience.');
    }
    forwarded = withoutFlags(forwarded, ['namespace', 'signer', 'signer-audience']);
    forwarded.push('--namespace', LIATIR_SCROLLCASE_NAMESPACE);
    const signerUrl = flags.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL;
    if (signerUrl) {
      forwarded.push('--signer-command', liatirSignerCommand({
        signerUrl: String(signerUrl),
        audience: String(flags.get('signer-audience')
          || process.env.LIATIR_RUNTIME_BOX_SIGNER_AUDIENCE
          || ''),
      }));
    }
  }
  return [command, ...forwarded];
}

/** Invokes the checked package executable without a shell or unpublished import. */
export function runScrollcaseCli(args, {
  runResult = defaultRunResult,
  invocation = publishedNodeCliInvocation,
} = {}) {
  const resolved = invocation('scrollcase', 'contract', 'scrollcase', args);
  const result = runResult(resolved.command, resolved.args, {
    cwd: getWorkspace().root,
    capture: false,
  });
  if (result.error) fail(`Scrollcase failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`Scrollcase exited with status ${result.status}`);
}

async function runPublishedCommand(command, values, parsed, options) {
  const args = scrollcaseArguments(command, values, parsed.flags);
  runScrollcaseCli(args, options);
  if (command === 'verify' && parsed.flags.get('receipt')) {
    const receipt = await verificationReceipt(
      parsed.positional[0] || fail('verify requires a signed release document.'),
      parsed.flags,
    );
    await writeReceipt(parsed.flags.get('receipt'), receipt);
  }
  if (command === 'build' && parsed.flags.get('receipt')) {
    const name = parsed.positional[0] || fail('build requires a recipe name.');
    const recipe = await readRecipe(name);
    const releasePath = join(getWorkspace().distDir, `${boxReleaseStem(recipe)}.release.json`);
    const receipt = await verificationReceipt(releasePath, parsed.flags, { selfTest: true });
    await writeReceipt(parsed.flags.get('receipt'), receipt);
  }
}

export function usage() {
  console.log(`Usage: npm run runtime-box -- <command> [options]

Generic box commands (published Scrollcase):
  keygen                         Create a local Ed25519 signing key
  lock <recipe>                  Regenerate a pixi dependency lock
  build <recipe>                 Build, self-test, archive, and sign a box
  verify <release.json>          Verify signature, archive hash, and layout

Liatir distribution commands:
  serve [--port 8790]            Serve local candidate Registry data
  publish <release.json>         Upload immutable release objects to R2
  publish-key --bucket <name>    Publish the Worker public-key trust root
  promote <channel.json>         Promote a signed channel through the Worker
  revoke --box --version         Create a signed revocation document

Liatir always builds with namespace ${LIATIR_SCROLLCASE_NAMESPACE}. Protected builds
translate --signer and --signer-audience into Scrollcase's external signer command.
`);
}

/** Stable Liatir dispatcher. The uv branch is temporary and removed after P5.3/P5.4. */
export async function dispatchRuntimeBox(command, values, options = {}) {
  if (!command || command === 'help' || command === '--help') return usage();
  const parsed = parseRuntimeBoxArguments(values);
  configureWorkspace({ overrides: workspaceOverridesFromFlags(parsed.flags) });
  const legacyCommand = options.legacyCommand ?? runLegacyRuntimeBoxCommand;
  if (DISTRIBUTION_COMMANDS.has(command)) {
    return legacyCommand(command, values);
  }
  if (command === 'keygen' || command === 'verify') {
    return runPublishedCommand(command, values, parsed, options);
  }
  if (command === 'lock' || command === 'build') {
    const name = parsed.positional[0] || fail(`${command} requires a recipe name.`);
    const recipe = await readRecipe(name);
    if (!recipe.pixiVersion) {
      console.error(`runtime-box: ${name} remains on the temporary uv compatibility path.`);
      return legacyCommand(command, values);
    }
    return runPublishedCommand(command, values, parsed, options);
  }
  fail(`Unknown command: ${command}`);
}
