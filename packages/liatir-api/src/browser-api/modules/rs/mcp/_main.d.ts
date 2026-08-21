import type { LiatirAPI } from '../../../types';
import type { McpInterface } from './_types';
/** Native-only MCP administration. These commands are not exposed to .lia plugin IPC. */
export declare function buildMcp(core: {
    invoke: LiatirAPI['invoke'];
}): McpInterface;
