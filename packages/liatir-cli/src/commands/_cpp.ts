import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncManagedSdkFile } from "./_assets.js";
import { formatProcessError } from "./_process.js";

const execFileAsync = promisify(execFile);

/** Build author-side C++ sources; packaged Plugins retain the existing runtime specs. */
export async function buildCpp(cwd: string, runtime: "native" | "wasm"): Promise<string> {
  await syncManagedSdkFile(path.join(cwd, "src", "liatir.hpp"), "liatir.hpp");
  if (runtime === "native") {
    await syncManagedSdkFile(path.join(cwd, "src", "liatir_bridge.hpp"), "liatir_bridge.hpp");
  }
  const buildDir = path.join(cwd, ".liatir", "cpp-build", runtime);
  const args = ["-S", cwd, "-B", buildDir, "-DCMAKE_BUILD_TYPE=Release"];
  if (runtime === "wasm") {
    const sdk = process.env.WASI_SDK_PATH;
    if (!sdk) throw new Error("C++ WASM builds require WASI SDK. Set WASI_SDK_PATH to its installation directory.");
    // New SDKs name Preview 1 explicitly; older supported SDKs use the default name.
    const candidates = ["wasi-sdk-p1.cmake", "wasi-sdk.cmake"].map(name => path.resolve(sdk, "share", "cmake", name));
    let toolchain: string | undefined;
    for (const candidate of candidates) {
      if (await fs.stat(candidate).then(s => s.isFile()).catch(() => false)) { toolchain = candidate; break; }
    }
    if (!toolchain) throw new Error("WASI_SDK_PATH does not contain a WASI Preview 1 CMake toolchain.");
    args.push(`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`);
  }
  const cmake = process.env.LIATIR_CMAKE ?? "cmake";
  try {
    await execFileAsync(cmake, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    await execFileAsync(cmake, ["--build", buildDir, "--config", "Release"], { cwd, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`C++ build failed. Install CMake >= 3.21 and a C++17 compiler${runtime === "native" ? ", with libcurl development headers/libraries" : ", and configure WASI SDK"}.\n${formatProcessError(error)}`);
  }
  const suffix = runtime === "wasm" ? ".wasm" : process.platform === "win32" ? ".exe" : "";
  const executable = path.join(buildDir, "bin", `liatir_plugin${suffix}`);
  if (!(await fs.stat(executable).then(s => s.isFile()).catch(() => false))) {
    throw new Error(`CMake did not produce ${executable}. Keep the scaffold's liatir_plugin target and output location.`);
  }
  return executable;
}
