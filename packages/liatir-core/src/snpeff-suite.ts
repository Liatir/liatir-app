/** Shared contract for Liatir's optional, app-managed SnpEff and SnpSift suite. */

export const LIATIR_SNPEFF_SUITE_CATALOG_KIND = "liatir.snpeff-suite.catalog" as const;
export const LIATIR_SNPEFF_SUITE_INSTALLATION_KIND = "liatir.snpeff-suite.installation" as const;
export const LIATIR_SNPEFF_DATABASE_INSTALLATION_KIND = "liatir.snpeff-database.installation" as const;

export interface LiatirSnpEffArchive {
  format: "zip";
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface LiatirSnpEffSuiteRelease {
  version: string;
  releasedAt: string;
  javaMinMajor: number;
  databaseSeries: string;
  license: { spdxId: "MIT"; url: string };
  archive: LiatirSnpEffArchive;
}

export interface LiatirSnpEffDatabaseCatalogEntry {
  id: string;
  label: string;
  species: { commonName: string; scientificName: string; taxonId: number };
  assembly: string;
  annotation: { provider: string; release: string };
  suiteVersion: string;
  databaseSeries: string;
  archive: LiatirSnpEffArchive;
}

export interface LiatirSnpEffSuiteCatalog {
  schemaVersion: 1;
  kind: typeof LIATIR_SNPEFF_SUITE_CATALOG_KIND;
  recommendedVersion: string;
  releases: LiatirSnpEffSuiteRelease[];
  databases: LiatirSnpEffDatabaseCatalogEntry[];
}

export interface LiatirInstalledSnpEffComponent {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface LiatirInstalledSnpEffSuite {
  schemaVersion: 1;
  kind: typeof LIATIR_SNPEFF_SUITE_INSTALLATION_KIND;
  version: string;
  archiveSha256: string;
  installDir: string;
  databaseSeries: string;
  installedAt: string;
  components: {
    snpEff: LiatirInstalledSnpEffComponent;
    snpSift: LiatirInstalledSnpEffComponent;
    config: LiatirInstalledSnpEffComponent;
    license: LiatirInstalledSnpEffComponent;
  };
}

export interface LiatirInstalledSnpEffDatabase {
  schemaVersion: 1;
  kind: typeof LIATIR_SNPEFF_DATABASE_INSTALLATION_KIND;
  id: string;
  label: string;
  suiteVersion: string;
  databaseSeries: string;
  archiveSha256: string;
  installDir: string;
  installedAt: string;
}

export interface LiatirSnpEffSuiteStatus {
  catalog: LiatirSnpEffSuiteCatalog;
  active: LiatirInstalledSnpEffSuite | null;
  installedReleases: LiatirInstalledSnpEffSuite[];
  databases: LiatirInstalledSnpEffDatabase[];
  dataDir: string;
}

export interface LiatirSnpEffSuiteInstallResult {
  active: LiatirInstalledSnpEffSuite;
  reused: boolean;
}

export interface LiatirSnpEffDatabaseInstallResult {
  installed: LiatirInstalledSnpEffDatabase;
  reused: boolean;
}
