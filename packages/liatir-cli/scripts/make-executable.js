import { chmodSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, "../dist/cli.js");
try {
  chmodSync(cli, "755");
} catch {
  // Windows — no-op
}
