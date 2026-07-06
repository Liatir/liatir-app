import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createInterface, type Interface } from "readline/promises";
import { stdin as processStdin, stdout as processStdout } from "process";
import { readAsset } from "./_assets.js";

const execFileAsync = promisify(execFile);

type Runtime = "node" | "wasm" | "python";
type NodeLanguage = "typescript" | "javascript";
type NodeTemplate = "minimal" | "file-processor" | "bio-cli";

interface ParsedInitArgs {
  name?: string;
  runtime?: Runtime;
  language?: NodeLanguage;
  template?: NodeTemplate;
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  installDependencies?: boolean;
  installWasmTarget?: boolean;
  yes: boolean;
}

interface InitConfig {
  dir: string;
  nextStepDir: string;
  projectName: string;
  packageName: string;
  rustCrateName: string;
  runtime: Runtime;
  language: NodeLanguage;
  template: NodeTemplate;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  installDependencies: boolean;
  installWasmTarget: boolean;
}

type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
  recommended?: boolean;
};

const DEFAULT_PROJECT_NAME = "my-liatir-plugin";
const DEFAULT_CATEGORY = "General";

const RUNTIME_CHOICES: Choice<Runtime>[] = [
  {
    value: "node",
    label: "Node TypeScript .lia plugin",
    description: "Use JavaScript/TypeScript and the full Liatir desktop bridge.",
  },
  {
    value: "wasm",
    label: "WASM Rust .lia tool",
    description: "Use Rust compiled to WASM for sandboxed local computation.",
  },
  {
    value: "python",
    label: "Python .lia plugin",
    description: "Use a managed Python environment for scientific Python libraries.",
  },
];

const LANGUAGE_CHOICES: Choice<NodeLanguage>[] = [
  {
    value: "typescript",
    label: "TypeScript",
    description: "Best type safety and contract validation while developing plugins.",
    recommended: true,
  },
  {
    value: "javascript",
    label: "JavaScript",
    description: "Plain ESM plugin without a TypeScript project.",
  },
];

