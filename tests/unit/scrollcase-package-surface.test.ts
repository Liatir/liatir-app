import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as build from "scrollcase/build";
import {
  fixtureUrl,
  schemaUrl,
} from "scrollcase/contract";
import * as browserContract from "scrollcase/contract/browser";
import * as contract from "scrollcase/contract";
import * as consumer from "scrollcase/consumer";
import * as sign from "scrollcase/sign";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "node_modules/scrollcase/package.json"), "utf8"));
const rootPackageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const corePackageJson = JSON.parse(
  readFileSync(resolve(root, "packages/liatir-core/package.json"), "utf8"),
);
const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));

const expectedExports = {
  "./contract": {
    types: "./src/contract/index.d.mts",
    import: "./src/contract/index.mjs",
  },
  "./contract/browser": {
    types: "./src/contract/browser.d.mts",
    import: "./src/contract/browser.mjs",
  },
  "./contract/types": {
    types: "./src/contract/types/index.d.ts",
  },
  "./build": {
    types: "./src/build/index.d.mts",
    import: "./src/build/index.mjs",
  },
  "./consumer": {
    types: "./src/consumer/index.d.mts",
    import: "./src/consumer/index.mjs",
  },
  "./contract/schema/*.json": "./src/contract/schema/*.json",
  "./contract/fixtures/*.json": "./src/contract/fixtures/*.json",
  "./sign": {
    types: "./src/sign/index.d.mts",
    import: "./src/sign/index.mjs",
  },
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "target" || entry === "build") {
      return [];
    }
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|mjs|js|svelte)$/.test(entry) ? [path] : [];
  });
}

describe("published Scrollcase package surface", () => {
  it("pins the immutable package and all required public entry points", () => {
    expect(packageJson.name).toBe("scrollcase");
    expect(packageJson.version).toBe("0.7.1");
    expect(packageJson.bin).toEqual({ scrollcase: "src/cli.mjs" });
    expect(packageJson.exports).toEqual(expectedExports);
    expect(rootPackageJson.dependencies.scrollcase).toBe("0.7.1");
    expect(corePackageJson.dependencies.scrollcase).toBe("0.7.1");
    expect(lockfile.packages["node_modules/scrollcase"]).toMatchObject({
      version: "0.7.1",
      resolved: "https://registry.npmjs.org/scrollcase/-/scrollcase-0.7.1.tgz",
      integrity: "sha512-xVeJkv4JJTeUqBFoHeZ4zcUAN5RTB8RWuFjthI6JWXzA3lj1qq2r4OvGKJOwYkUORCJycTF3VaFv0ndnnOyjQQ==",
    });
  });

  it("loads every representative runtime, schema, fixture, signing, and build API", () => {
    expect(contract.boxTargetId).toBeTypeOf("function");
    expect(contract.isSignedBoxDocument).toBeTypeOf("function");
    expect(browserContract.boxTargetId).toBeTypeOf("function");
    expect(browserContract.isSignedBoxDocument).toBeTypeOf("function");
    expect(build.createDeterministicZip).toBeTypeOf("function");
    expect(build.boxReleaseStem).toBeTypeOf("function");
    expect(consumer.verifyAndExtractBox).toBeTypeOf("function");
    expect(consumer.runExtractedBox).toBeTypeOf("function");
    expect(consumer.runBox).toBeTypeOf("function");
    expect(sign.signDocument).toBeTypeOf("function");
    expect(sign.verifySignedDocument).toBeTypeOf("function");
    expect(JSON.parse(readFileSync(schemaUrl("release-manifest"), "utf8")).$id)
      .toBe("https://scrollcase.dev/schema/v2/release-manifest.schema.json");
    expect(JSON.parse(readFileSync(fixtureUrl("target-id-contract"), "utf8")).valid)
      .toBeInstanceOf(Array);
  });

  it("compiles a strict TypeScript consumer against declarations from the tarball", () => {
    const result = spawnSync(process.execPath, [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--types",
      "node",
      resolve(root, "tests/fixtures/scrollcase-published-consumer.ts"),
    ], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("does not leak external Scrollcase references into the generated browser SDK", () => {
    const generatedSdk = readFileSync(
      resolve(root, "frontend/src/lib/liatir-sdk-types.ts"),
      "utf8",
    );
    expect(generatedSdk).not.toMatch(/\bscrollcase\b/i);
  });

  it("rejects unpublished deep imports and sibling or file dependencies", async () => {
    const unpublishedDeepImport = "scrollcase/src/contract/index.mjs";
    await expect(import(/* @vite-ignore */ unpublishedDeepImport)).rejects
      .toThrow(/Missing ".+" specifier in "scrollcase" package/);

    const dependencyFiles = [
      resolve(root, "package.json"),
      resolve(root, "packages/liatir-core/package.json"),
      resolve(root, "package-lock.json"),
    ];
    for (const path of dependencyFiles) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/["']scrollcase["']\s*:\s*["'](?:file:|link:|\.\.?\/)/);
    }

    const publicSpecifiers = new Set([
      "scrollcase/contract",
      "scrollcase/contract/browser",
      "scrollcase/contract/types",
      "scrollcase/build",
      "scrollcase/consumer",
      "scrollcase/sign",
    ]);
    for (const path of sourceFiles(resolve(root, "packages"))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/from\s+["'](scrollcase[^"']*)["']/g)) {
        expect(publicSpecifiers.has(match[1]), `${path}: ${match[1]}`).toBe(true);
      }
      expect(source).not.toContain("/Users/lorenzo/Documents/GitHub/scrollcase");
    }
  });

  it("discovers the Liatir workspace through the installed CLI without downloading tools", () => {
    const cli = resolve(root, "node_modules/scrollcase/src/cli.mjs");
    const help = spawnSync(process.execPath, [cli, "--help"], { cwd: root, encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: scrollcase <command> [options]");

    const doctor = spawnSync(process.execPath, [
      cli,
      "doctor",
      "--config",
      "scrollcase.config.json",
      "--pixi-version",
      "0.50.0",
    ], {
      cwd: root,
      encoding: "utf8",
    });
    expect([0, 1]).toContain(doctor.status);
    expect(doctor.stdout).toContain(`config ${resolve(root, "scrollcase.config.json")}`);
    expect(doctor.stdout).toContain("scrolls");
    expect(doctor.stdout).toContain(resolve(root, "runtime-boxes/scrolls"));
  });
});
