/**
 * Liatir's checked boundary around the published Scrollcase CLI.
 *
 * Generic pixi box work goes through the package executable. Liatir injects its frozen document
 * namespace, translates its private signer into Scrollcase's command contract, and writes CI
 * receipts only after the package has returned success. Distribution remains explicitly
 * Liatir-owned; no local builder remains behind this surface.
 */

import { readFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  configureWorkspace,
  getWorkspace,
  sha256File,
  workspaceOverridesFromFlags,
} from 'scrollcase/build';
import { boxTargetId } from 'scrollcase/contract/browser';
import { verifySignedDocument } from 'scrollcase/sign';
import { publishedNodeCliInvocation } from '../node-cli.mjs';
import { runtimeBoxArchivePath } from './identity.mjs';
import { fail, runResult as defaultRunResult } from './process.mjs';
import { runRuntimeBoxDistributionCommand } from './distribution-cli.mjs';
import { liatirSignerCommand } from './signer-command.mjs';

export const LIATIR_SCROLLCASE_NAMESPACE = 'liatir.runtime-box';
const DISTRIBUTION_COMMANDS = new Set([
  'serve',
  'publish',
  'publish-source-mirror',
  'publish-key',
  'promote',
  'revoke',
]);
const VALUE_FLAGS = new Set([
  'archive',
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
  'scrolls-dir',
  'signer',
  'signer-audience',
  'signer-command',
  'toolchain-dir',
  'target',
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

async function readScroll(selector) {
  const [boxId, targetId, ...extra] = selector.split('/');
  if (!boxId || !targetId || extra.length > 0) fail(`Invalid scroll selector: ${selector}`);
  const scrolls = getWorkspace().scrollsDir;
  const path = resolve(scrolls, boxId, targetId, 'scroll.json');
  if (!path.startsWith(`${scrolls}${sep}`)) fail(`Invalid scroll selector: ${selector}`);
  const scroll = JSON.parse(await readFile(path, 'utf8'));
  if (scroll.schemaVersion !== 3 || scroll.boxId !== boxId || boxTargetId(scroll.target) !== targetId) {
    fail(`Invalid Scrollcase v3 scroll contract: ${selector}`);
  }
  return { scroll, selector };
}

/** Resolves the stable Liatir recipe ID to one canonical Scrollcase v3 selector. */
async function resolveScrollReference(name, targetOverride) {
  if (name.includes('/')) return readScroll(name);
  if (typeof targetOverride === 'string') return readScroll(`${name}/${targetOverride}`);
  const matches = [];
  const scrolls = getWorkspace().scrollsDir;
  for (const boxId of await readdir(scrolls).catch(() => [])) {
    const boxDirectory = join(scrolls, boxId);
    for (const targetId of await readdir(boxDirectory).catch(() => [])) {
      try {
        const candidate = await readScroll(`${boxId}/${targetId}`);
        if (candidate.scroll.scrollId === name) matches.push(candidate);
      } catch {
        // Invalid or unrelated filesystem entries are not candidates.
      }
    }
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail(`Scroll ID is ambiguous: ${name}`);
  fail(
    `Unsupported Runtime Box input: ${name}. Schema-v1 recipes are deprecated; `
      + 'migrate it to a canonical Scrollcase v3 scroll.',
  );
}

function replaceFirstPositional(values, replacement) {
  const result = [...values];
  for (let index = 0; index < result.length; index += 1) {
    if (result[index].startsWith('--')) {
      const [name, inline] = result[index].slice(2).split('=', 2);
      if (inline === undefined && VALUE_FLAGS.has(name)) index += 1;
      continue;
    }
    result[index] = replacement;
    return result;
  }
  return [replacement, ...result];
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
  if (release.schemaVersion !== 3 || release.kind !== 'liatir.runtime-box.release') {
    fail('Document is not a Liatir Runtime Box release.');
  }
  const archivePath = resolve(String(flags.get('archive')
    || runtimeBoxArchivePath(releasePath, release)));
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
    forwarded = withoutFlags(forwarded, ['namespace']);
    forwarded.push('--namespace', LIATIR_SCROLLCASE_NAMESPACE);
  }
  if (command === 'build') {
    if (flags.has('signer-command')) {
      fail('Liatir owns the protected signer command; pass --signer and --signer-audience.');
    }
    forwarded = withoutFlags(forwarded, ['signer', 'signer-audience']);
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

async function builtReleasePath(scroll) {
  const directory = join(
    getWorkspace().distDir,
    'boxes',
    scroll.boxId,
    scroll.version,
    boxTargetId(scroll.target),
  );
  const candidates = (await readdir(directory))
    .filter((name) => name.endsWith('.release.json'));
  if (candidates.length !== 1) {
    fail(`Expected exactly one built v2 release in ${directory}; found ${candidates.length}.`);
  }
  return join(directory, candidates[0]);
}

async function runPublishedCommand(command, values, parsed, options, selected = null) {
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
    const releasePath = await builtReleasePath(selected.scroll);
    const receipt = await verificationReceipt(releasePath, parsed.flags, { selfTest: true });
    await writeReceipt(parsed.flags.get('receipt'), receipt);
  }
}

export function usage() {
  console.log(`Usage: npm run runtime-box -- <command> [options]

Generic box commands (published Scrollcase):
  doctor                         Report whether this machine can build
  keygen                         Create a local Ed25519 signing key
  lock <scroll>                  Regenerate a pixi dependency lock
  audit <scroll>                 Derive and optionally write the licence inventory
  build <scroll>                 Build, self-test, archive, and sign a box
  verify <release.json>          Verify signature, archive hash, and layout

Liatir distribution commands:
  serve [--port 8790]            Serve local candidate Registry data
  publish <release.json>         Upload immutable release objects to R2
  publish-source-mirror <id>     Upload one allowlisted source mirror
  publish-key --bucket <name>    Publish the Worker public-key trust root
  promote <channel.json>         Promote a signed channel through the Worker
  revoke --box --version         Create a signed revocation document

Liatir always builds with namespace ${LIATIR_SCROLLCASE_NAMESPACE}. Protected builds
translate --signer and --signer-audience into Scrollcase's external signer command.
`);
}

/** Stable Liatir dispatcher. Schema-v1 authoring is unsupported; distribution remains local. */
export async function dispatchRuntimeBox(command, values, options = {}) {
  if (!command || command === 'help' || command === '--help') return usage();
  const parsed = parseRuntimeBoxArguments(values);
  configureWorkspace({ overrides: workspaceOverridesFromFlags(parsed.flags) });
  const distributionCommand = options.distributionCommand ?? runRuntimeBoxDistributionCommand;
  if (DISTRIBUTION_COMMANDS.has(command)) {
    return distributionCommand(command, values);
  }
  if (command === 'doctor' || command === 'keygen' || command === 'verify') {
    return runPublishedCommand(command, values, parsed, options);
  }
  if (command === 'lock' || command === 'audit' || command === 'build') {
    const name = parsed.positional[0] || fail(`${command} requires a scroll name.`);
    const selected = await resolveScrollReference(name, parsed.flags.get('target'));
    const forwarded = replaceFirstPositional(values, selected.selector);
    return runPublishedCommand(
      command,
      forwarded,
      parseRuntimeBoxArguments(forwarded),
      options,
      selected,
    );
  }
  fail(`Unknown command: ${command}`);
}