const TEMPLATE_CHOICES: Choice<NodeTemplate>[] = [
  {
    value: "minimal",
    label: "Minimal text plugin",
    description: "Smallest example for learning the plugin contract.",
    recommended: true,
  },
  {
    value: "file-processor",
    label: "File processor",
    description: "Reads metadata from a user-selected local file.",
  },
  {
    value: "bio-cli",
    label: "Bio CLI wrapper",
    description: "Shows how to wrap a local bioinformatics command.",
  },
];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function requireFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value after ${flag}.`);
  }
  return value;
}

function parseRuntime(value: string): Runtime {
  if (value === "node" || value === "wasm" || value === "python") return value;
  throw new Error(`Invalid runtime "${value}". Expected "node", "wasm", or "python".`);
}

function parseTemplate(value: string): NodeTemplate {
  if (value === "minimal" || value === "file-processor" || value === "bio-cli") return value;
  throw new Error(`Invalid template "${value}". Expected "minimal", "file-processor", or "bio-cli".`);
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function setRuntime(parsed: ParsedInitArgs, runtime: Runtime): void {
  if (parsed.runtime && parsed.runtime !== runtime) {
    throw new Error(`Conflicting runtime flags: "${parsed.runtime}" and "${runtime}".`);
  }
  parsed.runtime = runtime;
}

function setLanguage(parsed: ParsedInitArgs, language: NodeLanguage): void {
  if (parsed.language && parsed.language !== language) {
    throw new Error(`Conflicting language flags: "${parsed.language}" and "${language}".`);
  }
  parsed.language = language;
}

function parseInitArgs(args: string[]): ParsedInitArgs {
  const parsed: ParsedInitArgs = { yes: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];

    if (!arg.startsWith("-")) {
      if (parsed.name) throw new Error(`Unexpected extra argument "${arg}".`);
      parsed.name = arg;
      continue;
    }

    switch (flag) {
      case "-y":
      case "--yes":
        parsed.yes = true;
        break;
      case "--name":
        parsed.name = inlineValue ?? requireFlagValue(args, i, flag);
        if (inlineValue === undefined) i += 1;
        break;
      case "--node":
        setRuntime(parsed, "node");
        break;
      case "--wasm":
        setRuntime(parsed, "wasm");
        break;
      case "--python":
        setRuntime(parsed, "python");
        break;
      case "--runtime":
        setRuntime(parsed, parseRuntime(inlineValue ?? requireFlagValue(args, i, flag)));
        if (inlineValue === undefined) i += 1;
        break;
      case "--ts":
      case "--typescript":
        setLanguage(parsed, "typescript");
        break;
      case "--js":
      case "--javascript":
        setLanguage(parsed, "javascript");
        break;
      case "--template":
        parsed.template = parseTemplate(inlineValue ?? requireFlagValue(args, i, flag));
        if (inlineValue === undefined) i += 1;
        break;
      case "--display-name":
        parsed.displayName = inlineValue ?? requireFlagValue(args, i, flag);
        if (inlineValue === undefined) i += 1;
        break;
      case "--description":
        parsed.description = inlineValue ?? requireFlagValue(args, i, flag);
        if (inlineValue === undefined) i += 1;
        break;
      case "--category":
        parsed.category = inlineValue ?? requireFlagValue(args, i, flag);
        if (inlineValue === undefined) i += 1;
        break;
      case "--tags":
        parsed.tags = parseTags(inlineValue ?? requireFlagValue(args, i, flag));
        if (inlineValue === undefined) i += 1;
        break;
      case "--install":
        parsed.installDependencies = true;
        break;
      case "--no-install":
        parsed.installDependencies = false;
        break;
      case "--install-wasm-target":
        parsed.installWasmTarget = true;
        break;
      case "--no-wasm-target":
        parsed.installWasmTarget = false;
        break;
      default:
        throw new Error(`Unknown option "${arg}".`);
    }
  }

  return parsed;
}

function canPrompt(): boolean {
  return Boolean(processStdin.isTTY && processStdout.isTTY);
}

function recommendedChoice<T extends string>(choices: Choice<T>[]): T {
  const choice = choices.find((item) => item.recommended) ?? choices[0];
  return choice.value;
}

function choiceLabel(choice: Choice<string>): string {
  return `${choice.label}${choice.recommended ? " (Recommended)" : ""}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function promptText(
  rl: Interface,
  label: string,
  defaultValue: string,
  options: { optional?: boolean; example?: string; required?: boolean } = {},
): Promise<string> {
  const example = options.example ? ` (example: ${options.example})` : "";
  const defaultHint = defaultValue ? ` [${defaultValue}]` : "";
  const optional = options.optional ? " (optional)" : "";

  while (true) {
    const answer = (await rl.question(`${label}${optional}${example}${defaultHint}: `)).trim();
    if (answer || !options.required) return answer || defaultValue;
    console.log(`${label} is required. \`liatir init\` creates a new project directory.`);
  }
}

async function promptChoice<T extends string>(
  rl: Interface,
  question: string,
  choices: Choice<T>[],
): Promise<T> {
  const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.recommended));
  console.log(`\n${question}`);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choiceLabel(choice)} - ${choice.description}`);
  });

  while (true) {
    const answer = (await rl.question(`Select an option [${defaultIndex + 1}]: `)).trim();
    if (!answer) return choices[defaultIndex].value;

    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
      return choices[numeric - 1].value;
    }

    const byValue = choices.find((choice) => choice.value === answer);
    if (byValue) return byValue.value;

    console.log(`Please enter 1-${choices.length} or one of: ${choices.map((choice) => choice.value).join(", ")}.`);
  }
}

async function promptYesNo(rl: Interface, question: string, defaultYes: boolean): Promise<boolean> {
  const recommended = defaultYes ? "Yes (Recommended)" : "No (Recommended)";
  const hint = defaultYes ? "Y/n" : "y/N";

  while (true) {
    const answer = (await rl.question(`${question} ${recommended} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    console.log("Please answer yes or no.");
  }
}

function sanitizePackageName(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || DEFAULT_PROJECT_NAME;
}

function sanitizeRustCrateName(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = clean || "liatir_tool";
  return /^[0-9]/.test(safe) ? `lia_${safe}` : safe;
}

