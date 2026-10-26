import type { LiatirPluginRuntimesAPI } from '@liatir/core';
import type { LiatirAPI } from '../../../types';

export function buildPluginRuntimes(core: { invoke: LiatirAPI['invoke'] }): LiatirPluginRuntimesAPI {
  return {
    status: path => core.invoke('lia_liatir_runtime_status', { path }),
    prepare: path => core.invoke('lia_liatir_runtime_prepare', { path }),
    trustNative: path => core.invoke('lia_liatir_native_trust', { path }),
  };
}
