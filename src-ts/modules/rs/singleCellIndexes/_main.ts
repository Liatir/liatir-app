import type { LiatirAPI } from '../../../types';
import type {
  LiatirInstalledSingleCellIndex,
  LiatirSingleCellIndexCatalogResult,
  LiatirSingleCellIndexInstallResult,
} from '@liatir/core';
import type { SingleCellIndexesInterface } from './_types';

export function buildSingleCellIndexes(
  core: { invoke: LiatirAPI['invoke'] },
): SingleCellIndexesInterface {
  return {
    catalog: () =>
      core.invoke<LiatirSingleCellIndexCatalogResult>('lia_single_cell_indexes_catalog'),
    installed: () =>
      core.invoke<LiatirInstalledSingleCellIndex[]>('lia_single_cell_indexes_installed'),
    install: (id, version, downloadId) =>
      core.invoke<LiatirSingleCellIndexInstallResult>('lia_single_cell_index_install', {
        id,
        version,
        downloadId,
      }),
    remove: (id, version, archiveSha256) =>
      core.invoke<boolean>('lia_single_cell_index_remove', { id, version, archiveSha256 }),
  };
}