function humanizeProjectName(raw: string): string {
  const words = raw
    .replace(/^@+/, "")
    .replace(/[\\/]/g, " ")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "Liatir Plugin";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function normalizeText(value: string | undefined, fallback: string): string {
  const clean = value?.trim();
  return clean ? clean : fallback;
}

function projectBaseName(projectPath: string): string {
  return path.basename(path.resolve(projectPath)) || DEFAULT_PROJECT_NAME;
}

async function resolveInitConfig(parsed: ParsedInitArgs): Promise<InitConfig> {
  const interactive = canPrompt() && !parsed.yes;
  const rl = interactive ? createInterface({ input: processStdin, output: processStdout }) : undefined;

  try {
    if (!parsed.name && !interactive && !parsed.yes) {
      throw new Error("Missing project folder. Use `liatir init <folder>` or `liatir init --yes`.");
    }

    const selectedName = parsed.name
      ?? (rl
        ? await promptText(rl, "Project folder", "", { example: DEFAULT_PROJECT_NAME, required: true })
        : DEFAULT_PROJECT_NAME);

    const dir = path.resolve(selectedName);
    const nextStepDir = path.relative(process.cwd(), dir) || ".";
    const projectName = projectBaseName(selectedName);
    const packageName = sanitizePackageName(projectName);
    const rustCrateName = sanitizeRustCrateName(projectName);

    const runtime = parsed.runtime
      ?? (rl ? await promptChoice(rl, "Runtime", RUNTIME_CHOICES) : recommendedChoice(RUNTIME_CHOICES));

    const language = runtime === "node"
      ? parsed.language
        ?? (rl ? await promptChoice(rl, "Node language", LANGUAGE_CHOICES) : recommendedChoice(LANGUAGE_CHOICES))
      : "typescript";

    const template = runtime === "node"
      ? parsed.template
        ?? (rl ? await promptChoice(rl, "Starter template", TEMPLATE_CHOICES) : recommendedChoice(TEMPLATE_CHOICES))
      : "minimal";

    const displayName = normalizeText(
      parsed.displayName ?? (rl ? await promptText(rl, "Display name", "", { optional: true, example: humanizeProjectName(projectName) }) : undefined),
      humanizeProjectName(projectName),
    );

    const description = normalizeText(
      parsed.description ?? (rl ? await promptText(rl, "Description", "", { optional: true }) : undefined),
      "",
    );

    const category = normalizeText(
      parsed.category ?? (rl ? await promptText(rl, "Category", DEFAULT_CATEGORY) : undefined),
      DEFAULT_CATEGORY,
    );

    const tags = parsed.tags ?? [];

    const installDependencies = runtime === "node"
      ? parsed.installDependencies ?? (rl ? await promptYesNo(rl, "Install dependencies now?", true) : true)
      : false;

    const installWasmTarget = runtime === "wasm"
      ? parsed.installWasmTarget ?? (rl ? await promptYesNo(rl, "Install Rust target wasm32-wasip1 now?", true) : true)
      : false;

    return {
      dir,
      nextStepDir,
      projectName,
      packageName,
      rustCrateName,
      runtime,
      language,
      template,
      displayName,
      description,
      category,
      tags,
      installDependencies,
      installWasmTarget,
    };
  } finally {
    rl?.close();
  }
}

async function installNodeDependencies(dir: string): Promise<void> {
  try {
    console.log("Installing dependencies with npm...");
    await execFileAsync("npm", ["install"], { cwd: dir });
  } catch {
    console.warn("Dependency install failed. Run `npm install` inside the plugin folder before `liatir dev`.");
  }
}

/**
 * NOTE:
 * Ensure the wasm compilation target is installed. Idempotent: rustup skips it if already present.
 * Best-effort: a missing Rust toolchain only prints a hint, it does not fail the scaffold.
 */
async function ensureWasmTarget(): Promise<void> {
  try {
    await execFileAsync("rustup", ["target", "add", "wasm32-wasip1"]);
    console.log("Rust target wasm32-wasip1 ready");
  } catch {
    console.warn(
      "Could not add the wasm target automatically. Install Rust (https://rustup.rs),\n" +
      "then run: rustup target add wasm32-wasip1",
    );
  }
}

function packageJson(config: InitConfig): string {
  const scripts: Record<string, string> = {
    dev: "liatir dev",
    build: "liatir build",
    update: "liatir update",
  };
  const devDependencies: Record<string, string> = {
    "@liatir/cli": "^1.9.11",
    "@liatir/api": "^1.9.11",
  };

  if (config.language === "typescript") {
    scripts.typecheck = "tsc -p tsconfig.json --noEmit";
    devDependencies.typescript = "^5.0.0";
    devDependencies["@types/node"] = "^20.0.0";
  }

  return JSON.stringify(
    {
      name: config.packageName,
      version: "1.0.0",
      description: config.description,
      type: "module",
      scripts,
      liatir: {
        displayName: config.displayName,
        category: config.category,
        tags: config.tags,
      },
      devDependencies,
    },
    null,
    2,
  );
}

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      outDir: ".liatir",
      rootDir: "./src",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2,
);

