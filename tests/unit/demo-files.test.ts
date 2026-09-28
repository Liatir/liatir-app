/** The demo files bundled with the app, and the manifest the app uses to keep its copy current. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEMO_FILES_DIR, DEMO_MANIFEST_NAME, demoFilesManifest } from '../../scripts/demo-files-manifest.mjs';

const committed = readFileSync(join(DEMO_FILES_DIR, DEMO_MANIFEST_NAME), 'utf8');
const paths: string[] = JSON.parse(committed).files.map((file: { path: string }) => file.path);

describe('bundled demo files', () => {
  it('have a manifest that matches every file byte for byte', () => {
    // A stale manifest means installed copies are never refreshed. `npm run demo-files:manifest`.
    expect(committed).toBe(demoFilesManifest());
  });

  it('sit one folder deep, one folder per task, each with its instructions', () => {
    // The app names the Data folder after the first path component, so a deeper file would be
    // filed under its top folder with no trace of the level in between.
    for (const path of paths) expect(path.split('/')).toHaveLength(2);
    for (const folder of new Set(paths.map((path) => path.split('/')[0]))) {
      expect(paths).toContain(`${folder}/How to use these files.txt`);
    }
  });

  it('ship inside the production app', () => {
    const conf = JSON.parse(readFileSync(
      new URL('../../conf-templates/tauri.conf.template.prod.json', import.meta.url),
      'utf8',
    ));
    expect(conf.bundle.resources['resources/demo-files']).toBe('demo-files');
  });
});
