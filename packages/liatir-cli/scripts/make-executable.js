import { chmodSync, cpSync, existsSync, rmSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, "../dist");
const compiledRoot = resolve(distRoot, "liatir-cli/src");
const cli = resolve(distRoot, "cli.js");

if (existsSync(compiledRoot)) {
  cpSync(resolve(compiledRoot, "cli.js"), cli);
  cpSync(resolve(compiledRoot, "cli.d.ts"), resolve(distRoot, "cli.d.ts"));
  rmSync(resolve(distRoot, "commands"), { recursive: true, force: true });
  cpSync(resolve(compiledRoot, "commands"), resolve(distRoot, "commands"), { recursive: true });
}

try {
  chmodSync(cli, "755");
} catch {
  // Windows no-op.
}
