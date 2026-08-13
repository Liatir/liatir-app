import {
  LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
  assertLiatirExternalWorkflowDefinition,
  type LiatirExternalWorkflowDefinition,
} from '@liatir/core';
import { appStorage } from './app-storage';
import { createAsyncStoreInitializer } from './async-store-initializer';
import { getDataPrefix } from './workspace.svelte';

interface ExternalWorkflowFile {
  schemaVersion: typeof LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION;
  definitions: LiatirExternalWorkflowDefinition[];
}

function storagePath(): string {
  return `${getDataPrefix()}external-workflows.json`;
}

function validDefinitions(value: unknown): LiatirExternalWorkflowDefinition[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Partial<ExternalWorkflowFile>).definitions)
      ? (value as Partial<ExternalWorkflowFile>).definitions!
      : [];

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is LiatirExternalWorkflowDefinition => {
    try {
      assertLiatirExternalWorkflowDefinition(candidate as LiatirExternalWorkflowDefinition);
      const id = (candidate as LiatirExternalWorkflowDefinition).id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    } catch {
      return false;
    }
  });
}

function createExternalWorkflowsStore() {
  let definitions = $state<LiatirExternalWorkflowDefinition[]>([]);
  const initializer = createAsyncStoreInitializer();
  let writeQueue = Promise.resolve();

  function persist(): Promise<void> {
    const path = storagePath();
    const snapshot: ExternalWorkflowFile = {
      schemaVersion: LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
      definitions,
    };
    const write = writeQueue.then(() => appStorage.writeText(path, JSON.stringify(snapshot, null, 2), {
      createDirs: true,
    }));
    writeQueue = write.catch(() => {});
    return write;
  }

  return {
    get definitions() { return definitions; },

    byId(id: string): LiatirExternalWorkflowDefinition | null {
      return definitions.find((definition) => definition.id === id) ?? null;
    },

    async init(): Promise<void> {
      await initializer.run(async (isCurrent) => {
        let loaded: LiatirExternalWorkflowDefinition[] = [];
        try {
          const path = storagePath();
          if (await appStorage.exists(path)) {
            loaded = validDefinitions(JSON.parse(await appStorage.readText(path)));
          }
        } catch {
          loaded = [];
        }
        if (isCurrent()) definitions = loaded;
      });
    },

    async save(definition: LiatirExternalWorkflowDefinition): Promise<void> {
      await this.init();
      assertLiatirExternalWorkflowDefinition(definition);
      definitions = [definition, ...definitions.filter((item) => item.id !== definition.id)];
      await persist();
    },

    async remove(id: string): Promise<void> {
      await this.init();
      definitions = definitions.filter((definition) => definition.id !== id);
      await persist();
    },

    reset(): void {
      initializer.reset();
      definitions = [];
      writeQueue = Promise.resolve();
    },
  };
}

export const externalWorkflowsStore = createExternalWorkflowsStore();
