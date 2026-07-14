const TARGET_ACCELERATORS = {
  macos: { aarch64: ['metal', 'cpu'] },
  linux: { x86_64: ['cpu', 'cuda'] },
  windows: { x86_64: ['cpu', 'cuda'] },
};
const CUDA_VERSION = /^[1-9][0-9]*\.[0-9]+$/;

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
