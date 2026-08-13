import type {
  JsonValue,
  LiatirExecutionIdentity,
  LiatirExecutionLogEntry,
  LiatirExecutionProgress,
  LiatirExecutionRecord,
  LiatirExecutionResultPolicy,
  LiatirExecutionTerminalStatus,
} from '@liatir/core';
import {
  assertLiatirExecutionIdentity,
  finalizeLiatirExecutionRecord,
  isLiatirExecutionTerminalStatus,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { createAsyncStoreInitializer } from './async-store-initializer';
import { getDataPrefix, workspaceStore } from './workspace.svelte';

const MAX_EXECUTIONS = 500;
const MAX_LOGS_PER_EXECUTION = 2_000;
const INTERRUPTED_MESSAGE = 'Execution was interrupted before Liatir could finalize it.';

function interruptedMessage(identity: LiatirExecutionIdentity): string {
  if (identity.runKind === 'pipeline') {
    return 'Pipeline run was interrupted before Liatir could finalize it.';
  }
  if (identity.runKind === 'ai-model') {
    return 'AI Model run was interrupted before Liatir could finalize it.';
  }
  if (identity.runKind === 'lia-plugin') {
    return 'Plugin run was interrupted before Liatir could finalize it.';
  }
  return INTERRUPTED_MESSAGE;
}

function indexPath(): string {
  return `${getDataPrefix()}execution-runs/index.json`;
}

function isRecord(value: unknown): value is LiatirExecutionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<LiatirExecutionRecord>;
  if (!record.identity || typeof record.label !== 'string' || !Array.isArray(record.jobIds)) return false;
  try {
    assertLiatirExecutionIdentity(record.identity);
  } catch {
    return false;
  }
  return typeof record.startedAt === 'number' && typeof record.updatedAt === 'number';
}

export interface BeginExecutionInput {
  identity: LiatirExecutionIdentity;
  label: string;
  resultPolicy: LiatirExecutionResultPolicy;
  resultId?: string;
  inputs?: JsonValue;
  params?: JsonValue;
  startedAt?: number;
}

export interface ExecutionPayloadUpdate {
  inputs?: JsonValue;
  params?: JsonValue;
}

