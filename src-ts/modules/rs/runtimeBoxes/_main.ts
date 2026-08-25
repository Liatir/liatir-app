import type { LiatirAPI } from '../../../types';
import type {
  LiatirRuntimeComponentInstallResult,
  LiatirRuntimeComponentRollbackResult,
  LiatirRuntimeComponentStatus,
} from '@liatir/core';
import type { RuntimeBoxesInterface } from './_types';

export function buildRuntimeBoxes(
  core: { invoke: LiatirAPI['invoke'] },
): RuntimeBoxesInterface {
  return {
    status: ({ componentKind, runtimeId, packages = [], update }) =>
      core.invoke<LiatirRuntimeComponentStatus>('lia_runtime_box_status', {
        componentKind,
        runtimeId,
        packages,
        update: update ?? null,
      }),
    install: ({ componentKind, componentId, boxId, channel, registryBaseUrl, publishedTargets, downloadId }) =>
      core.invoke<LiatirRuntimeComponentInstallResult>('lia_runtime_box_install', {
        componentKind,
        componentId,
        boxId,
        channel,
        registryBaseUrl,
        targetCandidates: publishedTargets,
        downloadId,
      }),
    rollback: (componentKind, runtimeId) =>
      core.invoke<LiatirRuntimeComponentRollbackResult>('lia_runtime_box_rollback', {
        componentKind,
        runtimeId,
      }),
    remove: (componentKind, runtimeId, boxId) =>
      core.invoke<boolean>('lia_runtime_box_remove', { componentKind, runtimeId, boxId }),
    cancelDownload: (downloadId) =>
      core.invoke<boolean>('lia_managed_download_cancel', { id: downloadId }),
  };
}
