const TARGET_ACCELERATORS = {
  macos: { aarch64: ['metal', 'cpu'] },
  linux: { x86_64: ['cpu', 'cuda'] },
  windows: { x86_64: ['cpu', 'cuda'] },
};
const CUDA_VERSION = /^[1-9][0-9]*\.[0-9]+$/;

const ARCHIVE_BACKEND = Object.freeze({
  format: 'zip',
  writer: 'yazl@3.3.1',
  reader: 'yauzl@3.4.0',
  assetTarReader: 'tar@7.5.20',
  zip64: true,
});

const TARGET_ADAPTERS = Object.freeze([
  Object.freeze({
    id: 'macos-aarch64',
    platform: 'macos',
    arch: 'aarch64',
    host: Object.freeze({ platform: 'darwin', arch: 'arm64' }),
    uvPlatform: 'aarch64-apple-darwin',
    // conda/pixi platform subdir (the `platforms` value in a per-recipe pixi.toml). Added for the
    // pixi migration; the uv `uvPlatform` above stays until every recipe is on the pixi substrate.
    condaSubdir: 'osx-arm64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/bin/python',
      scriptsDirectory: 'venv/bin',
      executableSuffix: '',
      launcherKind: 'posix-polyglot',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'otool',
      argsPrefix: Object.freeze(['-L']),
      extensions: Object.freeze(['.dylib', '.so']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      metal: Object.freeze({ PYTORCH_ENABLE_MPS_FALLBACK: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform == 'darwin'",
  }),
  Object.freeze({
    id: 'linux-x86_64',
    platform: 'linux',
    arch: 'x86_64',
    host: Object.freeze({ platform: 'linux', arch: 'x64' }),
    uvPlatform: 'x86_64-unknown-linux-gnu',
    condaSubdir: 'linux-64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/bin/python',
      scriptsDirectory: 'venv/bin',
      executableSuffix: '',
      launcherKind: 'posix-polyglot',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'ldd',
      argsPrefix: Object.freeze([]),
      extensions: Object.freeze(['.so']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      cuda: Object.freeze({ CUDA_VISIBLE_DEVICES: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform.startswith('linux')",
  }),
  Object.freeze({
    id: 'windows-x86_64',
    platform: 'windows',
    arch: 'x86_64',
    host: Object.freeze({ platform: 'win32', arch: 'x64' }),
    uvPlatform: 'x86_64-pc-windows-msvc',
    condaSubdir: 'win-64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/python.exe',
      scriptsDirectory: 'venv/Scripts',
      executableSuffix: '.exe',
      launcherKind: 'uv-windows-pe',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'dumpbin',
      argsPrefix: Object.freeze(['/DEPENDENTS']),
      extensions: Object.freeze(['.dll', '.pyd']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      cuda: Object.freeze({ CUDA_VISIBLE_DEVICES: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform == 'win32'",
  }),
]);

/** Returns the canonical target slug used in Runtime Box filenames, object keys, and routes. */
export function runtimeBoxTargetId(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Runtime Box target must be an object');
  }
  const accelerators = TARGET_ACCELERATORS[target?.platform]?.[target?.arch];
  if (!accelerators?.includes(target?.accelerator)) {
    throw new TypeError(
      `Unsupported Runtime Box target: ${target?.platform}/${target?.arch}/${target?.accelerator}`,
    );
  }
  if (target.accelerator === 'cuda') {
    if (typeof target.cudaVersion !== 'string' || !CUDA_VERSION.test(target.cudaVersion)) {
      throw new TypeError('A CUDA Runtime Box target requires a numeric major.minor CUDA version');
    }
    return `${target.platform}-${target.arch}-cuda${target.cudaVersion}`;
  }
  if (target.cudaVersion !== undefined) {
    throw new TypeError('Only CUDA Runtime Box targets may declare a CUDA version');
  }
  return `${target.platform}-${target.arch}-${target.accelerator}`;
}

/** Returns the native builder adapter for a validated Runtime Box target. */
export function runtimeBoxTargetAdapter(target) {
  runtimeBoxTargetId(target);
  const adapter = TARGET_ADAPTERS.find((candidate) =>
    candidate.platform === target.platform && candidate.arch === target.arch);
  if (!adapter) throw new TypeError(`No Runtime Box target adapter exists for ${target.platform}/${target.arch}`);
  return adapter;
}

/** Ensures a build or target lock runs on the OS and architecture it will ship for. */
export function assertRuntimeBoxNativeHost(adapter, host = process) {
  if (host.platform !== adapter.host.platform || host.arch !== adapter.host.arch) {
    throw new TypeError(
      `${adapter.id} Runtime Boxes must be built natively on ${adapter.host.platform}/${adapter.host.arch}; `
      + `current host is ${host.platform}/${host.arch}`,
    );
  }
}

/** Ensures the recipe entry point agrees with the adapter's standalone Python layout. */
export function assertRuntimeBoxPythonEntryPoint(adapter, entryPoint) {
  if (entryPoint !== adapter.python.entryPoint) {
    throw new TypeError(
      `${adapter.id} Runtime Box recipes must use Python entry point ${adapter.python.entryPoint}`,
    );
  }
}

/** Returns the explicit PyTorch wheel backend selected by a recipe, rejecting target drift. */
export function runtimeBoxTorchBackendArguments(recipe) {
  if (recipe.torchBackend === undefined) return [];
  if (typeof recipe.torchBackend !== 'string' || !/^(?:cpu|cu[0-9]{3})$/.test(recipe.torchBackend)) {
    throw new TypeError(`Unsupported Runtime Box PyTorch backend: ${recipe.torchBackend}`);
  }
  const expected = recipe.target.accelerator === 'cuda'
    ? `cu${recipe.target.cudaVersion.replace('.', '')}`
    : recipe.target.accelerator === 'cpu'
      ? 'cpu'
      : null;
  if (recipe.torchBackend !== expected) {
    throw new TypeError(
      `Runtime Box PyTorch backend ${recipe.torchBackend} does not match target accelerator ${recipe.target.accelerator}`,
    );
  }
  return ['--torch-backend', recipe.torchBackend];
}

/** Returns the deterministic uv arguments shared by local locking and CI freshness checks. */
export function runtimeBoxLockArguments(adapter, recipe, inputPath, outputPath) {
  return [
    'pip', 'compile', inputPath,
    '--output-file', outputPath,
    '--python-version', recipe.pythonVersion,
    '--python-platform', adapter.uvPlatform,
    '--generate-hashes', '--only-binary', ':all:',
    '--no-emit-index-url', '--no-annotate', '--no-header',
    ...runtimeBoxTorchBackendArguments(recipe),
  ];
}

/** Lists all adapters for contract tests and future catalog validation. */
export function runtimeBoxTargetAdapters() {
  return [...TARGET_ADAPTERS];
}

// --- pixi/conda substrate mapping (migration) -------------------------------------------------
// These mirror the uv helpers above (uvPlatform / torchBackend / lock arguments) for the pixi +
// conda-forge builder. They are additive: a recipe is on the pixi substrate when it carries a
// pixi.toml/pixi.lock instead of requirements.in/lock, and the two paths coexist during migration.

/** Maps a validated Runtime Box target to its conda platform subdir (the pixi `platforms` value). */
export function runtimeBoxCondaSubdir(target) {
  const adapter = runtimeBoxTargetAdapter(target);
  return adapter.condaSubdir;
}

/**
 * Returns the conda/pixi accelerator descriptor a recipe selects, rejecting target drift — the
 * conda-forge analogue of runtimeBoxTorchBackendArguments. `metal` and `cpu` need no extra conda
 * knobs (osx-arm64 ships MPS in the pytorch build; cpu is the default build); `cuda` pins a
 * `cuda-version` and declares a CUDA system requirement so the solver picks the GPU pytorch build.
 */
export function runtimeBoxPixiAccelerator(recipe) {
  const accelerator = recipe?.target?.accelerator;
  if (accelerator === 'metal' || accelerator === 'cpu') {
    return Object.freeze({ accelerator, cudaVersion: null });
  }
  if (accelerator === 'cuda') {
    const cudaVersion = recipe?.target?.cudaVersion;
    if (typeof cudaVersion !== 'string' || !CUDA_VERSION.test(cudaVersion)) {
      throw new TypeError('A CUDA Runtime Box target requires a numeric major.minor CUDA version');
    }
    return Object.freeze({ accelerator, cudaVersion });
  }
  throw new TypeError(`Unsupported Runtime Box accelerator: ${accelerator}`);
}
