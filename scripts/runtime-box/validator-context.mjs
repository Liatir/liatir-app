import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { runtimeBoxTargetId } from './targets.mjs';

/** Resolves a scientific validator exclusively from the catalog-checked recipe and target inputs. */
export async function loadRuntimeBoxValidatorContext({
  root,
  defaultRecipeId,
  runtimeDirectoryEnvironment,
}) {
  const recipeId = process.env.LIATIR_RUNTIME_BOX_RECIPE_ID ?? defaultRecipeId;
  const recipePath = join(root, 'runtime-boxes', 'recipes', recipeId, 'recipe.json');
  const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
  const targetId = runtimeBoxTargetId(recipe.target);
  if (
    process.env.LIATIR_RUNTIME_BOX_TARGET_ID
    && process.env.LIATIR_RUNTIME_BOX_TARGET_ID !== targetId
  ) {
    throw new Error(
      `Requested target ${process.env.LIATIR_RUNTIME_BOX_TARGET_ID} does not match recipe ${targetId}.`,
    );
  }
  const runtimeDir = resolve(
    process.env[runtimeDirectoryEnvironment]
      ?? join(root, '.runtime-box-build', recipeId, 'payload'),
  );
  const python = join(runtimeDir, ...recipe.pythonEntryPoint.split('/'));
  // A pixi recipe pins its dependencies in pixi.lock; the legacy uv path uses requirements.lock.
  const lockFile = recipe.pixiVersion ? 'pixi.lock' : recipe.requirementsLock;
  const lockPath = join(dirname(recipePath), lockFile);
  const dependencyLockSha256 = createHash('sha256')
    .update(await readFile(lockPath))
    .digest('hex');
  return {
    recipeId,
    recipePath,
    recipe,
    targetId,
    runtimeDir,
    python,
    dependencyLockSha256,
  };
}

/** Maps a recipe target accelerator to the explicit product-runner request. */
export function productAcceleratorForTarget(target) {
  if (target.accelerator === 'metal') return 'mps';
  if (target.accelerator === 'cuda' || target.accelerator === 'cpu') {
    return target.accelerator;
  }
  throw new Error(`Unsupported scientific validator accelerator ${target.accelerator}.`);
}

/** Normalizes product runner backend labels into Runtime Box target accelerator identities. */
export function runtimeBoxAcceleratorKind(value) {
  const normalized = String(value).toLowerCase();
  if (normalized.startsWith('cuda')) return 'cuda';
  if (normalized.startsWith('mps') || normalized.includes('metal')) return 'metal';
  if (normalized.startsWith('cpu')) return 'cpu';
  throw new Error(`Unrecognized product accelerator ${value}.`);
}
