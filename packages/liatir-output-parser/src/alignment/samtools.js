// samtools flagstat — parse alignment statistics into a typed result and ToolOutput.
// Pure functions; migrated from the frontend.
function extractNum(line) {
    const m = line.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}
function extractPct(line) {
    const m = line.match(/\((\d+\.?\d*)%/);
    return m ? parseFloat(m[1]) : null;
}
/** Parse `samtools flagstat` stdout. */
export function parseFlagstatResult(stdout) {
    const lines = stdout.split('\n').filter((l) => l.trim());
    const find = (key) => lines.find((l) => l.includes(key)) ?? '';
    return {
        total: extractNum(find('in total')),
        mapped: extractNum(find('mapped (')),
        mappedPct: extractPct(find('mapped (')),
        duplicates: extractNum(find('duplicates')),
        duplicatesPct: extractPct(find('duplicates')),
        properlyPaired: extractNum(find('properly paired')),
        properlyPairedPct: extractPct(find('properly paired')),
        singletons: extractNum(find('singletons')),
        singletonsPct: extractPct(find('singletons')),
        secondary: extractNum(find('secondary')),
        supplementary: extractNum(find('supplementary')),
    };
}
function pctColor(pct) {
    if (pct === null)
        return '#71717a';
    if (pct >= 90)
        return '#10b981';
    if (pct >= 70)
        return '#f59e0b';
    return '#ef4444';
}
/** Build the rendered ToolOutput (mapping stats + raw text) from a parsed result. */
export function flagstatToToolOutput(r, rawStdout) {
    const mappedColor = pctColor(r.mappedPct);
    const dupColor = r.duplicatesPct !== null ? (r.duplicatesPct <= 5 ? '#10b981' : r.duplicatesPct <= 20 ? '#f59e0b' : '#ef4444') : '#71717a';
    const ppColor = pctColor(r.properlyPairedPct);
    const statsSection = {
        type: 'stats',
        cols: 4,
        items: [
            { label: 'Total Reads', value: r.total.toLocaleString(), description: 'Total reads (QC-passed + QC-failed).' },
            { label: 'Mapped', value: r.mappedPct !== null ? `${r.mappedPct.toFixed(1)}%` : r.mapped.toLocaleString(), color: mappedColor, description: 'Reads that aligned to the reference genome.' },
            { label: 'Duplicates', value: r.duplicatesPct !== null ? `${r.duplicatesPct.toFixed(1)}%` : r.duplicates.toLocaleString(), color: dupColor, description: 'PCR or optical duplicates. Lower is better.' },
            { label: 'Properly Paired', value: r.properlyPairedPct !== null ? `${r.properlyPairedPct.toFixed(1)}%` : r.properlyPaired.toLocaleString(), color: ppColor, description: 'Both mates mapped in expected orientation and distance.' },
        ],
    };
    const rawSection = { type: 'text', label: 'Raw flagstat output', content: rawStdout, mono: true, raw: true };
    return { sections: [statsSection, rawSection] };
}