function nodeIndex(config: InitConfig): string {
  if (config.template === "file-processor") {
    return config.language === "typescript" ? FILE_PROCESSOR_TS : FILE_PROCESSOR_JS;
  }
  if (config.template === "bio-cli") {
    return config.language === "typescript" ? BIO_CLI_TS : BIO_CLI_JS;
  }
  return config.language === "typescript" ? MINIMAL_TS : MINIMAL_JS;
}

const MINIMAL_TS = `// Docs: https://liatir.com/docs/plugins

import { definePlugin, field, type PluginContext } from "@liatir/api";

// This is just an example. Edit inputs and outputs definitions and the plugin logic to implement your solutions.

const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      description: "Text to analyze.",
      required: true,
      default: "hello from Liatir",
    }),
  },
  outputs: {
    length: field.number({
      label: "Length",
      description: "Number of characters in the input text.",
      format: "integer",
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {

  // Write the plugin logic here

  return {
    length: input.text.length,
  };
});
`;

const MINIMAL_JS = `import { definePlugin, field } from "@liatir/api";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      description: "Text to analyze.",
      required: true,
      default: "hello from Liatir",
    }),
  },
  outputs: {
    length: field.number({
      label: "Length",
      description: "Number of characters in the input text.",
      format: "integer",
    }),
  },
});

export default liatirPlugin.main(async ({ input }) => {
  return {
    length: input.text.length,
  };
});
`;

const FILE_PROCESSOR_TS = `import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { definePlugin, field, type PluginContext } from "@liatir/api";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    inputFile: field.file({
      label: "Input file",
      description: "A local file selected in Liatir.",
      required: true,
      accept: ["txt", "csv", "tsv", "fastq", "fq", "fasta", "fa"],
    }),
  },
  outputs: {
    fileName: field.string({
      label: "File name",
      description: "Base name of the selected file.",
    }),
    sizeBytes: field.number({
      label: "Size",
      description: "File size in bytes.",
      format: "bytes",
    }),
  },
});

export default liatirPlugin.main(async ({ input }: PluginContext<typeof liatirPlugin>) => {
  const fileStats = await stat(input.inputFile);

  return {
    fileName: basename(input.inputFile),
    sizeBytes: fileStats.size,
  };
});
`;

const FILE_PROCESSOR_JS = `import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { definePlugin, field } from "@liatir/api";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    inputFile: field.file({
      label: "Input file",
      description: "A local file selected in Liatir.",
      required: true,
      accept: ["txt", "csv", "tsv", "fastq", "fq", "fasta", "fa"],
    }),
  },
  outputs: {
    fileName: field.string({
      label: "File name",
      description: "Base name of the selected file.",
    }),
    sizeBytes: field.number({
      label: "Size",
      description: "File size in bytes.",
      format: "bytes",
    }),
  },
});

export default liatirPlugin.main(async ({ input }) => {
  const fileStats = await stat(input.inputFile);

  return {
    fileName: basename(input.inputFile),
    sizeBytes: fileStats.size,
  };
});
`;

const BIO_CLI_TS = `import { definePlugin, field, type PluginContext } from "@liatir/api";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    fastq: field.file({
      label: "FASTQ file",
      description: "Input reads to inspect with seqkit stats.",
      required: true,
      accept: ["fastq", "fq", "fastq.gz", "fq.gz"],
    }),
  },
  outputs: {
    status: field.string({
      label: "Status",
      description: "Final process status reported by Liatir jobs.",
    }),
    stdout: field.string({
      label: "Standard output",
      description: "Command output captured from stdout.",
    }),
    stderr: field.string({
      label: "Standard error",
      description: "Command output captured from stderr.",
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const job = await Liatir.jobs.run("seqkit", ["stats", input.fastq], {
    onStdout: (line) => stdoutLines.push(line),
    onStderr: (line) => stderrLines.push(line),
  });

  return {
    status: job.status.type,
    stdout: stdoutLines.join("\\n"),
    stderr: stderrLines.join("\\n"),
  };
});
`;

