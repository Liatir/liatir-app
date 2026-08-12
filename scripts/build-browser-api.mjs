import { build } from "tsup";
import {
  rm,
  mkdir,
  writeFile,
  rename,
  readdir,
  readFile
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { localNodeCliInvocation } from "./node-cli.mjs";

const runCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
};

const patchDtsImports = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await patchDtsImports(fullPath);
        return;
      }

      if (!entry.isFile() || !entry.name.endsWith(".d.ts")) {
        return;
      }

      let content = await readFile(fullPath, "utf8");

      content = content
        .replace(
          /(["'])[^"']*packages\/liatir-core\/(?:dist|src)(?:\/index)?\1/g,
          "$1@liatir/core$1"
        )
        .replace(
          /(["'])[^"']*packages\/liatir-output-parser\/(?:dist|src)(?:\/index)?\1/g,
          "$1@liatir/output-parser$1"
        );

      await writeFile(fullPath, content);
    })
  );
};

const run = async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, "..");

  const browserEntry = path.join(root, "src-ts/bundle.ts");
  const browserOutDir = path.join(root, "packages/liatir-api/src/browser-api");
  const browserTsconfig = path.join(root, "tsconfig.browser-api.json");

  const external = [
    "fsevents",
    "fsevents/*",
    "chokidar",
    "chokidar/*",
    "@tauri-apps/api",
    "@tauri-apps/api/*",
    "fs",
    "fs/promises",
    "path",
    "os",
    "crypto",
    "events",
    "stream",
    "util",
    "buffer",
    "url",
    "node:*"
  ];

  const nativeExternalPlugin = {
    name: "native-external",
    setup(build) {
      build.onResolve({ filter: /\.node$/ }, (args) => ({
        path: args.path,
        external: true
      }));

      build.onResolve({ filter: /^(fsevents|chokidar)(\/.*)?$/ }, (args) => ({
        path: args.path,
        external: true
      }));
    }
  };

  await rm(browserOutDir, { recursive: true, force: true });
  await mkdir(browserOutDir, { recursive: true });

  await build({
    entry: {
      index: browserEntry
    },
    outDir: browserOutDir,
    format: ["esm"],
    dts: false,
    bundle: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    platform: "neutral",
    external,
    esbuildPlugins: [nativeExternalPlugin],

    // Produce index.js, not index.mjs.
    outExtension() {
      return {
        js: ".js"
      };
    }
  });

  await writeFile(
    browserTsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          rootDir: "src-ts",
          outDir: "packages/liatir-api/src/browser-api",
          declaration: true,
          emitDeclarationOnly: true,
          declarationMap: false,
          strict: true,
          skipLibCheck: true,
          moduleDetection: "force",
          noEmitOnError: false,
          baseUrl: ".",
          paths: {
            "@liatir/core": ["packages/liatir-core/dist/index.d.ts"]
          }
        },
        include: ["src-ts/**/*.ts"],
        exclude: ["node_modules"]
      },
      null,
      2
    )
  );

  const typescript = localNodeCliInvocation("typescript/bin/tsc", ["-p", browserTsconfig]);
  await runCommand(typescript.command, typescript.args, { cwd: root });

  // src-ts/bundle.ts emits bundle.d.ts.
  // Rename it to match index.js.
  await rename(
    path.join(browserOutDir, "bundle.d.ts"),
    path.join(browserOutDir, "index.d.ts")
  ).catch(() => {});

  // Fix generated .d.ts imports that point back to monorepo paths.
  await patchDtsImports(browserOutDir);

  console.log("browser-api build completed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
