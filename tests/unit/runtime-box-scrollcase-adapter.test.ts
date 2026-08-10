import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxTargetId } from 'scrollcase/contract/browser';
import {
  generateSigningKey,
  signDocument,
  verifySignedDocument,
} from 'scrollcase/sign';
import {
  dispatchRuntimeBox,
  LIATIR_SCROLLCASE_NAMESPACE,
} from '../../scripts/runtime-box/scrollcase-adapter.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function workspace(scrollId: string, scroll: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'liatir-scrollcase-adapter-'));
  temporaryDirectories.push(root);
  const target = (scroll.target as Record<string, string> | undefined)
    ?? { platform: 'macos', arch: 'aarch64', accelerator: 'metal' };
  const boxId = String(scroll.boxId ?? 'synthetic-box');
  const targetId = boxTargetId(target as Parameters<typeof boxTargetId>[0]);
  const scrollDir = join(root, 'scrolls', boxId, targetId);
  mkdirSync(scrollDir, { recursive: true });
  writeFileSync(join(root, 'scrollcase.config.json'), `${JSON.stringify({
    version: 1,
    paths: {
      scrolls: 'scrolls',
      build: 'build',
      dist: 'dist',
      keys: 'keys',
    },
  }, null, 2)}\n`);
  writeFileSync(join(scrollDir, 'scroll.json'), `${JSON.stringify({
    schemaVersion: 2,
    scrollId,
    boxId,
    target,
    ...scroll,
  }, null, 2)}\n`);
  return root;
}

