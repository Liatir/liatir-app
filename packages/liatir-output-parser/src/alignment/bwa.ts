// BWA-MEM — parse the stderr log into run stats and a ToolOutput.
// Pure functions; migrated from the frontend.

import type { ToolOutput, StatsSection, TextSection } from '../types';

export interface BwaMemStats {
  logLines: number;
  warnings: number;
  duration: string | null;
}

/** Parse BWA-MEM stderr lines (warnings + wall time). */
export function parseBwaMemStats(stderr: string[]): BwaMemStats {
  let warnings = 0;
  let duration: string | null = null;

  for (const line of stderr) {
    if (line.includes('[W::')) warnings++;
    const m = line.match(/Real time:\s+([\d.]+)\s+sec/);
    if (m) duration = `${parseFloat(m[1]).toFixed(1)}s`;
  }

  return { logLines: stderr.length, warnings, duration };
}

/** Build the rendered ToolOutput from parsed stats + raw stderr. */
export function bwaMemToToolOutput(stats: BwaMemStats, stderrRaw: string, outputPath: string): ToolOutput {
  const fileName = outputPath.split(/[\\/]/).pop() ?? outputPath;

  const statsSection: StatsSection = {
    type: 'stats',
    cols: 3,
    items: [
      { label: 'Output file', value: fileName, description: 'SAM file written to disk.' },
      ...(stats.duration ? [{ label: 'Wall time', value: stats.duration, description: 'Real elapsed time.' }] : []),
      { label: 'Warnings', value: stats.warnings === 0 ? 'None' : String(stats.warnings), color: stats.warnings > 0 ? '#f59e0b' : '#10b981', description: '[W::] lines from bwa stderr.' },
    ],
  };

  const rawSection: TextSection = { type: 'text', label: 'bwa stderr', content: stderrRaw, mono: true, raw: true };

  return { sections: [statsSection, rawSection] };
}
