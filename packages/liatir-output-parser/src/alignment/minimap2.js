// minimap2 — alignment presets + parse the stderr log into run stats and a ToolOutput.
// Pure functions/data; migrated from the frontend (MINIMAP2_PRESETS is also used by the UI).
export const MINIMAP2_PRESETS = [
    { value: 'sr', label: 'Short reads (Illumina)', description: 'Paired-end short reads, optimized for Illumina.' },
    { value: 'map-ont', label: 'ONT reads', description: 'Oxford Nanopore long reads.' },
    { value: 'map-pb', label: 'PacBio CLR', description: 'PacBio continuous long reads.' },
    { value: 'map-hifi', label: 'PacBio HiFi', description: 'PacBio CCS / HiFi high-accuracy reads.' },
    { value: 'asm5', label: 'Assembly (asm5)', description: 'Sequence divergence ≤5% — genome assembly alignment.' },
    { value: 'asm20', label: 'Assembly (asm20)', description: 'Sequence divergence ≤20%.' },
];
/** Parse minimap2 stderr lines (reads processed + wall time). */
export function parseMinimap2Stats(stderr) {
    let totalReads = null;
    let duration = null;
    for (const line of stderr) {
        const processedMatch = line.match(/Processed\s+(\d+)\s+reads/);
        if (processedMatch)
            totalReads = (totalReads ?? 0) + parseInt(processedMatch[1], 10);
        const durationMatch = line.match(/Real time:\s+([\d.]+)\s+sec/);
        if (durationMatch)
            duration = `${parseFloat(durationMatch[1]).toFixed(1)}s`;
    }
    return { totalReads, duration };
}
/** Build the rendered ToolOutput from parsed stats + raw stderr. */
export function minimap2ToToolOutput(stats, stderrRaw, outputPath, preset) {
    const fileName = outputPath.split(/[\\/]/).pop() ?? outputPath;
    const presetLabel = MINIMAP2_PRESETS.find((p) => p.value === preset)?.label ?? preset;
    const statsItems = [
        { label: 'Output file', value: fileName, description: 'SAM file written to disk.' },
        { label: 'Preset', value: presetLabel, description: 'Alignment mode used.' },
    ];
    if (stats.totalReads !== null)
        statsItems.push({ label: 'Reads processed', value: stats.totalReads.toLocaleString(), description: 'Total reads aligned.' });
    if (stats.duration)
        statsItems.push({ label: 'Wall time', value: stats.duration, description: 'Real elapsed time.' });
    const statsSection = { type: 'stats', cols: 4, items: statsItems };
    const rawSection = { type: 'text', label: 'minimap2 stderr', content: stderrRaw, mono: true, raw: true };
    return { sections: [statsSection, rawSection] };
}