function fakePackageCli(calls: Array<{ command: string; args: string[] }>) {
  return {
    invocation: (
      packageName: string,
      publicExport: string,
      binName: string,
      args: string[],
    ) => {
      expect([packageName, publicExport, binName]).toEqual([
        'scrollcase',
        'contract',
        'scrollcase',
      ]);
      return { command: '/checked/node', args: ['/published/scrollcase-cli.mjs', ...args] };
    },
    runResult: (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

describe('Liatir Scrollcase adapter', () => {
  it('routes key generation through the installed published Scrollcase CLI', async () => {
    const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
    await dispatchRuntimeBox('keygen', ['--project-root', root]);
    expect(JSON.parse(readFileSync(
      join(root, 'keys', 'signing-public.json'),
      'utf8',
    ))).toMatchObject({
      algorithm: 'ed25519',
      keyId: expect.any(String),
      publicKeyBase64: expect.any(String),
    });
  });

  it('forces the frozen Liatir namespace and translates the private signer shell-free', async () => {
    const scrollId = 'synthetic-pixi';
    const root = workspace(scrollId, { pixiVersion: '0.73.0' });
    const calls: Array<{ command: string; args: string[] }> = [];

    await dispatchRuntimeBox('build', [
      scrollId,
      '--project-root', root,
      '--namespace', LIATIR_SCROLLCASE_NAMESPACE,
      '--signer', 'https://signer.example',
      '--signer-audience', 'https://signer.example',
      '--public-key', join(root, 'production public.json'),
    ], fakePackageCli(calls));

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('/checked/node');
    expect(calls[0].args.slice(0, 2)).toEqual([
      '/published/scrollcase-cli.mjs',
      'build',
    ]);
    expect(calls[0].args).toContain(LIATIR_SCROLLCASE_NAMESPACE);
    expect(calls[0].args.filter((value) => value === '--namespace')).toHaveLength(1);
    expect(calls[0].args).not.toContain('--signer');
    expect(calls[0].args).not.toContain('--signer-audience');
    const signerCommand = calls[0].args[calls[0].args.indexOf('--signer-command') + 1];
    expect(signerCommand).toContain('signer-command.mjs');
    expect(signerCommand).toContain('https://signer.example');
    expect(signerCommand).not.toContain('short-lived-token');
  });

  it('rejects a conflicting namespace before invoking Scrollcase', async () => {
    const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
    const calls: Array<{ command: string; args: string[] }> = [];
    await expect(dispatchRuntimeBox('build', [
      'synthetic-pixi',
      '--project-root', root,
      '--namespace', 'scrollcase.box',
    ], fakePackageCli(calls))).rejects.toThrow(
      /Liatir builds require --namespace liatir\.runtime-box/,
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects schema-v1 authoring while keeping distribution paths Liatir-owned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-scrollcase-adapter-v1-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'runtime-boxes', 'recipes', 'legacy-uv'), { recursive: true });
    writeFileSync(join(root, 'scrollcase.config.json'), `${JSON.stringify({
      version: 1,
      paths: { scrolls: 'scrolls', build: 'build', dist: 'dist', keys: 'keys' },
    })}\n`);
    writeFileSync(
      join(root, 'runtime-boxes', 'recipes', 'legacy-uv', 'recipe.json'),
      `${JSON.stringify({ schemaVersion: 1, recipeId: 'legacy-uv', uvVersion: '0.11.28' })}\n`,
    );
    const distributionCalls: Array<{ command: string; args: string[] }> = [];
    const distributionCommand = async (command: string, args: string[]) => {
      distributionCalls.push({ command, args });
    };

    await expect(dispatchRuntimeBox('build', [
      'legacy-uv',
      '--project-root', root,
    ], { distributionCommand })).rejects.toThrow(/Schema-v1 recipes are deprecated/);
    for (const [command, argument] of [
      ['publish', 'release.json'],
      ['publish-key', '--confirm'],
      ['promote', 'channel.json'],
      ['revoke', '--box'],
      ['serve', '--port'],
    ]) {
      await dispatchRuntimeBox(command, [
        argument,
        '--project-root', root,
      ], { distributionCommand });
    }

    expect(distributionCalls.map(({ command }) => command)).toEqual([
      'publish',
      'publish-key',
      'promote',
      'revoke',
      'serve',
    ]);
  });

  it('writes the existing compact receipt only after published verification succeeds', async () => {
    const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
    const keys = join(root, 'keys');
    const dist = join(root, 'dist');
    mkdirSync(keys, { recursive: true });
    mkdirSync(dist, { recursive: true });
    const privatePath = join(keys, 'signing-private.pem');
    const publicPath = join(keys, 'signing-public.json');
    await generateSigningKey({ privatePath, publicPath, keyId: 'liatir-receipt-key' });
    const archive = Buffer.from('synthetic verified archive');
    const archiveSha256 = createHash('sha256').update(archive).digest('hex');
    const release = {
      schemaVersion: 2,
      kind: 'liatir.runtime-box.release',
      boxId: 'synthetic-box',
      modelId: 'synthetic-model',
      runtimeId: 'synthetic-runtime',
      version: '1.0.0',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
      archive: {
        format: 'zip',
        url: `https://example.invalid/${archiveSha256}.zip`,
        sha256: archiveSha256,
        sizeBytes: archive.length,
      },
    };
    const releasePath = join(dist, `${archiveSha256}.release.json`);
    writeFileSync(join(dist, `${archiveSha256}.zip`), archive);
    writeFileSync(releasePath, `${JSON.stringify(await signDocument(release, {
      privatePath,
      publicPath,
    }), null, 2)}\n`);
    const receiptPath = join(root, 'receipts', 'verification.json');
    const calls: Array<{ command: string; args: string[] }> = [];

    await dispatchRuntimeBox('verify', [
      releasePath,
      '--project-root', root,
      '--public-key', publicPath,
      '--receipt', receiptPath,
    ], fakePackageCli(calls));

    expect(calls).toHaveLength(1);
    expect(calls[0].args).not.toContain('--receipt');
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      status: 'passed',
      localSignatureVerified: true,
      signingKeyIds: ['liatir-receipt-key'],
      releasePayloadSha256: JSON.parse(readFileSync(releasePath, 'utf8')).payloadSha256,
      archiveSha256,
      archiveSizeBytes: archive.length,
      selfTest: 'not-requested',
    });
  });

  it('does not write a receipt when Scrollcase exits unsuccessfully', async () => {
    const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
    const receiptPath = join(root, 'verification.json');
    await expect(dispatchRuntimeBox('verify', [
      join(root, 'missing.release.json'),
      '--project-root', root,
      '--receipt', receiptPath,
    ], {
      invocation: () => ({ command: '/node', args: ['/scrollcase.mjs'] }),
      runResult: () => ({ status: 7, stdout: '', stderr: '' }),
    })).rejects.toThrow(/Scrollcase exited with status 7/);
    expect(() => readFileSync(receiptPath, 'utf8')).toThrow();
  });

  it('keeps revocation in Liatir while using the shared Scrollcase envelope', async () => {
    const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
    const keys = join(root, 'keys');
    mkdirSync(keys, { recursive: true });
    const privatePath = join(keys, 'signing-private.pem');
    const publicPath = join(keys, 'signing-public.json');
    await generateSigningKey({ privatePath, publicPath, keyId: 'liatir-revocation-key' });

    await dispatchRuntimeBox('revoke', [
      '--box', 'synthetic-box',
      '--version', '1.0.0',
      '--reason', 'Synthetic withdrawal',
      '--no-carry-forward',
      '--project-root', root,
    ]);

    const documentPath = join(root, 'dist', 'runtime-box-revocations.json');
    const payload = await verifySignedDocument(
      JSON.parse(readFileSync(documentPath, 'utf8')),
      publicPath,
    );
    expect(payload).toMatchObject({
      schemaVersion: 2,
      kind: 'liatir.runtime-box.revocations',
      revocations: [{
        boxId: 'synthetic-box',
        version: '1.0.0',
        reason: 'Synthetic withdrawal',
      }],
    });
  });

  // The registry stores a revocations document whole and cannot merge into it — it holds one
  // signature over one exact byte string. Promoting a second single-entry document therefore used
  // to un-revoke the box withdrawn by the first. These four cases pin the two properties that
  // replace that trap: several entries per signature, and a live set that survives the next one.
  describe('revocation completeness', () => {
    async function revocationWorkspace(keyId: string) {
      const root = workspace('synthetic-pixi', { pixiVersion: '0.73.0' });
      const keys = join(root, 'keys');
      mkdirSync(keys, { recursive: true });
      const privatePath = join(keys, 'signing-private.pem');
      const publicPath = join(keys, 'signing-public.json');
      await generateSigningKey({ privatePath, publicPath, keyId });
      return { root, privatePath, publicPath };
    }

    const signedRevocations = async (
      revocations: Array<Record<string, unknown>>,
      keyPaths: { privatePath: string; publicPath: string },
    ) => signDocument({
      schemaVersion: 2,
      kind: 'liatir.runtime-box.revocations',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revocations,
    }, keyPaths);

    it('withdraws several boxes in one signed document', async () => {
      const { root, publicPath } = await revocationWorkspace('liatir-multi-revocation-key');

      await dispatchRuntimeBox('revoke', [
        '--box', 'geneformer-v1-10m', '--version', '1.0.0-beta.1',
        '--box', 'scgpt-whole-human', '--version', '0.2.5-beta.1',
        '--reason', 'superseded by the pixi/Scrollcase v2 toolchain',
        '--no-carry-forward',
        '--project-root', root,
      ]);

      const payload = await verifySignedDocument(
        JSON.parse(readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')),
        publicPath,
      ) as { revocations: Array<{ boxId: string; version: string; reason: string }> };
      expect(payload.revocations).toHaveLength(2);
      expect(payload.revocations.map(({ boxId, version }) => `${boxId} ${version}`)).toEqual([
        'geneformer-v1-10m 1.0.0-beta.1',
        'scgpt-whole-human 0.2.5-beta.1',
      ]);
      // A single --reason covers the whole batch rather than being dropped for the later entries.
      for (const entry of payload.revocations) {
        expect(entry.reason).toBe('superseded by the pixi/Scrollcase v2 toolchain');
      }
    });

    it('carries the live revocations forward so a new one cannot restore an old box', async () => {
      const { root, privatePath, publicPath } = await revocationWorkspace('liatir-carry-forward-key');
      const live = await signedRevocations([{
        boxId: 'geneformer-v1-10m',
        version: '1.0.0-beta.1',
        reason: 'superseded by 1.0.0-beta.2',
        revokedAt: '2026-01-01T00:00:00.000Z',
      }], { privatePath, publicPath });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        expect(String(input)).toBe('https://registry.invalid/v1/revocations');
        return new Response(JSON.stringify(live), { status: 200 });
      });

      await dispatchRuntimeBox('revoke', [
        '--box', 'scgpt-whole-human',
        '--version', '0.2.5-beta.1',
        '--reason', 'superseded by 0.2.5-beta.2',
        '--registry', 'https://registry.invalid',
        '--project-root', root,
      ]);

      const payload = await verifySignedDocument(
        JSON.parse(readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')),
        publicPath,
      ) as { revocations: Array<{ boxId: string; version: string; revokedAt: string }> };
      expect(payload.revocations.map(({ boxId }) => boxId)).toEqual([
        'geneformer-v1-10m',
        'scgpt-whole-human',
      ]);
      // The earlier withdrawal keeps the moment it actually happened.
      expect(payload.revocations[0].revokedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    // How the revocation workflow passes entries: a free-text reason reaching a production-signed
    // document must not depend on surviving shell quoting.
    it('reads the entries from a JSON plan file', async () => {
      const { root, publicPath } = await revocationWorkspace('liatir-plan-file-key');
      const planPath = join(root, 'plan.json');
      writeFileSync(planPath, `${JSON.stringify([
        { boxId: 'geneformer-v1-10m', version: '1.0.0-beta.1', reason: 'superseded by 1.0.0-beta.2' },
        { boxId: 'scgpt-whole-human', version: '0.2.5-beta.1', reason: 'superseded by 0.2.5-beta.2' },
      ])}\n`);

      await dispatchRuntimeBox('revoke', [
        '--from', planPath,
        '--no-carry-forward',
        '--project-root', root,
      ]);

      const payload = await verifySignedDocument(
        JSON.parse(readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')),
        publicPath,
      ) as { revocations: Array<{ boxId: string; version: string; reason: string }> };
      expect(payload.revocations).toEqual([
        expect.objectContaining({
          boxId: 'geneformer-v1-10m',
          version: '1.0.0-beta.1',
          reason: 'superseded by 1.0.0-beta.2',
        }),
        expect.objectContaining({
          boxId: 'scgpt-whole-human',
          version: '0.2.5-beta.1',
          reason: 'superseded by 0.2.5-beta.2',
        }),
      ]);
    });

    it('refuses a plan entry that is missing a field', async () => {
      const { root } = await revocationWorkspace('liatir-plan-field-key');
      const planPath = join(root, 'plan.json');
      writeFileSync(planPath, `${JSON.stringify([
        { boxId: 'geneformer-v1-10m', version: '1.0.0-beta.1' },
      ])}\n`);

      await expect(dispatchRuntimeBox('revoke', [
        '--from', planPath,
        '--no-carry-forward',
        '--project-root', root,
      ])).rejects.toThrow(/is missing "reason"/);
      expect(() => readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')).toThrow();
    });

    it('refuses to pair a --box with the wrong --version', async () => {
      const { root } = await revocationWorkspace('liatir-unpaired-revocation-key');

      await expect(dispatchRuntimeBox('revoke', [
        '--box', 'geneformer-v1-10m', '--version', '1.0.0-beta.1',
        '--box', 'scgpt-whole-human',
        '--reason', 'superseded by the pixi/Scrollcase v2 toolchain',
        '--no-carry-forward',
        '--project-root', root,
      ])).rejects.toThrow(/one --version per --box/);
      expect(() => readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')).toThrow();
    });

    it('fails rather than treating an unreadable live set as empty', async () => {
      const { root } = await revocationWorkspace('liatir-unreachable-registry-key');
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response('upstream failure', { status: 503 }),
      );

      await expect(dispatchRuntimeBox('revoke', [
        '--box', 'scgpt-whole-human',
        '--version', '0.2.5-beta.1',
        '--reason', 'superseded by 0.2.5-beta.2',
        '--registry', 'https://registry.invalid',
        '--project-root', root,
      ])).rejects.toThrow(/Cannot read the current revocations \(503\)/);
      expect(() => readFileSync(join(root, 'dist', 'runtime-box-revocations.json'), 'utf8')).toThrow();
    });
  });

  // Deletion guard. The distribution module used to carry a second, Liatir-owned builder beside
  // these commands; Scrollcase owns building now, and a builder growing back here would mean two
  // implementations of one archive format again — the exact drift P5 exists to end.
  it('keeps the distribution module free of any local builder', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/runtime-box/distribution-cli.mjs'),
      'utf8',
    );
    for (const forbidden of [
      './licenses.mjs',
      './pixi.mjs',
      './python.mjs',
      'createDeterministicZip',
      'findUv',
      'buildRecipe',
      'lockRecipe',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
