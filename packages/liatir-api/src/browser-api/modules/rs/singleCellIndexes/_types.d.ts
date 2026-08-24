import type { LiatirInstalledSingleCellIndex, LiatirSingleCellIndexCatalogResult, LiatirSingleCellIndexInstallResult } from '@liatir/core';
/** App-global lifecycle for verified, reusable single-cell reference indexes. */
export interface SingleCellIndexesInterface {
    catalog(): Promise<LiatirSingleCellIndexCatalogResult>;
    installed(): Promise<LiatirInstalledSingleCellIndex[]>;
    install(id: string, version: string, downloadId: string): Promise<LiatirSingleCellIndexInstallResult>;
    remove(id: string, version: string, archiveSha256: string): Promise<boolean>;
}
