#!/usr/bin/env node

/**
 * Write the Tauri updater manifest (`latest.json`) served at updates.liatir.com.
 *
 * Installed copies trust an update only through the signature beside each updater artifact, so the
 * manifest carries those signatures verbatim and points at where the artifacts are downloaded
 * from. It only writes a file: uploading it is the publishing step, authorized separately.
 *
 *   node scripts/desktop-update-manifest.mjs --version 0.1.0 \
 *     --download-base https://github.com/Liatir/liatir-releases/releases/download/v0.1.0 \
 *     --darwin-aarch64 path/to/Liatir.app.tar.gz --linux-x86_64 path/to/Liatir_0.1.0_amd64.AppImage \
 *     --out latest.json [--notes "What changed"]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The updater platform keys Liatir ships; Windows updates through the Microsoft Store. */
const PLATFORMS = ['darwin-aarch64', 'linux-x86_64'];

/**
 * Builds the manifest from each platform's artifact path. The artifact's `.sig` must sit beside it,
 * as the release build leaves it, and every platform must be present: a manifest missing one
 * would tell that platform's installations there is nothing newer.
 */
export function updateManifest({ version, downloadBase, artifacts, notes = '', publishedAt, readText }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('--version must be a semantic version');
  if (!/^https:\/\//.test(downloadBase ?? '')) throw new Error('--download-base must be an HTTPS URL');
  const platforms = {};
  for (const platform of PLATFORMS) {
    const artifact = artifacts[platform];
    if (!artifact) throw new Error(`Missing the ${platform} updater artifact`);
    platforms[platform] = {
      signature: readText(`${artifact}.sig`).trim(),
      url: `${downloadBase.replace(/\/$/, '')}/${encodeURIComponent(basename(artifact))}`,
    };
  }
  return { version, notes, pub_date: publishedAt, platforms };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith('--') || argv[index + 1] === undefined) throw new Error(`Expected --name value pairs, got ${name}`);
    options[name.slice(2)] = argv[index + 1];
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.out) throw new Error('--out is required');
  const artifacts = Object.fromEntries(PLATFORMS.map((platform) => [platform, options[platform] && resolve(options[platform])]));
  for (const path of Object.values(artifacts)) {
    if (path && !existsSync(`${path}.sig`)) throw new Error(`No updater signature beside ${path}`);
  }
  const manifest = updateManifest({
    version: options.version,
    downloadBase: options['download-base'],
    artifacts,
    notes: options.notes ?? '',
    publishedAt: new Date().toISOString(),
    readText: (path) => readFileSync(path, 'utf8'),
  });
  writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${options.out} for Liatir ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
