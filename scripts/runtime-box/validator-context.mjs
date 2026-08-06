import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveRuntimeBoxAuthoringInput } from './authoring-input.mjs';
import { runtimeBoxTargetId } from './targets.mjs';
import { resolveWorkspace } from './workspace.mjs';

/** Resolves a scientific validator exclusively from the catalog-checked recipe and target inputs. */
export async function loadRuntimeBoxValidatorContext({
  root,
  defaultRecipeId,
  runtimeDirectoryEnvironment,
}) {
  const recipeId = process.env.LIATIR_RUNTIME_BOX_RECIPE_ID ?? defaultRecipeId;
  const authoring = resolveRuntimeBoxAuthoringInput({
    root,
    recipeId,
    scrollsDir: join(root, 'runtime-boxes', 'scrolls'),
  });
  const recipePath = authoring.documentPath;
  const recipe = authoring.document;
  const workspace = resolveWorkspace({ cwd: root });
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
      ?? join(workspace.buildDir, authoring.authoringId, 'payload'),
  );
  const python = join(runtimeDir, ...recipe.pythonEntryPoint.split('/'));
  const dependencyLockSha256 = createHash('sha256')
    .update(await readFile(authoring.lockPath))
    .digest('hex');
  return {
    recipeId,
    authoringId: authoring.authoringId,
    authoringVersion: authoring.authoringVersion,
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
