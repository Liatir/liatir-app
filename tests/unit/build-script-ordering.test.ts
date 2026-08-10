import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `packages/liatir-core/dist` is compiled output that `src-ts` imports by relative path
 * (`src-ts/modules/qc/_types.ts`), and `tsconfig.json` maps `@liatir/core` onto it. So every script
 * that type-checks or bundles `src-ts` has to build the core package first.
 *
 * This class of break is invisible on a developer machine: `dist/` survives between runs, so the
 * dependency looks satisfied by luck. Only a clean checkout exercises it — which is every CI run.
 * `browser-api:build` was missing the step, so `gen:sdk-types` (and with it the whole `verify`
 * profile, whose `core-build` suite runs *after* `sdk-types`) failed on CI with
 * `TS2307: Cannot find module '../../../packages/liatir-core/dist'` while passing locally. The two
 * publish scripts route through the same entry point and were failing the same way.
 */
const CORE_BUILD = "npm run build --prefix packages/liatir-core";
/** The commands that actually read `src-ts` — as opposed to the ones that delegate to them. */
const COMPILES_SRC_TS = /scripts\/build-browser-api\.mjs|tsc -p tsconfig(\.browser-api)?\.json/;

const scripts: Record<string, string> = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).scripts;

describe("root build script ordering", () => {
  it("builds the core package before anything that compiles src-ts", () => {
    const offenders = Object.entries(scripts)
      .filter(([, command]) => COMPILES_SRC_TS.test(command))
      .filter(([, command]) => {
        const compilesAt = command.search(COMPILES_SRC_TS);
        const buildsCoreAt = command.indexOf(CORE_BUILD);
        return buildsCoreAt < 0 || buildsCoreAt > compilesAt;
      })
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  // Guards the filter above: if the scripts are renamed so nothing matches, the assertion would
  // pass vacuously and stop protecting anything.
  it("still recognises the scripts it is meant to guard", () => {
    const guarded = Object.keys(scripts).filter((name) => COMPILES_SRC_TS.test(scripts[name]));
    expect(guarded).toContain("browser-api:build");
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });
});
