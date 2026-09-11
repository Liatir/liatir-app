import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeSignedDocument,
  generateSigningKey,
  signDocument,
  verifySignedDocument,
} from "scrollcase/sign";
import {
  BOX_SCHEMA_VERSION,
  isSignedBoxDocument,
  schemaUrl,
} from "scrollcase/contract";
import {
  boxReleaseObjectPrefix,
  boxReleaseStem,
} from "scrollcase/build";
import {
  isLiatirSignedRuntimeBoxDocument,
  runtimeBoxTargetId,
  type LiatirRuntimeBoxChannelManifest,
  type LiatirRuntimeBoxReleaseManifest,
  type LiatirRuntimeBoxRevocationsManifest,
} from "../../packages/liatir-core/src/runtime-box";
import {
  runtimeBoxArchivePath,
  runtimeBoxChannelDocumentPath,
} from "../../scripts/runtime-box/identity.mjs";
import {
  isRevocationsManifest,
  parseImmutableReleaseIdentity,
  validateChannelRoute,
  validateImmutableReleaseRoute,
} from "../../workers/runtime-box-registry/src/index";

interface CompatibilityFixtures {
  release: LiatirRuntimeBoxReleaseManifest;
  channel: LiatirRuntimeBoxChannelManifest;
  revocations: LiatirRuntimeBoxRevocationsManifest;
  expected: {
    targetId: string;
    releaseStem: string;
    releaseObjectPrefix: string;
  };
}

const fixtures = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../runtime-boxes/contract-compatibility-fixtures.json"),
    "utf8",
  ),
) as CompatibilityFixtures;

const schemaNames = [
  "target",
  "execution",
  "scroll",
  "box-manifest",
  "release-manifest",
  "channel-manifest",
  "revocations-manifest",
  "signed-document",
] as const;

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const name of schemaNames) {
  ajv.addSchema(JSON.parse(readFileSync(schemaUrl(name), "utf8")));
}

const signingDirectory = mkdtempSync(resolve(tmpdir(), "liatir-scrollcase-contract-"));
const privatePath = resolve(signingDirectory, "signing-private.pem");
const publicPath = resolve(signingDirectory, "signing-public.json");

beforeAll(async () => {
  await generateSigningKey({
    privatePath,
    publicPath,
    keyId: "liatir-scrollcase-contract-test",
  });
});

afterAll(() => {
  rmSync(signingDirectory, { recursive: true, force: true });
});

function expectSchema(name: typeof schemaNames[number], value: unknown): void {
  const schema = JSON.parse(readFileSync(schemaUrl(name), "utf8"));
  const valid = ajv.validate(schema.$id, value);
  expect(valid, JSON.stringify(ajv.errors, null, 2)).toBe(true);
}

