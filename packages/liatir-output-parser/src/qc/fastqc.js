// FastQC (WASM custom-tool) — types + render the FastqcResult into a ToolOutput.
// Migrated from the browser SDK (src-ts/modules/qc/fastqc) so the app and the
// @liatir/api adapter render identical reports.
function barColor(q) {
    if (q >= 30)
        return '#10b981';
    if (q >= 20)
        return '#f59e0b';
    return '#ef4444';
}
function qualityGrade(q) {
    if (q >= 30)
        return 'Excellent';
    if (q >= 20)
        return 'Acceptable';
    return 'Poor';
}
function formatBases(b) {
    if (b >= 1e9)
        return `${(b / 1e9).toFixed(2)} Gb`;
    if (b >= 1e6)
        return `${(b / 1e6).toFixed(1)} Mb`;
    return `${b.toLocaleString()} bp`;
}
/** Build the rendered ToolOutput from a FastQC WASM result. */
export function fastqcToToolOutput(r) {
    const qColor = barColor(r.meanQuality);
    const grade = qualityGrade(r.meanQuality);
    const sections = [
        {
            type: 'stats',
            cols: 4,
            items: [
                { label: 'Reads', value: r.readCount.toLocaleString(), description: 'Total number of reads in the FASTQ file.' },
                { label: 'Total Bases', value: formatBases(r.totalBases), description: 'Sum of all base pairs across all reads.' },
                { label: 'Mean Length', value: `${r.meanLength.toFixed(0)} bp`, description: 'Average read length in base pairs.' },
                { label: 'GC Content', value: `${(r.gcContent * 100).toFixed(1)}%`, description: 'Fraction of bases that are G or C. Expected 40–60% for most organisms; deviations may indicate contamination or bias.' },
            ],
        },
        {
            type: 'stats',
            cols: 3,
            items: [
                { label: 'Mean Quality', value: `Q${r.meanQuality.toFixed(1)}`, color: qColor, description: 'Mean Phred quality score across all bases. Q30 = 99.9% base-call accuracy; Q20 = 99%.' },
                { label: 'Read Length Range', value: `${r.minLength}–${r.maxLength} bp`, description: 'Shortest and longest reads found in the file.' },
                { label: 'Quality Grade', value: grade, color: qColor, description: 'Overall assessment from mean Phred score: Excellent (Q≥30), Acceptable (Q≥20), Poor (Q<20).' },
            ],
        },
    ];
    if (r.qualityPerPosition.length > 0) {
        sections.push({
            type: 'plotly',
            plotlyType: 'bar',
            title: 'Per-position Mean Quality',
            subtitle: 'Green = Q≥30 · Amber = Q≥20 · Red < Q20',
            description: 'Mean Phred quality score at each cycle position across all reads. Quality typically drops toward the 3′ end.',
            data: [
                {
                    x: r.qualityPerPosition.map((_, i) => i + 1),
                    y: r.qualityPerPosition,
                    type: 'bar',
                    marker: { color: r.qualityPerPosition.map(barColor) },
                    hovertemplate: 'Position %{x}<br>Q%{y:.1f}<extra></extra>',
                },
            ],
            layout: {
                bargap: 0.1,
                shapes: [
                    { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 30, y1: 30, line: { color: '#10b981', width: 1, dash: 'dot' } },
                    { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 20, y1: 20, line: { color: '#f59e0b', width: 1, dash: 'dot' } },
                ],
                yaxis: { range: [0, Math.max(42, ...r.qualityPerPosition) + 2] },
            },
        });
    }
    return { sections };
}
