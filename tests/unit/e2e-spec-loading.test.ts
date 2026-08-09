import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const specsDir = resolve("tests/e2e/specs");
const specs = readdirSync(specsDir).filter((file) => file.endsWith(".e2e.mjs"));

/**
 * The e2e runner imports every spec in the directory before it runs anything, so one that fails to
 * link takes the whole suite down — and a heavy spec that nothing else touches can stay broken for
 * weeks without a single red build. `runtime-box-scgpt-native` and `runtime-box-uce-native` both
 * imported `macosArm64MetalRuntimeBoxTarget` for three weeks after it was replaced, which made
 * `npm run test:ui` fail outright, heavy or not.
 *
 * Importing is cheap and needs no app, no binary and no network: a spec only declares its tests at
 * module scope. That is exactly the part that broke, so it is the part worth guarding here rather
 * than behind a gate nobody runs before a release.
 *
 * The check runs in a real Node process on purpose. Vitest resolves a missing named export to
 * `undefined` instead of refusing to link, so importing these specs through the test runner reports
 * success on exactly the files the e2e runner cannot load — the first version of this guard passed
 * against the broken spec. Only plain Node reproduces what the runner does.
 */
function loadsInNode(file: string): { status: number | null; stderr: string } {
  const url = pathToFileURL(resolve(specsDir, file)).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)});
      if (!Array.isArray(m.tests) || m.tests.length === 0) {
        throw new Error('spec does not export a non-empty tests array');
      }`],
    { encoding: "utf8", cwd: resolve(".") },
  );
  return { status: result.status, stderr: result.stderr };
}

describe("end-to-end spec loading", () => {
  it("finds the spec directory", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it.each(specs)("loads %s in Node and declares at least one test", (file) => {
    const { status, stderr } = loadsInNode(file);
    expect(status, `${file} failed to load:\n${stderr}`).toBe(0);
  });

  // Which spec a release runs is checked in runtime-box-ci-catalog: it comes from the catalog, per
  // model. This file only answers the other half — that the spec it names can actually be loaded.
  it("covers every spec a model routes its product lifecycle to", () => {
    const catalog = JSON.parse(readFileSync(resolve("runtime-boxes/catalog.json"), "utf8"));
    for (const model of catalog.models) {
      const routed = String(model.productLifecycleSpec ?? "");
      expect(routed, `${model.modelId} routes no product lifecycle spec`).not.toBe("");
      expect(specs, `${routed} is routed but not in the spec directory`)
        .toContain(routed.split("/").pop());
    }
  });
});
