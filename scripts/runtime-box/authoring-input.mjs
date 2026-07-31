import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { boxTargetId } from 'scrollcase/contract/browser';

function readDocument(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function matchingScrollPaths(scrollsDir, recipeId) {
  const matches = [];
  for (const boxId of existsSync(scrollsDir) ? readdirSync(scrollsDir) : []) {
    const boxDirectory = resolve(scrollsDir, boxId);
    if (!statSync(boxDirectory).isDirectory()) continue;
    for (const targetId of readdirSync(boxDirectory)) {
      const path = resolve(boxDirectory, targetId, 'scroll.json');
      if (!existsSync(path)) continue;
      const scroll = readDocument(path);
      if (scroll.scrollId === recipeId) matches.push(path);
    }
  }
  return matches;
}

/**
 * Resolves one stable Liatir recipe identity to its active authoring document.
 *
 * Migrated targets live only in the canonical Scrollcase v2 tree. Targets still
 * waiting for P5.4 remain readable by Liatir's CI/evidence compatibility layer,
 * while the stable build command continues to reject schema-v1 authoring.
 */
export function resolveRuntimeBoxAuthoringInput({
  recipeId,
  recipesDir,
  scrollsDir,
  expectedBoxId,
  expectedTargetId,
  allowLegacy = true,
}) {
  const legacyPath = resolve(recipesDir, recipeId, 'recipe.json');
  const matches = matchingScrollPaths(scrollsDir, recipeId);
  if (matches.length > 1) {
    throw new Error(`Expected one v2 scroll for ${recipeId}, found ${matches.length}.`);
  }
  if (matches.length === 1) {
    if (existsSync(legacyPath)) {
      throw new Error(`Both v2 and legacy authoring inputs exist for ${recipeId}.`);
    }
    const documentPath = matches[0];
    const document = readDocument(documentPath);
    const targetId = boxTargetId(document.target);
    if (
      document.schemaVersion !== 2
      || document.scrollId !== recipeId
      || typeof document.scrollVersion !== 'string'
      || !document.scrollVersion
      || (expectedBoxId && document.boxId !== expectedBoxId)
      || (expectedTargetId && targetId !== expectedTargetId)
    ) {
      throw new Error(`Invalid Scrollcase v2 authoring identity for ${recipeId}.`);
    }
    const directory = resolve(documentPath, '..');
    return {
      kind: 'scroll-v2',
      document,
      documentPath,
      directory,
      lockPath: resolve(directory, 'pixi.lock'),
      authoringId: document.scrollId,
      authoringVersion: document.scrollVersion,
      targetId,
    };
  }

  if (!allowLegacy) throw new Error(`Missing Scrollcase v2 authoring input for ${recipeId}.`);
  if (!existsSync(legacyPath)) throw new Error(`Missing authoring input for ${recipeId}.`);
  const document = readDocument(legacyPath);
  if (
    document.recipeId !== recipeId
    || (expectedBoxId && document.boxId !== expectedBoxId)
    || (expectedTargetId && boxTargetId(document.target) !== expectedTargetId)
  ) {
    throw new Error(`Invalid legacy authoring identity for ${recipeId}.`);
  }
  const directory = resolve(legacyPath, '..');
  const lockName = document.pixiVersion ? 'pixi.lock' : document.requirementsLock;
  return {
    kind: 'legacy-recipe',
    document,
    documentPath: legacyPath,
    directory,
    lockPath: resolve(directory, lockName),
    authoringId: document.recipeId,
    authoringVersion: document.recipeVersion,
    targetId: boxTargetId(document.target),
  };
}
