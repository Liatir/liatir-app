import {
  createHash,
  createPrivateKey,
  sign as signBytes,
} from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  signDocument,
} from 'scrollcase/sign';
import {
  liatirSignerCommand,
  readSignerPayload,
  signPayloadWithPrivateService,
  signerIdentityToken,
} from '../../scripts/runtime-box/signer-command.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

async function signingFixture() {
  const root = await mkdtemp(join(tmpdir(), 'liatir-signer-command-'));
  temporaryDirectories.push(root);
  const privatePath = join(root, 'private.pem');
  const publicPath = join(root, 'public.json');
  const key = await generateSigningKey({
    privatePath,
    publicPath,
    keyId: 'liatir-test-key',
  });
  return {
    ...key,
    privateKey: createPrivateKey(await readFile(privatePath, 'utf8')),
  };
}

function envelope(
  payload: Buffer,
  fixture: Awaited<ReturnType<typeof signingFixture>>,
  signedBytes = payload,
) {
  return {
    schemaVersion: 2,
    payloadEncoding: 'base64-json-utf8',
    payloadBase64: payload.toString('base64'),
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
    signatures: [{
      algorithm: 'ed25519',
      keyId: fixture.keyId,
      signatureBase64: signBytes(null, signedBytes, fixture.privateKey).toString('base64'),
    }],
  };
}

describe('Liatir Scrollcase signer command', () => {
  it('reads exact payload bytes from stdin without relying on numeric file descriptors', async () => {
    const payload = Buffer.from('{"schemaVersion":2}\\n', 'utf8');
    expect(await readSignerPayload(Readable.from([
      payload.subarray(0, 7),
      payload.subarray(7),
    ]))).toEqual(payload);
  });

  it('preserves quoted Windows executable and script paths without a shell', async () => {
    const fixture = await signingFixture();
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const script = 'C:\\Liatir Workspace\\scripts\\runtime-box\\signer-command.mjs';
    let invocation: { executable: string; args: string[] } | null = null;

    await signDocument({ kind: 'liatir.runtime-box.release' }, {
      signerCommand: liatirSignerCommand({
        signerUrl: 'https://signer.example',
        audience: 'https://signer.example',
        nodeExecutable: node,
        signerScript: script,
      }),
      publicPath: fixture.publicPath,
      runResult: (executable, args, options) => {
        invocation = { executable, args };
        return {
          status: 0,
          stdout: JSON.stringify(envelope(Buffer.from(options.input), fixture)),
          stderr: '',
        };
      },
    });

    expect(invocation).toEqual({
      executable: node,
      args: [
        script,
        '--signer',
        'https://signer.example',
        '--audience',
        'https://signer.example',
      ],
    });
  });

  it('lets Scrollcase reject payload substitution and invalid signatures', async () => {
    const fixture = await signingFixture();
    const command = liatirSignerCommand({
      signerUrl: 'https://signer.example',
      nodeExecutable: '/node',
      signerScript: '/signer command.mjs',
    });

    await expect(signDocument({ value: 'expected' }, {
      signerCommand: command,
      publicPath: fixture.publicPath,
      runResult: (_executable, _args, options) => {
        const substituted = Buffer.from('{"value":"substituted"}\n');
        return {
          status: 0,
          stdout: JSON.stringify(envelope(substituted, fixture)),
          stderr: '',
        };
      },
    })).rejects.toThrow(/different payload/);

    await expect(signDocument({ value: 'expected' }, {
      signerCommand: command,
      publicPath: fixture.publicPath,
      runResult: (_executable, _args, options) => {
        const payload = Buffer.from(options.input);
        return {
          status: 0,
          stdout: JSON.stringify(envelope(payload, fixture, Buffer.from('wrong bytes'))),
          stderr: '',
        };
      },
    })).rejects.toThrow(/no valid signature/i);
  });

  it('lets Scrollcase reject malformed JSON and non-zero signer exits', async () => {
    const fixture = await signingFixture();
    const command = liatirSignerCommand({
      signerUrl: 'https://signer.example',
      nodeExecutable: '/node',
      signerScript: '/signer.mjs',
    });
    await expect(signDocument({}, {
      signerCommand: command,
      publicPath: fixture.publicPath,
      runResult: () => ({ status: 0, stdout: 'not json', stderr: '' }),
    })).rejects.toThrow(/did not return a JSON document/);
    await expect(signDocument({}, {
      signerCommand: command,
      publicPath: fixture.publicPath,
      runResult: () => ({ status: 23, stdout: '', stderr: 'bounded failure' }),
    })).rejects.toThrow(/exited with 23: bounded failure/);
  });

  it('sends the exact stdin payload to the private signer with a short-lived token', async () => {
    const payload = Buffer.from('{"kind":"liatir.runtime-box.release"}\n');
    let request: { url: string; init: RequestInit } | null = null;
    const document = { payloadBase64: payload.toString('base64') };
    const result = await signPayloadWithPrivateService(payload, {
      signerUrl: 'https://signer.example/',
      audience: 'https://signer.example',
      identityToken: 'short-lived-token',
      fetchImpl: async (url, init) => {
        request = { url: String(url), init: init! };
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(result).toEqual(document);
    expect(request?.url).toBe('https://signer.example/v1/sign');
    expect(request?.init.headers).toEqual({
      authorization: 'Bearer short-lived-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      payloadBase64: payload.toString('base64'),
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
    });
  });

  it('uses shell-free gcloud token acquisition and fails closed on malformed responses', async () => {
    let invocation: unknown[] = [];
    expect(signerIdentityToken({
      audience: 'https://signer.example',
      identityToken: '',
      runResult: (command, args, options) => {
        invocation = [command, args, options.capture];
        return { status: 0, stdout: 'gcloud-token\n', stderr: '' };
      },
    })).toBe('gcloud-token');
    expect(invocation).toEqual([
      'gcloud',
      ['auth', 'print-identity-token', '--audiences=https://signer.example'],
      true,
    ]);

    await expect(signPayloadWithPrivateService(Buffer.from('{}\n'), {
      signerUrl: 'https://signer.example',
      identityToken: 'token',
      fetchImpl: async () => ({
        ok: true,
        json: async () => { throw new Error('invalid json'); },
      } as Response),
    })).rejects.toThrow(/malformed JSON/);
  });

  it('does not echo credentials or private service bodies in failure diagnostics', async () => {
    expect(() => signerIdentityToken({
      identityToken: '',
      runResult: () => ({
        status: 9,
        stdout: 'secret-token',
        stderr: 'credential detail',
      }),
    })).toThrow('gcloud identity token failed with status 9.');
    try {
      await signPayloadWithPrivateService(Buffer.from('{}\n'), {
        signerUrl: 'https://signer.example',
        identityToken: 'secret-token',
        fetchImpl: async () => new Response('private service detail', { status: 403 }),
      });
      throw new Error('Expected private signer failure.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe('Private Runtime Box signing failed (403).');
      expect(message).not.toContain('secret-token');
      expect(message).not.toContain('private service detail');
    }
  });
});