function createExecutionRunsStore() {
  let records = $state<LiatirExecutionRecord[]>([]);
  const controllers = new Map<string, AbortController>();
  const initializer = createAsyncStoreInitializer();
  let writeQueue = Promise.resolve();

  function enqueuePersist(path = indexPath()): Promise<void> {
    const snapshot = JSON.stringify(records.slice(0, MAX_EXECUTIONS));
    const write = writeQueue.then(() => appStorage.writeText(path, snapshot, { createDirs: true }));
    writeQueue = write.catch(() => {});
    return write;
  }

  function replace(record: LiatirExecutionRecord): void {
    records = [record, ...records.filter((item) => item.identity.runId !== record.identity.runId)]
      .slice(0, MAX_EXECUTIONS);
  }

  function requireRecord(runId: string): LiatirExecutionRecord {
    const record = records.find((item) => item.identity.runId === runId);
    if (!record) throw new Error(`Execution not found: ${runId}`);
    return record;
  }

  return {
    get records() { return records; },
    get active() {
      return records.filter((record) => !isLiatirExecutionTerminalStatus(record.status));
    },

    byId(runId: string): LiatirExecutionRecord | null {
      return records.find((record) => record.identity.runId === runId) ?? null;
    },

    childrenOf(runId: string): LiatirExecutionRecord[] {
      return records.filter((record) => record.identity.parentRunId === runId);
    },

    async init(): Promise<void> {
      await initializer.run(async (isCurrent) => {
        if (!liatir()) return;
        const path = indexPath();
        let loaded: LiatirExecutionRecord[] = [];
        try {
          if (await appStorage.exists(path)) {
            const parsed = JSON.parse(await appStorage.readText(path)) as unknown;
            if (Array.isArray(parsed)) loaded = parsed.filter(isRecord);
          }
        } catch {
          loaded = [];
        }
        if (!isCurrent()) return;

        const now = Date.now();
        const activeWorkspaceId = workspaceStore.activeId;
        const seen = new Set<string>();
        let recovered = false;
        records = loaded.filter((record) => {
          if (record.identity.workspaceId !== activeWorkspaceId) return false;
          if (seen.has(record.identity.runId)) return false;
          seen.add(record.identity.runId);
          return true;
        }).map((record) => {
          if (isLiatirExecutionTerminalStatus(record.status)) return record;
          recovered = true;
          return finalizeLiatirExecutionRecord(
            record,
            'interrupted',
            now,
            interruptedMessage(record.identity),
          );
        });

        if (recovered) await enqueuePersist(path);
      });
    },

    async begin(input: BeginExecutionInput): Promise<LiatirExecutionRecord> {
      await this.init();
      assertLiatirExecutionIdentity(input.identity);
      if (input.identity.workspaceId !== workspaceStore.activeId) {
        throw new Error('Execution workspace does not match the active workspace.');
      }
      const existing = this.byId(input.identity.runId);
      if (existing) {
        if (JSON.stringify(existing.identity) !== JSON.stringify(input.identity)) {
          throw new Error(`Execution identity collision: ${input.identity.runId}`);
        }
        if (isLiatirExecutionTerminalStatus(existing.status)) {
          throw new Error(`Execution is already terminal: ${input.identity.runId}`);
        }
        return existing;
      }
      if (input.identity.parentRunId) {
        const parent = this.byId(input.identity.parentRunId);
        if (!parent) throw new Error(`Execution parent not found: ${input.identity.parentRunId}`);
        if (
          parent.identity.workspaceId !== input.identity.workspaceId ||
          parent.identity.rootRunId !== input.identity.rootRunId
        ) {
          throw new Error('Execution child does not inherit its parent ownership.');
        }
      }

      const startedAt = input.startedAt ?? Date.now();
      const record: LiatirExecutionRecord = {
        identity: input.identity,
        label: input.label,
        status: 'running',
        resultPolicy: input.resultPolicy,
        ...(input.resultId ? { resultId: input.resultId } : {}),
        jobIds: [],
        ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
        ...(input.params !== undefined ? { params: input.params } : {}),
        logs: [],
        startedAt,
        updatedAt: startedAt,
      };
      replace(record);
      controllers.set(record.identity.runId, new AbortController());
      await enqueuePersist();
      return record;
    },

    signal(runId: string): AbortSignal | undefined {
      return controllers.get(runId)?.signal;
    },

    async attachJob(runId: string, jobId: string): Promise<void> {
      const record = requireRecord(runId);
      if (record.jobIds.includes(jobId)) return;
      replace({ ...record, jobIds: [...record.jobIds, jobId], updatedAt: Date.now() });
      await enqueuePersist();
    },

    async appendLog(
      runId: string,
      message: string,
      options: Partial<Pick<LiatirExecutionLogEntry, 'level' | 'stream' | 'timestampMs'>> = {},
    ): Promise<void> {
      const record = requireRecord(runId);
      const entry: LiatirExecutionLogEntry = {
        timestampMs: options.timestampMs ?? Date.now(),
        level: options.level ?? 'info',
        message,
        ...(options.stream ? { stream: options.stream } : {}),
      };
      replace({
        ...record,
        logs: [...record.logs, entry].slice(-MAX_LOGS_PER_EXECUTION),
        updatedAt: entry.timestampMs,
      });
      await enqueuePersist();
    },

    async setProgress(runId: string, progress: LiatirExecutionProgress): Promise<void> {
      const record = requireRecord(runId);
      if (isLiatirExecutionTerminalStatus(record.status)) return;
      replace({ ...record, progress, updatedAt: Date.now() });
      await enqueuePersist();
    },

    /** Persist resolved inputs and run evidence after a child identity has been allocated. */
    async setPayload(runId: string, update: ExecutionPayloadUpdate): Promise<void> {
      const record = requireRecord(runId);
      if (isLiatirExecutionTerminalStatus(record.status)) {
        throw new Error(`Execution is already terminal: ${runId}`);
      }
      replace({
        ...record,
        ...(update.inputs !== undefined ? { inputs: update.inputs } : {}),
        ...(update.params !== undefined ? { params: update.params } : {}),
        updatedAt: Date.now(),
      });
      await enqueuePersist();
    },

    async finish(
      runId: string,
      status: LiatirExecutionTerminalStatus,
      error: string | null = null,
      endedAt = Date.now(),
    ): Promise<LiatirExecutionRecord> {
      const record = requireRecord(runId);
      const finalized = finalizeLiatirExecutionRecord(record, status, endedAt, error);
      if (finalized !== record) {
        replace(finalized);
        controllers.delete(runId);
        await enqueuePersist();
      }
      return finalized;
    },

    async markResultFinalized(runId: string, resultId: string, finalizedAt = Date.now()): Promise<void> {
      const record = requireRecord(runId);
      if (record.finalizedAt !== undefined) return;
      if (!isLiatirExecutionTerminalStatus(record.status)) {
        throw new Error('A running execution cannot finalize a Result.');
      }
      replace({ ...record, resultId, finalizedAt, updatedAt: finalizedAt });
      await enqueuePersist();
    },

    /** Adopt an already durable Result after a crash between Result commit and lifecycle settlement. */
    async reconcileWithResult(
      runId: string,
      result: { id: string; status: 'done' | 'error' | 'cancelled'; endedAt: number; error: string | null },
    ): Promise<void> {
      const record = requireRecord(runId);
      const reconciled: LiatirExecutionRecord = {
        ...record,
        status: result.status,
        resultId: result.id,
        endedAt: result.endedAt,
        updatedAt: result.endedAt,
        error: result.error,
        finalizedAt: result.endedAt,
      };
      replace(reconciled);
      controllers.delete(runId);
      await enqueuePersist();
    },

    async cancel(runId: string): Promise<void> {
      const record = requireRecord(runId);
      if (isLiatirExecutionTerminalStatus(record.status)) return;
      const now = Date.now();
      const ownedIds = new Set([runId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of records) {
          if (candidate.identity.parentRunId && ownedIds.has(candidate.identity.parentRunId) && !ownedIds.has(candidate.identity.runId)) {
            ownedIds.add(candidate.identity.runId);
            changed = true;
          }
        }
      }
      const owned = records.filter((candidate) => ownedIds.has(candidate.identity.runId));
      for (const candidate of owned) {
        if (!isLiatirExecutionTerminalStatus(candidate.status)) {
          replace({ ...candidate, status: 'cancelling', updatedAt: now });
        }
        controllers.get(candidate.identity.runId)?.abort();
      }
      await enqueuePersist();

      const api = liatir();
      if (!api) return;
      const jobIds = [...new Set(owned.flatMap((candidate) => candidate.jobIds))];
      await Promise.all(jobIds.map((jobId) =>
        api.invoke('lia_jobs_kill', { jobId }).catch(() => false)
      ));
    },

    reset(): void {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      initializer.reset();
      records = [];
      writeQueue = Promise.resolve();
    },
  };
}

export const executionRuns = createExecutionRunsStore();
export { INTERRUPTED_MESSAGE as EXECUTION_INTERRUPTED_MESSAGE };
