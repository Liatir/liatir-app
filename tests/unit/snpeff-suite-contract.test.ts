import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  LIATIR_SNPEFF_DATABASE_INSTALLATION_KIND,
  LIATIR_SNPEFF_SUITE_CATALOG_KIND,
  LIATIR_SNPEFF_SUITE_INSTALLATION_KIND,
} from '../../packages/liatir-core/src/snpeff-suite';

const catalog = JSON.parse(readFileSync(
  new URL('../../snpeff-suite/catalog.json', import.meta.url),
  'utf8',
));
const rust = readFileSync(new URL('../../src-tauri/src/bridge/snpeff.rs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
const permission = readFileSync(
  new URL('../../src-tauri/permissions/liatir-bridge.toml', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../../src-ts/modules/rs/snpEffSuite/_main.ts', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../../frontend/src/routes/tools/variants/snpeff/+page.svelte', import.meta.url),
  'utf8',
);

describe('managed SnpEff and SnpSift suite contract', () => {
  it('pins one immutable official suite containing both applications', () => {
    expect(catalog.kind).toBe(LIATIR_SNPEFF_SUITE_CATALOG_KIND);
    expect(catalog.recommendedVersion).toBe('5.4c');
    expect(catalog.releases).toHaveLength(1);
    expect(catalog.releases[0]).toMatchObject({
      version: '5.4c',
      javaMinMajor: 21,
      databaseSeries: 'v5_4',
      license: { spdxId: 'MIT' },
      archive: {
        format: 'zip',
        sha256: '3b06a1e1f939e7ebd5433387f088c1d3d1e0a7d472d63f39161b1fe9f00adf33',
        sizeBytes: 66_677_840,
      },
    });
    expect(catalog.releases[0].archive.url).toContain('snpEff_v5_4c_core.zip');
    expect(JSON.stringify(catalog)).not.toMatch(/latest/i);
    expect(rust).toContain('snpEff/SnpSift.jar');
    expect(rust).toContain('snpEff/snpEff.jar');
  });

  it('publishes only checksum-bound databases compatible with the active suite', () => {
    expect(catalog.databases.map((entry: { id: string }) => entry.id)).toEqual([
      'GRCh38.115',
      'GRCm39.115',
      'GRCz11.115',
      'BDGP6.115',
      'WBcel235.115',
      'R64-1-1.115',
    ]);
    for (const database of catalog.databases) {
      expect(database.suiteVersion).toBe('5.4c');
      expect(database.databaseSeries).toBe('v5_4');
      expect(database.archive.url).toContain('/databases/v5_4/');
      expect(database.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(database.archive.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('keeps catalog, installation markers and every bridge surface aligned', () => {
    expect(LIATIR_SNPEFF_SUITE_INSTALLATION_KIND).toBe('liatir.snpeff-suite.installation');
    expect(LIATIR_SNPEFF_DATABASE_INSTALLATION_KIND).toBe('liatir.snpeff-database.installation');
    for (const command of [
      'lia_snpeff_suite_status',
      'lia_snpeff_suite_install',
      'lia_snpeff_suite_remove',
      'lia_snpeff_database_install',
      'lia_snpeff_database_remove',
    ]) {
      expect(rust).toContain(`fn ${command}`);
      expect(main).toContain(command);
      expect(permission).toContain(`"${command}"`);
      expect(bridge).toContain(`'${command}'`);
    }
  });

  it('removes the old unverified database fallback and manual download UX', () => {
    for (const source of [rust, main, permission, bridge, page]) {
      expect(source).not.toContain('lia_snpeff_download_db');
    }
    expect(rust).not.toContain('v5_0');
    expect(page).not.toContain('Download SnpEff from the official website');
    expect(page).not.toContain('openSnpEffDownloadPage');
    expect(page).toContain('Advanced: use an existing external installation');
  });
});
