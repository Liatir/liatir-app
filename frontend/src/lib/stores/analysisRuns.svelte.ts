import { liatir } from '$lib/api';
import type { ToolOutput } from '$lib/types/tool-output';
import type { RunOutputFile } from '$lib/types/pipeline';

export type { RunOutputFile };

export interface AnalysisRunMeta {
  id: string;
  tool: string;
  label: string;
  inputs: string[];
  inputSizes?: number[];
  outputSize?: number;
  outputFiles?: RunOutputFile[];
  params: Record<string, unknown>;
  status: 'done' | 'error';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error: string | null;
}

export interface AnalysisRun extends AnalysisRunMeta {
  output: ToolOutput | null;
  log?: string[];
}

const DIR = 'analysis-runs';
const INDEX = `${DIR}/index.json`;
const MAX_RUNS = 200;
const LOG_TTL_MS = 7 * 24 * 3600 * 1000;

function runPath(id: string) { return `${DIR}/${id}.json`; }
function logPath(id: string) { return `${DIR}/${id}.log.json`; }

function createAnalysisRunsStore() {
  let runs = $state<AnalysisRunMeta[]>([]);
  let initialized = false;
  const outputCache = new Map<string, ToolOutput | null>();

  async function persistIndex() {
    const api = liatir();
    if (!api) return;
    await api.desktop.fs.data.writeText(INDEX, JSON.stringify(runs), { createDirs: true });
  }

  return {
    get runs() { return runs; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        const exists = await api.desktop.fs.data.exists(INDEX);
        if (exists) {
          const raw = await api.desktop.fs.data.readText(INDEX);
          const parsed = JSON.parse(raw) as AnalysisRunMeta[];
          const seen = new Set<string>();
          runs = parsed.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        }
      } catch { runs = []; }
      // Clean up log files older than TTL
      const cutoff = Date.now() - LOG_TTL_MS;
      for (const run of runs) {
        if (run.endedAt < cutoff) {
          api.desktop.fs.data.remove(logPath(run.id)).catch(() => {});
        }
      }
    },

    async add(run: AnalysisRun) {
      const api = liatir();
      if (!api) return;

      const serialized = JSON.stringify(run.output);

      // Write output to its own file
      await api.desktop.fs.data.writeText(
        runPath(run.id),
        serialized,
        { createDirs: true },
      );

      // Persist log if present
      if (run.log && run.log.length > 0) {
        await api.desktop.fs.data.writeText(logPath(run.id), JSON.stringify(run.log), { createDirs: true });
      }

      // Cache it immediately so the first view is instant
      outputCache.set(run.id, run.output);

      // Get output file size
      let outputSize: number | undefined;
      try {
        const dataPath = await api.desktop.fs.data.path();
        outputSize = (await api.invoke('lia_file_size', {
          path: `${dataPath}/${runPath(run.id)}`,
        })) as number;
      } catch { /* size stays undefined */ }

      // Update index (meta only, no output/log)
      const { output: _output, log: _log, ...meta } = run;
      runs = [{ ...meta, outputSize }, ...runs.filter(r => r.id !== run.id)].slice(0, MAX_RUNS);
      await persistIndex();
    },

    async remove(id: string) {
      const api = liatir();
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

      const api = liatir();
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

    async loadLog(id: string): Promise<string[] | null> {
      const api = liatir();
      if (!api) return null;
      try {
        const exists = await api.desktop.fs.data.exists(logPath(id));
        if (!exists) return null;
        const raw = await api.desktop.fs.data.readText(logPath(id));
        return JSON.parse(raw) as string[];
      } catch { return null; }
    },
  };
}

export const analysisRuns = createAnalysisRunsStore();
