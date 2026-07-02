import type { U64, U8 } from "../../../utils/utils/_integerUtils";

export interface PluginsInterface {
  call: (
    plugin: string,
    payload: PluginCallPayload,
    timeoutMs?: U64,
    /** Host directories exposed as read-only inside the WASM sandbox.
     *  Use for large files (FASTQ, BAM, VCF…) that cannot go through stdin. */
    hostReadPaths?: string[],
  ) => Promise<PluginCallResult>;
  status: () => Promise<PluginStatusResult>;
  list: () => Promise<string[]>;
  remove: (name: string) => Promise<boolean>;
  addFromBytes: (name: string, contents: U8[]) => Promise<any>;
  add: (name: string, maxBytes?: U64 | undefined) => Promise<PluginAddResult>;
  killJobs: () => Promise<boolean>;
}

export type PluginCallPayload = {
  fn: string;
  args: number[] | Record<string, unknown>;
  [key: string]: any;
};

export type PluginStatusResult = {ready: true, runtime: string};

export type PluginCallResult = {
  durationMs: number;
  error: string|null|undefined;
  id: string;
  ok: boolean;
  stderr: string;
  stdout: string;
  value: {
    error?: string,
    value?: string|number,
    ok: boolean
  };
};

export type PluginAddResult = {
  bytes: number;
  name: string;
  path: string;
  saved: boolean;
}