const BIO_CLI_JS = `import { definePlugin, field } from "@liatir/api";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    fastq: field.file({
      label: "FASTQ file",
      description: "Input reads to inspect with seqkit stats.",
      required: true,
      accept: ["fastq", "fq", "fastq.gz", "fq.gz"],
    }),
  },
  outputs: {
    status: field.string({
      label: "Status",
      description: "Final process status reported by Liatir jobs.",
    }),
    stdout: field.string({
      label: "Standard output",
      description: "Command output captured from stdout.",
    }),
    stderr: field.string({
      label: "Standard error",
      description: "Command output captured from stderr.",
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }) => {
  const stdoutLines = [];
  const stderrLines = [];

  const job = await Liatir.jobs.run("seqkit", ["stats", input.fastq], {
    onStdout: (line) => stdoutLines.push(line),
    onStderr: (line) => stderrLines.push(line),
  });

  return {
    status: job.status.type,
    stdout: stdoutLines.join("\\n"),
    stderr: stderrLines.join("\\n"),
  };
});
`;

const CARGO_TOML = (name: string) => `[package]
name = "${name}"
version = "1.0.0"
edition = "2021"

[[bin]]
name = "${name}"
path = "src/main.rs"

[dependencies]
# preserve_order keeps the declared field order in the generated manifest,
# which is the order Liatir renders the input form in.
serde_json = { version = "1", features = ["preserve_order"] }

# Smaller wasm artifact.
[profile.release]
opt-level = "s"
lto = true
`;

// The I/O schema is NOT in these manifests: Python/WASM plugins declare it in
// code with define_plugin (same API as Node) and `liatir build` generates it.
function pythonManifest(config: InitConfig): string {
  return JSON.stringify(
    {
      name: config.displayName,
      version: "1.0.0",
      description: config.description,
      runtime: "python",
      category: config.category,
      tags: config.tags,
      python: {
        entry: "src/main.py",
        pythonRequirement: {
          minVersion: "3.10",
          maxVersionExclusive: "3.13",
          label: "Python >=3.10,<3.13",
        },
        packages: [],
        requirements: [],
      },
    },
    null,
    2,
  );
}

function wasmManifest(config: InitConfig): string {
  return JSON.stringify(
    {
      name: config.displayName,
      version: "1.0.0",
      description: config.description,
      runtime: "wasm",
      category: config.category,
      tags: config.tags,
    },
    null,
    2,
  );
}

const MAIN_RS = `// Docs: https://liatir.com/docs/plugins

mod liatir;

use liatir::{define_plugin, field};
use serde_json::json;

// This is just an example. Edit inputs and outputs definitions and the plugin
// logic to implement your solutions. \`liatir build\` generates the manifest
// schema from this contract and validates every run against it.
//
// The plugin runs in a sandbox: no network and no arbitrary filesystem — only
// directories mounted by Liatir are available. stdout is reserved for the
// result; use eprintln! for logs.
fn main() {
    define_plugin()
        .input("text", field::string()
            .label("Text")
            .description("Text to analyze.")
            .required(true)
            .default_value("hello from Liatir"))
        .output("length", field::number()
            .label("Length")
            .description("Number of characters in the input text.")
            .integer())
        .main(|ctx| {
            // Write the plugin logic here
            let text = ctx.str("text")?;

            Ok(json!({
                "length": text.chars().count(),
            }))
        });
}
`;

const MAIN_PY = `# Docs: https://liatir.com/docs/plugins

from liatir import define_plugin, field

# This is just an example. Edit inputs and outputs definitions and the plugin
# logic to implement your solutions. \`liatir build\` generates the manifest
# schema from this contract and validates every run against it.
plugin = define_plugin(
    inputs={
        "text": field.string(
            label="Text",
            description="Text to analyze.",
            required=True,
            default="hello from Liatir",
        ),
    },
    outputs={
        "length": field.number(
            label="Length",
            description="Number of characters in the input text.",
            format="integer",
        ),
    },
)


@plugin.main
def main(ctx):
    # Write the plugin logic here
    return {
        "length": len(ctx.input["text"]),
    }
`;

