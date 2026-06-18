import * as fs from "fs/promises";
import * as path from "path";

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
        "@liatir/adapter": "^1.0.0",
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

const INDEX_TS = (name: string) => `import { createLiatir } from "@liatir/adapter";

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

export async function init(name: string) {
  const dir = path.resolve(name);

  try {
    await fs.access(dir);
    console.error(`Directory "${name}" already exists.`);
    process.exit(1);
  } catch {
    // doesn't exist — good
  }

  await fs.mkdir(path.join(dir, "src"), { recursive: true });

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
