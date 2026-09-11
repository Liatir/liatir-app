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
 * Resolves one stable Liatir recipe identity to its authoring document.
 *
 * Every target lives in the canonical Scrollcase v3 tree. The schema-v1 uv path this
 * function used to fall back to is gone with the last recipe it read.
 */
export function resolveRuntimeBoxAuthoringInput({
  recipeId,
  scrollsDir,
  expectedBoxId,
  expectedTargetId,
}) {
  const matches = matchingScrollPaths(scrollsDir, recipeId);
  if (matches.length > 1) {
    throw new Error(`Expected one v3 scroll for ${recipeId}, found ${matches.length}.`);
  }
  if (matches.length === 0) {
    throw new Error(`Missing Scrollcase v3 authoring input for ${recipeId}.`);
  }
  const documentPath = matches[0];
  const document = readDocument(documentPath);
  const targetId = boxTargetId(document.target);
  if (
    document.schemaVersion !== 3
    || document.scrollId !== recipeId
    || typeof document.scrollVersion !== 'string'
    || !document.scrollVersion
    || (expectedBoxId && document.boxId !== expectedBoxId)
    || (expectedTargetId && targetId !== expectedTargetId)
  ) {
    throw new Error(`Invalid Scrollcase v3 authoring identity for ${recipeId}.`);
  }
  const directory = resolve(documentPath, '..');
  return {
    kind: 'scroll-v3',
    document,
    documentPath,
    directory,
    lockPath: resolve(directory, 'pixi.lock'),
    authoringId: document.scrollId,
    authoringVersion: document.scrollVersion,
    targetId,
  };
}