const GITIGNORE = "target/\n*.lia\nnode_modules/\ndist/\n.liatir/\nbuild/\n.lia-dev/\n.venv/\nvenv/\n__pycache__/\n";

async function scaffoldWasm(config: InitConfig): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(config.dir, "Cargo.toml"), CARGO_TOML(config.rustCrateName)),
    fs.writeFile(path.join(config.dir, ".lia-manifest.json"), wasmManifest(config)),
    fs.writeFile(path.join(config.dir, "src", "main.rs"), MAIN_RS),
    // CLI-managed Liatir plugin SDK module; `liatir build` keeps it in sync.
    readAsset("liatir.rs").then((sdk) => fs.writeFile(path.join(config.dir, "src", "liatir.rs"), sdk)),
    fs.writeFile(path.join(config.dir, ".gitignore"), GITIGNORE),
  ]);

  if (config.installWasmTarget) {
    await ensureWasmTarget();
  }

  console.log(`
Created ${config.projectName}/ (WASM Rust .lia tool)

Next steps:
  cd ${shellQuote(config.nextStepDir)}
  liatir build      # compile Rust and package as ${config.rustCrateName}.lia
`);
}

async function scaffoldNode(config: InitConfig): Promise<void> {
  const entryName = config.language === "typescript" ? "index.ts" : "index.js";
  const writes = [
    fs.writeFile(path.join(config.dir, "package.json"), packageJson(config)),
    fs.writeFile(path.join(config.dir, "src", entryName), nodeIndex(config)),
    fs.writeFile(path.join(config.dir, ".gitignore"), GITIGNORE),
  ];

  if (config.language === "typescript") {
    writes.push(fs.writeFile(path.join(config.dir, "tsconfig.json"), TSCONFIG));
  }

  await Promise.all(writes);

  if (config.installDependencies) {
    await installNodeDependencies(config.dir);
  }

  const installStep = config.installDependencies ? "" : "  npm install    # installs @liatir/api types for the editor\n";

  console.log(`
Created ${config.projectName}/ (Node ${config.language} .lia plugin)

Next steps:
  cd ${shellQuote(config.nextStepDir)}
${installStep}  liatir dev       # open a temporary Liatir Dev Runner session
  liatir build     # package as ${config.packageName}.lia
`);
}

async function scaffoldPython(config: InitConfig): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(config.dir, ".lia-manifest.json"), pythonManifest(config)),
    fs.writeFile(path.join(config.dir, "src", "main.py"), MAIN_PY),
    // CLI-managed Liatir plugin SDK module; `liatir build` keeps it in sync
    // and ships it inside the .lia bundle, so `import liatir` always resolves.
    readAsset("liatir.py").then((sdk) => fs.writeFile(path.join(config.dir, "src", "liatir.py"), sdk)),
    fs.writeFile(path.join(config.dir, "requirements.txt"), "# Add pip requirements here when the plugin needs external Python packages.\n"),
    fs.writeFile(path.join(config.dir, ".gitignore"), GITIGNORE),
  ]);

  console.log(`
Created ${config.projectName}/ (Python .lia plugin)

Next steps:
  cd ${shellQuote(config.nextStepDir)}
  liatir dev --input '{"text":"hello from Liatir"}'
  liatir build      # package into .liatir/
`);
}

export async function init(args: string[] | string, runtime?: Runtime): Promise<void> {
  const parsed: ParsedInitArgs = Array.isArray(args)
    ? parseInitArgs(args)
    : { name: args, runtime: runtime ?? "node", yes: true };
  const config = await resolveInitConfig(parsed);

  if (await exists(config.dir)) {
    console.error(`Directory "${config.projectName}" already exists.`);
    process.exit(1);
  }

  await fs.mkdir(path.join(config.dir, "src"), { recursive: true });

  if (config.runtime === "wasm") {
    await scaffoldWasm(config);
  } else if (config.runtime === "python") {
    await scaffoldPython(config);
  } else {
    await scaffoldNode(config);
  }
}
