import * as fs from "fs/promises";
import * as path from "path";

// ── Node module template ─────────────────────────────────────────────────────

const PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "liatir dev",
        build: "liatir build",
      },
      devDependencies: {
        "@liatir/sdk": "^1.0.0",
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

const MANIFEST = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "1.0.0",
      description: "",
      runtime: "node",
      inputSchema: {
        filePath: {
          type: "file",
          label: "Input file",
          required: true,
          accept: [".bam", ".sam", ".fastq", ".fastq.gz"],
        },
      },
      outputSchema: {
        result: { type: "string", label: "Result" },
      },
    },
    null,
    2
  );

const INDEX_TS = (name: string) => `import { createLiatir } from "@liatir/sdk";

// Input type — define what your script expects
export interface Input {
  // example: filePath: string;
}

// Output type — define what your script returns
export interface Output {
  // example: readCount: number;
}

// Entry point called by Liatir when this script runs
export async function run(input: Input): Promise<Output> {
  const Liatir = await createLiatir();

  // Your script logic here.
  // Example: spawn a system tool and wait for it to finish
  // const job = await Liatir.jobs.run("samtools", ["flagstat", input.filePath], {
  //   onStdout: (line) => console.log(line),
  //   onStderr: (line) => console.error(line),
  // });
  // if (job.status.type !== "done") throw new Error("samtools failed");

  console.log("[${name}] running with input:", input);

  return {};
}
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

    console.log(`
✓ Created ${name}/ (WASM custom tool)

Next steps:
  cd ${name}
  rustup target add wasm32-wasip1   # once, if not installed
  liatir build                      # compile Rust → package as ${name}.lia
`);
    return;
  }

  await Promise.all([
    fs.writeFile(path.join(dir, "package.json"), PACKAGE_JSON(name)),
    fs.writeFile(path.join(dir, "tsconfig.json"), TSCONFIG),
    fs.writeFile(path.join(dir, ".lia-manifest.json"), MANIFEST(name)),
    fs.writeFile(path.join(dir, "src", "index.ts"), INDEX_TS(name)),
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
