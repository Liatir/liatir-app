// Ship src/assets (plugin SDK files + contract extractors) inside dist, next
// to the compiled commands, so `new URL("../assets/…", import.meta.url)`
// resolves identically from src (tests) and dist (published package).
import { cpSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

cpSync(
  resolve(__dirname, "../src/assets"),
  resolve(__dirname, "../dist/assets"),
  { recursive: true },
);
