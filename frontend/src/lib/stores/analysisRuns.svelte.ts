import { offlab } from '$lib/api';
import type { ToolOutput } from '$lib/types/tool-output';

export interface AnalysisRunMeta {
  id: string;
  tool: string;
  label: string;
  inputs: string[];
  inputSizes?: number[];
  outputSize?: number;
  params: Record<string, unknown>;
  status: 'done' | 'error';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error: string | null;
}

export interface AnalysisRun extends AnalysisRunMeta {
  output: ToolOutput | null;
}

const DIR = 'analysis-runs';
const INDEX = `${DIR}/index.json`;
const MAX_RUNS = 200;

function runPath(id: string) { return `${DIR}/${id}.json`; }

function createAnalysisRunsStore() {
  let runs = $state<AnalysisRunMeta[]>([]);
  let initialized = false;
  const outputCache = new Map<string, ToolOutput | null>();

  async function persistIndex() {
    const api = offlab();
    if (!api) return;
    await api.desktop.fs.data.writeText(INDEX, JSON.stringify(runs), { createDirs: true });
  }

  return {
    get runs() { return runs; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = offlab();
      if (!api) return;
      try {
        const exists = await api.desktop.fs.data.exists(INDEX);
        if (exists) {
          const raw = await api.desktop.fs.data.readText(INDEX);
          runs = JSON.parse(raw) as AnalysisRunMeta[];
        }
      } catch { runs = []; }
    },

    async add(run: AnalysisRun) {
      const api = offlab();
      if (!api) return;

      const serialized = JSON.stringify(run.output);

      // Write output to its own file
      await api.desktop.fs.data.writeText(
        runPath(run.id),
        serialized,
        { createDirs: true },
      );

      // Cache it immediately so the first view is instant
      outputCache.set(run.id, run.output);

      // Get output file size
      let outputSize: number | undefined;
      try {
        const dataPath = await api.desktop.fs.data.path();
        outputSize = (await api.invoke('dtr_file_size', {
          path: `${dataPath}/${runPath(run.id)}`,
        })) as number;
      } catch { /* size stays undefined */ }

      // Update index (meta only, no output)
      const { output: _output, ...meta } = run;
      runs = [{ ...meta, outputSize }, ...runs].slice(0, MAX_RUNS);
      await persistIndex();
    },

    async remove(id: string) {
      const api = offlab();
      if (!api) return;

      try {
        await api.desktop.fs.data.remove(runPath(id));
      } catch { /* file may not exist */ }

      outputCache.delete(id);
      runs = runs.filter(r => r.id !== id);
      await persistIndex();
    },

    async loadOutput(id: string): Promise<ToolOutput | null> {
      if (outputCache.has(id)) return outputCache.get(id)!;

      const api = offlab();
      if (!api) return null;

      try {
        const exists = await api.desktop.fs.data.exists(runPath(id));
        if (!exists) return null;
        const raw = await api.desktop.fs.data.readText(runPath(id));
        const output = JSON.parse(raw) as ToolOutput | null;
        outputCache.set(id, output);
        return output;
      } catch { return null; }
    },

    byTool(tool: string): AnalysisRunMeta[] {
      return runs.filter(r => r.tool === tool);
    },
  };
}

export const analysisRuns = createAnalysisRunsStore();
