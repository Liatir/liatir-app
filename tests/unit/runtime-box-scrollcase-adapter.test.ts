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
import { boxReleaseStem } from 'scrollcase/build';
import {
  generateSigningKey,
  signDocument,
  verifySignedDocument,
} from 'scrollcase/sign';
import {
  dispatchRuntimeBox,
  LIATIR_SCROLLCASE_NAMESPACE,
} from '../../scripts/runtime-box/scrollcase-adapter.mjs';
import { runLegacyRuntimeBoxCommand } from '../../scripts/runtime-box/legacy-cli.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function workspace(recipeId: string, recipe: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'liatir-scrollcase-adapter-'));
  temporaryDirectories.push(root);
  const recipeDir = join(root, 'recipes', recipeId);
  mkdirSync(recipeDir, { recursive: true });
  writeFileSync(join(root, 'scrollcase.config.json'), `${JSON.stringify({
    version: 1,
    paths: {
      recipes: 'recipes',
      build: 'build',
      dist: 'dist',
      keys: 'keys',
    },
  }, null, 2)}\n`);
  writeFileSync(join(recipeDir, 'recipe.json'), `${JSON.stringify({
    schemaVersion: 1,
    recipeId,
    ...recipe,
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
    const recipeId = 'synthetic-pixi';
    const root = workspace(recipeId, { pixiVersion: '0.73.0' });
    const calls: Array<{ command: string; args: string[] }> = [];

    await dispatchRuntimeBox('build', [
      recipeId,
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

  it('keeps the temporary uv and permanent distribution paths explicit and Liatir-owned', async () => {
    const root = workspace('legacy-uv', { uvVersion: '0.11.28' });
    const legacyCalls: Array<{ command: string; args: string[] }> = [];
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    const legacyCommand = async (command: string, args: string[]) => {
      legacyCalls.push({ command, args });
    };

    await dispatchRuntimeBox('build', [
      'legacy-uv',
      '--project-root', root,
    ], { legacyCommand });
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
      ], { legacyCommand });
    }

    expect(warning).toHaveBeenCalledWith(
      'runtime-box: legacy-uv remains on the temporary uv compatibility path.',
    );
    expect(legacyCalls.map(({ command }) => command)).toEqual([
      'build',
      'publish',
      'publish-key',
      'promote',
      'revoke',
      'serve',
    ]);
  });

  it('refuses to let the temporary legacy module build or lock a pixi recipe', async () => {
    const root = workspace('synthetic-pixi', {
      pixiVersion: '0.73.0',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
      pythonEntryPoint: 'venv/bin/python',
    });
    await expect(runLegacyRuntimeBoxCommand('lock', [
      'synthetic-pixi',
      '--project-root', root,
    ])).rejects.toThrow(/must be locked through the published Scrollcase CLI/);
    await expect(runLegacyRuntimeBoxCommand('build', [
      'synthetic-pixi',
      '--project-root', root,
    ])).rejects.toThrow(/must be built through the published Scrollcase CLI/);
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
      schemaVersion: 1,
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
    const releasePath = join(dist, `${boxReleaseStem(release)}.release.json`);
    writeFileSync(join(dist, `${boxReleaseStem(release)}.zip`), archive);
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
      '--project-root', root,
    ]);

    const documentPath = join(root, 'dist', 'runtime-box-revocations.json');
    const payload = await verifySignedDocument(
      JSON.parse(readFileSync(documentPath, 'utf8')),
      publicPath,
    );
    expect(payload).toMatchObject({
      schemaVersion: 1,
      kind: 'liatir.runtime-box.revocations',
      revocations: [{
        boxId: 'synthetic-box',
        version: '1.0.0',
        reason: 'Synthetic withdrawal',
      }],
    });
  });
});
