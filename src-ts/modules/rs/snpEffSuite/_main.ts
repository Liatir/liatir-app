import type { LiatirAPI } from '../../../types';
import type {
  LiatirSnpEffDatabaseInstallResult,
  LiatirSnpEffSuiteInstallResult,
  LiatirSnpEffSuiteStatus,
} from '@liatir/core';
import type { SnpEffSuiteInterface } from './_types';

export function buildSnpEffSuite(
  core: { invoke: LiatirAPI['invoke'] },
): SnpEffSuiteInterface {
  return {
    status: () => core.invoke<LiatirSnpEffSuiteStatus>('lia_snpeff_suite_status'),
    install: (version, downloadId, jobId) =>
      core.invoke<LiatirSnpEffSuiteInstallResult>('lia_snpeff_suite_install', {
        version,
        downloadId,
        jobId,
      }),
    remove: () => core.invoke<boolean>('lia_snpeff_suite_remove'),
    installDatabase: (id, suiteVersion, downloadId, jobId) =>
      core.invoke<LiatirSnpEffDatabaseInstallResult>('lia_snpeff_database_install', {
        id,
        suiteVersion,
        downloadId,
        jobId,
      }),
    removeDatabase: (database) => core.invoke<boolean>('lia_snpeff_database_remove', database),
  };
}
