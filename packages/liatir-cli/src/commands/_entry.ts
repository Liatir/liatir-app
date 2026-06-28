import * as fs from "fs/promises";
import * as path from "path";

export interface NodeEntryPoint {
  path: string;
  displayPath: "src/index.ts" | "src/index.js";
  language: "typescript" | "javascript";
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the single supported Node plugin entrypoint. TypeScript is preferred
 * when both files exist because it is the recommended scaffold and typechecked
 * when a tsconfig is present.
 */
export async function resolveNodeEntryPoint(cwd: string): Promise<NodeEntryPoint> {
  const tsPath = path.join(cwd, "src", "index.ts");
  if (await exists(tsPath)) {
    return { path: tsPath, displayPath: "src/index.ts", language: "typescript" };
  }

  const jsPath = path.join(cwd, "src", "index.js");
  if (await exists(jsPath)) {
    return { path: jsPath, displayPath: "src/index.js", language: "javascript" };
  }

  throw new Error("No Node plugin entrypoint found. Expected src/index.ts or src/index.js.");
}
