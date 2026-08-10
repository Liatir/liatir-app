import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Workload Identity provider condition pins one exact `workflow_ref`, which is what stops a
 * token minted for one workflow being usable by another. The cost of that guarantee is that a new
 * protected workflow is inert until `configure-runtime-box-ci.sh` provisions its own provider — and
 * the failure is invisible until the workflow is dispatched against the production key, which is
 * the worst moment to discover it. `runtime-box-revoke.yml` shipped without one and died at the
 * auth step with `unauthorized_client: The given credential is rejected by the attribute
 * condition` (run 31378512709), after the plan had already been validated.
 */
const configureScript = readFileSync(resolve("scripts/configure-runtime-box-ci.sh"), "utf8");
const workflowDirectory = resolve(".github/workflows");

const protectedWorkflows = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml"))
  .filter((name) => readFileSync(join(workflowDirectory, name), "utf8")
    .includes("google-github-actions/auth"));

describe("Runtime Box CI identity wiring", () => {
  it("provisions a provider for every workflow that authenticates to Google", () => {
    const unprovisioned = protectedWorkflows.filter((name) => !configureScript.includes(`"${name}"`));

    expect(unprovisioned).toEqual([]);
  });

  it("reads the provider from an Environment variable the configure script sets", () => {
    for (const name of protectedWorkflows) {
      const workflow = readFileSync(join(workflowDirectory, name), "utf8");
      const variables = [...workflow.matchAll(
        /workload_identity_provider:\s*\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/g,
      )].map(([, variable]) => variable);

      expect(variables.length, `${name} must resolve its provider from a variable`).toBeGreaterThan(0);
      for (const variable of new Set(variables)) {
        expect(
          configureScript,
          `${name} reads ${variable}, which the configure script never sets`,
        ).toMatch(new RegExp(String.raw`set_environment_variable "\$\w+" ${variable} `));
      }
    }
  });

  // Guards the filter: a rename that matched nothing would let both assertions pass vacuously.
  it("still recognises the protected workflows", () => {
    expect(protectedWorkflows).toContain("runtime-box-revoke.yml");
    expect(protectedWorkflows.length).toBeGreaterThanOrEqual(3);
  });
});
