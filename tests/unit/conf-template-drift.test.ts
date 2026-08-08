import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `src-tauri/Cargo.toml` is generated, not authored: every `*conf` script overwrites it from
 * `conf-templates/Cargo.template.toml`, and `test:tauri:prepare` runs one before building. So a
 * dependency added to the generated file alone survives every check that reads the working tree —
 * `cargo check`, `cargo clippy`, a local `cargo build` — and disappears the moment a real product
 * build regenerates it.
 *
 * That is exactly how `scrollcase-consumer` was lost: commit 3d8e1c2 added it to the generated file
 * only, so the crate stopped being linked during `npm run dev`, `npm run build` and the release
 * workflow's product lifecycle, failing with E0433 after a full box build, KMS signature and
 * multi-gigabyte publication had already succeeded (run 31229141007).
 */
const template = readFileSync(
  new URL("../../conf-templates/Cargo.template.toml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const generated = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

/** The substitutions every `*conf` script applies; only the package identity is templated. */
function render(name: string, version: string): string {
  return template
    .replace(/%%CARGO_PACKAGE_NAME%%/g, name)
    .replace(/%%CARGO_PACKAGE_VERSION%%/g, version);
}

describe("Cargo manifest template", () => {
  it("renders the committed generated manifest exactly", () => {
    const packageName = generated.match(/^name = "(.+)"$/m)?.[1];
    const packageVersion = generated.match(/^version = "(.+)"$/m)?.[1];

    expect(packageName).toBeTruthy();
    expect(packageVersion).toBeTruthy();
    expect(render(packageName!, packageVersion!)).toBe(generated);
  });

  it("keeps the generated manifest free of untemplated placeholders", () => {
    expect(generated).not.toContain("%%");
  });
});