describe("Liatir contract inversion over Scrollcase", () => {
  it("validates Liatir release, channel, and revocation payloads through published schemas", () => {
    expectSchema("release-manifest", fixtures.release);
    expectSchema("channel-manifest", fixtures.channel);
    expectSchema("revocations-manifest", fixtures.revocations);

    expect(fixtures.release.kind).toBe("liatir.runtime-box.release");
    expect(fixtures.release.compatibility).toMatchObject({
      minLiatirVersion: "0.2.1",
      maxLiatirVersionExclusive: "1.0.0",
      hostEnvironments: ["native"],
    });
    expect(fixtures.channel.kind).toBe("liatir.runtime-box.channel");
    expect(fixtures.revocations.kind).toBe("liatir.runtime-box.revocations");
    expect(JSON.stringify(fixtures)).not.toContain("scrollcase.box");
  });

  it("keeps target and immutable object identity byte-compatible", () => {
    expect(BOX_SCHEMA_VERSION).toBe(3);
    expect(runtimeBoxTargetId(fixtures.release.target)).toBe(fixtures.expected.targetId);
    expect(boxReleaseStem(fixtures.release)).toBe(fixtures.expected.releaseStem);
    expect(boxReleaseObjectPrefix(fixtures.release)).toBe(fixtures.expected.releaseObjectPrefix);

    // A built box is laid out exactly as the bucket serves it, so the archive sits beside its
    // release document under its own SHA-256 — not under the shared stem, which is only a name
    // for the pair. Verification and publication must agree on this: they did not, and a
    // stem-named lookup passed verify and then failed publish after a full signed build.
    // Built with `join` on both sides: the helper returns native separators, so a literal
    // forward-slash expectation only holds off Windows.
    const releaseDirectory = join("dist", ...fixtures.expected.releaseObjectPrefix.split("/"));
    expect(runtimeBoxArchivePath(
      join(releaseDirectory, "abc.release.json"),
      fixtures.release,
    )).toBe(join(releaseDirectory, `${fixtures.release.archive.sha256}.zip`));
    for (const module of ['distribution-cli.mjs', 'scrollcase-adapter.mjs']) {
      const source = readFileSync(resolve(`scripts/runtime-box/${module}`), 'utf8');
      expect(source, module).toContain('runtimeBoxArchivePath(');
      // The bucket object key is still built inline and should be — it is a key, not a path.
      // What must not come back is a second local resolution beside the release document.
      expect(source, `${module} must not resolve the archive path itself`)
        .not.toContain('dirname(releasePath)');
    }

    // A channel is filed by channel, not by version. The release orchestration told promote where
    // to find it and the local registry served it from somewhere else; only the second matched the
    // builder, so promote failed after a box was already published immutably.
    expect(runtimeBoxChannelDocumentPath('.runtime-box-dist', 'scgpt-whole-human', 'beta', 'macos-aarch64-metal'))
      .toBe(join('.runtime-box-dist', 'channels', 'scgpt-whole-human', 'beta', 'macos-aarch64-metal.json'));
    for (const module of ['scripts/runtime-box-ci.mjs', 'scripts/runtime-box/distribution-cli.mjs']) {
      const source = readFileSync(resolve(module), 'utf8');
      expect(source, module).toContain('runtimeBoxChannelDocumentPath(');
      expect(source, `${module} must not name a channel document itself`)
        .not.toContain('.channel.json');
    }

    const route = parseImmutableReleaseIdentity(
      fixtures.release.boxId,
      fixtures.release.version,
      fixtures.expected.targetId,
      fixtures.release.archive.sha256,
    );
    expect(route).not.toBeNull();
    expect(validateImmutableReleaseRoute(fixtures.release, route!)).toBe(true);
    expect(validateChannelRoute(
      fixtures.channel,
      fixtures.channel.channel,
      fixtures.channel.boxId,
      fixtures.expected.targetId,
    )).toBe(true);
    expect(isRevocationsManifest(fixtures.revocations)).toBe(true);
  });

  it("signs and verifies the exact Liatir payload bytes with the shared envelope", async () => {
    for (const payload of [fixtures.release, fixtures.channel, fixtures.revocations]) {
      const expectedBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      const signed = await signDocument(payload, { privatePath, publicPath });

      expectSchema("signed-document", signed);
      expect(isSignedBoxDocument(signed)).toBe(true);
      expect(isLiatirSignedRuntimeBoxDocument(signed)).toBe(true);
      expect(signed.schemaVersion).toBe(3);
      expect(signed.payloadEncoding).toBe("base64-json-utf8");
      expect(signed.signatures[0].algorithm).toBe("ed25519");
      expect(Buffer.from(signed.payloadBase64, "base64")).toEqual(expectedBytes);
      expect(decodeSignedDocument(signed).bytes).toEqual(expectedBytes);
      expect(await verifySignedDocument(signed, publicPath)).toEqual(payload);
    }
  });

  it("rejects schema-v1 signed envelopes instead of retaining a compatibility path", () => {
    expect(isLiatirSignedRuntimeBoxDocument({
      schemaVersion: 1,
      payloadEncoding: "base64-json-utf8",
      payloadBase64: "e30=",
      payloadSha256: "0".repeat(64),
      signatures: [{
        keyId: "legacy-v1",
        algorithm: "ed25519",
        signatureBase64: "AA==",
      }],
    })).toBe(false);
  });
});
