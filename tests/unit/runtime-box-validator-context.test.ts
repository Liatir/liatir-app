import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadRuntimeBoxValidatorContext,
  productAcceleratorForTarget,
  runtimeBoxAcceleratorKind,
} from '../../scripts/runtime-box/validator-context.mjs';

describe('Runtime Box scientific validator context', () => {
  const originalRecipeId = process.env.LIATIR_RUNTIME_BOX_RECIPE_ID;
  const originalTargetId = process.env.LIATIR_RUNTIME_BOX_TARGET_ID;

  afterEach(() => {
    if (originalRecipeId === undefined) delete process.env.LIATIR_RUNTIME_BOX_RECIPE_ID;
    else process.env.LIATIR_RUNTIME_BOX_RECIPE_ID = originalRecipeId;
    if (originalTargetId === undefined) delete process.env.LIATIR_RUNTIME_BOX_TARGET_ID;
    else process.env.LIATIR_RUNTIME_BOX_TARGET_ID = originalTargetId;
  });

  it('maps target accelerators to explicit product requests', () => {
    expect(productAcceleratorForTarget({ accelerator: 'cpu' })).toBe('cpu');
    expect(productAcceleratorForTarget({ accelerator: 'metal' })).toBe('mps');
    expect(productAcceleratorForTarget({ accelerator: 'cuda' })).toBe('cuda');
    expect(() => productAcceleratorForTarget({ accelerator: 'other' })).toThrow(
      /Unsupported scientific validator accelerator/,
    );
  });

  it('normalizes reported product backends without accepting unknown fallback', () => {
    expect(runtimeBoxAcceleratorKind('CPU')).toBe('cpu');
    expect(runtimeBoxAcceleratorKind('Apple Metal')).toBe('metal');
    expect(runtimeBoxAcceleratorKind('mps:0')).toBe('metal');
    expect(runtimeBoxAcceleratorKind('cuda:0')).toBe('cuda');
    expect(() => runtimeBoxAcceleratorKind('unknown')).toThrow(
      /Unrecognized product accelerator/,
    );
  });

  it('rejects a checked target that does not match the selected recipe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liatir-validator-context-'));
    const recipeId = 'fixture-linux-cpu';
    const recipeDirectory = join(root, 'runtime-boxes', 'recipes', recipeId);
    await mkdir(recipeDirectory, { recursive: true });
    await writeFile(join(recipeDirectory, 'requirements.lock'), 'fixture==1.0.0\n');
    await writeFile(join(recipeDirectory, 'recipe.json'), JSON.stringify({
      recipeId,
      requirementsLock: 'requirements.lock',
      pythonEntryPoint: 'venv/bin/python',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    }));
    process.env.LIATIR_RUNTIME_BOX_RECIPE_ID = recipeId;
    process.env.LIATIR_RUNTIME_BOX_TARGET_ID = 'windows-x86_64-cpu';

    try {
      await expect(loadRuntimeBoxValidatorContext({
        root,
        defaultRecipeId: 'unused',
        runtimeDirectoryEnvironment: 'LIATIR_TEST_RUNTIME_DIR',
      })).rejects.toThrow(/does not match recipe linux-x86_64-cpu/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
