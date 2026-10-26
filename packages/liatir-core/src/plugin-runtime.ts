import type { LiatirNativePluginTarget, LiatirPluginRuntime } from './index.js';

/** Only a missing runtime is legacy Node; misspellings must never execute Node. */
export function liatirPluginRuntime(value: unknown): LiatirPluginRuntime {
  if (value === undefined) return 'node';
  if (value === 'node' || value === 'python' || value === 'wasm' || value === 'r' || value === 'native') return value;
  throw new Error(`Unsupported Plugin runtime: ${typeof value === "string" ? value : typeof value}`);
}

export function liatirNativeTarget(os: string, arch: string): LiatirNativePluginTarget {
  const platform = os === 'darwin' ? 'macos' : os === 'win32' ? 'windows' : os;
  const architecture = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch;
  if (!['macos', 'linux', 'windows'].includes(platform) || !['aarch64', 'x86_64'].includes(architecture)) {
    throw new Error(`Unsupported Native Plugin host: ${os}/${arch}`);
  }
  return `${platform}-${architecture}` as LiatirNativePluginTarget;
}

export function liatirNativeTargetSupported(value: string): value is LiatirNativePluginTarget {
  return /^(macos|linux|windows)-(aarch64|x86_64)$/.test(value);
}

/** Pipeline forms store text; SDK handlers must receive the declared JSON types. */
export function liatirPluginPipelineInputs(
  schema: Record<string, import('./index.js').LiatirInputFieldSchema>,
  inputs: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...inputs };
  for (const [name, field] of Object.entries(schema)) {
    const value = inputs[name];
    if (value === undefined || (field.type !== 'number' && field.type !== 'boolean')) continue;
    if (!value.trim()) { delete result[name]; continue; }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Input "${name}" must be a finite number.`);
      result[name] = number;
    } else {
      if (value !== 'true' && value !== 'false') throw new Error(`Input "${name}" must be true or false.`);
      result[name] = value === 'true';
    }
  }
  return result;
}
