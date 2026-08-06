import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from '../../packages/liatir-cli/src/commands/build';
import {
  bundleSigningDigest,
  generateKeypair,
  writePrivateKey,
  type BundleEntry,
} from '../../packages/liatir-cli/src/signing';

const rootDir = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const JSZip = require(resolve(rootDir, 'packages/liatir-cli/node_modules/jszip')) as any;

const SIG_META = new Set(['_sig_alg', '_pubkey', '_signature']);
let tmpRoots: string[] = [];
let previousKeyEnv: string | undefined;

function makePythonProject(root: string): string {
  const projectDir = join(root, 'signed-plugin');
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  writeFileSync(join(projectDir, '.lia-manifest.json'), JSON.stringify({
    name: 'Signed Plugin', version: '1.0.0', description: 'x', runtime: 'python',
    inputSchema: { text: { type: 'string', required: true } },
    outputSchema: { length: { type: 'number' } },
    python: { entry: 'src/main.py' },
  }, null, 2));
  writeFileSync(join(projectDir, 'src', 'main.py'), "def main(input):\n    return {'length': len(str(input.get('text','')))}\n");
  return projectDir;
}

async function buildIn(projectDir: string): Promise<any> {
  const previousCwd = process.cwd();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(projectDir);
    await build();
  } finally {
    process.chdir(previousCwd);
    logSpy.mockRestore();
  }
  const name = readdirSync(join(projectDir, '.liatir')).find((n) => n.endsWith('.lia'))!;
  return JSZip.loadAsync(readFileSync(join(projectDir, '.liatir', name)));
}

/** Re-derive the digest over the bundle's non-signature entries (mirrors Rust). */
async function bundleEntries(zip: any): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = [];
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    entries.push({ name, content: Buffer.from(await zip.file(name).async('nodebuffer')) });
  }
  return entries;
}

beforeEach(() => {
  previousKeyEnv = process.env.LIATIR_SIGNING_KEY;
});

afterEach(() => {
  if (previousKeyEnv === undefined) delete process.env.LIATIR_SIGNING_KEY;
  else process.env.LIATIR_SIGNING_KEY = previousKeyEnv;
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
  tmpRoots = [];
});

describe('.lia Ed25519 signing', () => {
  it('signs the bundle and the signature verifies over the canonical digest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lia-sign-'));
    tmpRoots.push(root);
    const keyPath = join(root, 'key.pem');
    process.env.LIATIR_SIGNING_KEY = keyPath;
    await writePrivateKey(keyPath, generateKeypair().privateKeyPem);

    const zip = await buildIn(makePythonProject(root));

    expect(await zip.file('_sig_alg').async('string')).toBe('ed25519');
    const pub = Buffer.from(await zip.file('_pubkey').async('string'), 'base64');
    const sig = Buffer.from(await zip.file('_signature').async('string'), 'base64');
    expect(pub.length).toBe(32);
    expect(sig.length).toBe(64);

    const digest = bundleSigningDigest(await bundleEntries(zip));
    const keyObj = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') },
      format: 'jwk',
    });
    expect(crypto.verify(null, digest, keyObj, sig)).toBe(true);

    // Tampering with the manifest must break verification.
    const tamperedEntries = (await bundleEntries(zip)).map((e) =>
      e.name === 'manifest.json' ? { ...e, content: Buffer.concat([e.content, Buffer.from(' ')]) } : e,
    );
    const tamperedDigest = bundleSigningDigest(tamperedEntries.filter((e) => !SIG_META.has(e.name)));
    expect(crypto.verify(null, tamperedDigest, keyObj, sig)).toBe(false);
  });

  it('builds an unsigned bundle when no signing key is configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lia-unsigned-'));
    tmpRoots.push(root);
    process.env.LIATIR_SIGNING_KEY = join(root, 'does-not-exist.pem');

    const zip = await buildIn(makePythonProject(root));
    expect(zip.file('_signature')).toBeNull();
    expect(zip.file('_pubkey')).toBeNull();
    // The bundle is still a valid .lia (magic present).
    expect(await zip.file('_sig').async('string')).toBe('LIATIR/1');
  });

  it('produces a digest independent of entry insertion order', () => {
    const a: BundleEntry[] = [
      { name: 'b.txt', content: Buffer.from('two') },
      { name: 'a.txt', content: Buffer.from('one') },
    ];
    const b: BundleEntry[] = [
      { name: 'a.txt', content: Buffer.from('one') },
      { name: 'b.txt', content: Buffer.from('two') },
    ];
    expect(bundleSigningDigest(a).equals(bundleSigningDigest(b))).toBe(true);
  });
});
