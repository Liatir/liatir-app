import * as fs from "fs/promises";
import * as path from "path";
import { createRequire } from "module";
import { build as esbuild } from "esbuild";

interface FieldDef {
  type: "string" | "number" | "boolean" | "file";
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  accept?: string[];
}

interface Manifest {
  name: string;
  version: string;
  description?: string;
  inputSchema?: Record<string, FieldDef>;
  outputSchema?: Record<string, FieldDef>;
}

export async function build() {
  const cwd = process.cwd();

  // Load manifest
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Manifest;
  } catch {
    console.error("No .lia-manifest.json found. Run this command from your project root.");
    process.exit(1);
  }

  const entryPoint = path.join(cwd, "src", "index.ts");
  try {
    await fs.access(entryPoint);
  } catch {
    console.error("src/index.ts not found.");
    process.exit(1);
  }

  const distDir = path.join(cwd, "dist");
  await fs.mkdir(distDir, { recursive: true });

  console.log(`Building ${manifest.name}@${manifest.version}...`);

  // Bundle with esbuild — all deps inlined, ESM output
  await esbuild({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: path.join(distDir, "index.js"),
    external: [],
    minify: false,
  });

  const fullManifest = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    inputSchema: manifest.inputSchema ?? {},
    outputSchema: manifest.outputSchema ?? {},
  };

  // Zip into .lia module
  const outputName = `${manifest.name}.lia`;
  const outputPath = path.join(cwd, outputName);
  await createLiatir(
    outputPath,
    path.join(distDir, "index.js"),
    fullManifest
  );

  console.log(`✓ Built → ${outputName}`);
}

async function createLiatir(
  outputPath: string,
  bundlePath: string,
  manifest: object
): Promise<void> {
  // Dynamic import of JSZip — use esbuild-bundled or require fallback
  const { default: JSZip } = await import("jszip").catch(() => {
    throw new Error("jszip not found. Run: npm install jszip");
  });

  const zip = new JSZip();
  zip.file("_sig", "LIATIR/1");
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("index.js", await fs.readFile(bundlePath));

  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(outputPath, content);
}
