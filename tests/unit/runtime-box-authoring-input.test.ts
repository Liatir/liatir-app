import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeBoxAuthoringInput } from '../../scripts/runtime-box/authoring-input.mjs';

describe('Runtime Box authoring input resolution', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), 'liatir-authoring-input-'));
    roots.push(root);
    const recipesDir = join(root, 'runtime-boxes', 'recipes');
    const scrollsDir = join(root, 'runtime-boxes', 'scrolls');
    await mkdir(recipesDir, { recursive: true });
    await mkdir(scrollsDir, { recursive: true });
    return { root, recipesDir, scrollsDir };
  }

  it('resolves one canonical v2 scroll by the stable recipe identity', async () => {
    const paths = await workspace();
    const directory = join(paths.scrollsDir, 'example-box', 'linux-x86_64-cpu');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'pixi.lock'), 'version: 6\n');
    await writeFile(join(directory, 'scroll.json'), JSON.stringify({
      schemaVersion: 2,
      scrollId: 'example-linux-cpu',
      scrollVersion: '1.0.0',
      boxId: 'example-box',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    }));

    expect(resolveRuntimeBoxAuthoringInput({
      ...paths,
      recipeId: 'example-linux-cpu',
      expectedBoxId: 'example-box',
      expectedTargetId: 'linux-x86_64-cpu',
    })).toMatchObject({
      kind: 'scroll-v2',
      authoringId: 'example-linux-cpu',
      authoringVersion: '1.0.0',
      targetId: 'linux-x86_64-cpu',
      lockPath: join(directory, 'pixi.lock'),
    });
  });

  it('refuses a target that has no v2 scroll instead of looking for a uv recipe', async () => {
    const paths = await workspace();
    // The schema-v1 fallback is gone. A missing scroll must fail by name rather than silently
    // resolving something else, which is what the removed legacy branch used to do.
    await mkdir(join(paths.recipesDir, 'legacy-linux-cpu'), { recursive: true });
    await writeFile(join(paths.recipesDir, 'legacy-linux-cpu', 'recipe.json'), JSON.stringify({
      recipeId: 'legacy-linux-cpu',
      recipeVersion: '1.0.0',
      boxId: 'legacy-box',
      requirementsLock: 'requirements.lock',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    }));

    expect(() => resolveRuntimeBoxAuthoringInput({
      ...paths,
      recipeId: 'legacy-linux-cpu',
    })).toThrow(/Missing Scrollcase v2 authoring input/);
  });

  it('refuses two v2 scrolls claiming the same recipe identity', async () => {
    const paths = await workspace();
    for (const boxId of ['duplicate-box-a', 'duplicate-box-b']) {
      const directory = join(paths.scrollsDir, boxId, 'linux-x86_64-cpu');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'scroll.json'), JSON.stringify({
        schemaVersion: 2,
        scrollId: 'duplicate-linux-cpu',
        scrollVersion: '1.0.0',
        boxId,
        target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
      }));
    }

    expect(() => resolveRuntimeBoxAuthoringInput({
      ...paths,
      recipeId: 'duplicate-linux-cpu',
    })).toThrow(/Expected one v2 scroll/);
  });
});
