import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Ensure the wasm compilation target is installed. Idempotent — rustup skips it
 * if already present. Best-effort: a missing Rust toolchain only prints a hint,
 * it does not fail the scaffold.
 */
async function ensureWasmTarget(): Promise<void> {
  try {
    await execFileAsync("rustup", ["target", "add", "wasm32-wasip1"]);
    console.log("✓ Rust target wasm32-wasip1 ready");
  } catch {
    console.warn(
      "⚠ Couldn't add the wasm target automatically. Install Rust (https://rustup.rs),\n" +
      "  then run:  rustup target add wasm32-wasip1"
    );
  }
}

// ── Node module template ─────────────────────────────────────────────────────

const PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "1.0.0",
      description: "",
      type: "module",
      scripts: {
        dev: "lia dev",
        build: "lia build",
      },
      devDependencies: {
        "@liatir/sdk": "^1.3.0",
        typescript: "^5.0.0",
        "@types/node": "^20.0.0",
      },
    },
    null,
    2
  );

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2
);

const INDEX_TS = () => `import { defineModule, field } from "@liatir/sdk";

// Declare the schema ONCE here. The input/output types are inferred from it, and
// \`lia build\` generates the manifest from it — nothing to keep in sync by hand.
//   lia — the Liatir bridge: lia.jobs, lia.deps, lia.desktop.fs, …
export default defineModule({
  inputs: {
    text: field.string({ label: "Text", required: true }),
  },
  outputs: {
    length: field.number({ label: "Length" }),
  },
  async run({ input, lia }) {
    // input.text is string (inferred); the return is checked against outputs.
    return { length: input.text.length };
  },
});
`;

// ── WASM custom-tool template (Rust → wasm32-wasip1) ─────────────────────────

const CARGO_TOML = (name: string) => `[package]
name = "${name}"
version = "1.0.0"
edition = "2021"

[[bin]]
name = "${name}"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Smaller wasm artifact.
[profile.release]
opt-level = "s"
lto = true
`;

const MANIFEST_WASM = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "1.0.0",
      description: "",
      runtime: "wasm",
      inputSchema: {
        text: { type: "string", label: "Text", required: true },
      },
      outputSchema: {
        length: { type: "number", label: "Length" },
      },
    },
    null,
    2
  );

const MAIN_RS = `use std::io::{self, Read, Write};
use serde::{Deserialize, Serialize};

// Inputs — must match the inputSchema in .lia-manifest.json.
// Keys are camelCase in JSON; serde maps them to snake_case fields.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    text: String,
}

// Outputs — must match the outputSchema in .lia-manifest.json.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    length: u64,
}

// A Liatir WASM tool reads its JSON input from STDIN and writes JSON output to
// STDOUT. It runs in a sandbox: no network access and no arbitrary filesystem —
// only the directories Liatir mounts (the folders of "file" inputs, read-only).
fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("failed to read stdin");
    let input: Input = serde_json::from_str(&buf).expect("invalid JSON input");

    // ── Your tool logic here ──────────────────────────────────────────────
    let output = Output { length: input.text.len() as u64 };

    let json = serde_json::to_string(&output).expect("failed to serialize output");
    io::stdout().write_all(json.as_bytes()).expect("failed to write stdout");
}
`;

const GITIGNORE = "target/\n*.lia\n";

// ── Scaffolder ───────────────────────────────────────────────────────────────

export async function init(name: string, runtime: "node" | "wasm" = "node") {
  const dir = path.resolve(name);

  try {
    await fs.access(dir);
    console.error(`Directory "${name}" already exists.`);
    process.exit(1);
  } catch {
    // doesn't exist — good
  }

  await fs.mkdir(path.join(dir, "src"), { recursive: true });

  if (runtime === "wasm") {
    await Promise.all([
      fs.writeFile(path.join(dir, "Cargo.toml"), CARGO_TOML(name)),
      fs.writeFile(path.join(dir, ".lia-manifest.json"), MANIFEST_WASM(name)),
      fs.writeFile(path.join(dir, "src", "main.rs"), MAIN_RS),
      fs.writeFile(path.join(dir, ".gitignore"), GITIGNORE),
    ]);

    // --wasm already takes care of the toolchain target for you.
    await ensureWasmTarget();

    console.log(`
✓ Created ${name}/ (WASM custom tool)

Next steps:
  cd ${name}
  lia build      # compile Rust → package as ${name}.lia
`);
    return;
  }

  await Promise.all([
    fs.writeFile(path.join(dir, "package.json"), PACKAGE_JSON(name)),
    fs.writeFile(path.join(dir, "tsconfig.json"), TSCONFIG),
    fs.writeFile(path.join(dir, "src", "index.ts"), INDEX_TS()),
  ]);

  console.log(`
✓ Created ${name}/

Next steps:
  cd ${name}
  npm install
  liatir dev       # watch mode with live Liatir app
  liatir build     # package as ${name}.lia
`);
}
