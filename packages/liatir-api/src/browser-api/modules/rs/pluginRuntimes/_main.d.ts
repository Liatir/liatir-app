import type { LiatirPluginRuntimesAPI } from '@liatir/core';
import type { LiatirAPI } from '../../../types';
export declare function buildPluginRuntimes(core: {
    invoke: LiatirAPI['invoke'];
}): LiatirPluginRuntimesAPI;
