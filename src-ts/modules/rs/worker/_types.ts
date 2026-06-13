import { U64, U8 } from "../../../utils";

export interface WorkerInterface {
  call: (
    method: string,
    payload: WorkerCallPayload,
    timeoutMs?: U64
  ) => Promise<string>;
  status: () => Promise<boolean>;
  restart: () => Promise<boolean>;
  // delivery: (id: string, result: string) => Promise<boolean>;
  modules: {
    list: () => Promise<string[]>;
    remove: (name: string) => Promise<boolean>;
    addFromBytes: (name: string, contents: U8[]) => Promise<boolean>;
    add: (name: string, maxBytes?: U64 | undefined) => Promise<boolean>;
  };
  clearSandbox: () => Promise<boolean>;
  paths: () => Promise<{
    externalModules: string;
    sandbox: string;
  }>;
}

export type WorkerCallPayload = {
  fn: string;     // execution timeout in ms
  args: number[];      // max linear memory in MB
  [key: string]: any;       // optional (may be ignored in some runtimes)
};