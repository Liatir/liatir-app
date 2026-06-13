import { U64, U8 } from "../../../utils";

export interface PluginsInterface {
  call: (
    module: string,
    payload: PluginCallPayload,
    timeoutMs?: U64
  ) => Promise<PluginCallResult>;
  status: () => Promise<PluginStatusResult>;
  list: () => Promise<string[]>;
  remove: (name: string) => Promise<boolean>;
  addFromBytes: (name: string, contents: U8[]) => Promise<any>;
  add: (name: string, maxBytes?: U64 | undefined) => Promise<PluginAddResult>;
  killJobs: () => Promise<boolean>;
}

export type PluginCallPayload = {
  fn: string;             // function to call
  args: number[]|Record<string, unknown>;  // max linear memory in MB
  [key: string]: any;     // optional (may be ignored in some runtimes)
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

