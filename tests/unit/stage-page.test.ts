import { expect, it } from 'vitest';
import gallery from '../fixtures/stage-gallery.json';
import { checkPage } from '../../frontend/stage-kit/spec/check';
import { readers } from '../../frontend/stage-kit/spec/data';
import { BLOCK_TYPES, ICONS, examplePage, pageFormat, pageGuide, type Block, type BlockOf, type Page } from '../../frontend/stage-kit/spec/page';
import { describeSources, sourceTables } from '../../frontend/stage-kit/spec/tables';

const tables = sourceTables(gallery.sources);
const galleryPage = gallery.page as Page;
/** A copy of the gallery page with one change, as the model's answer. */
const answer = (change: (page: Page) => void) => {
  const page = structuredClone(galleryPage);
  change(page);
  return JSON.stringify(page);
};
const firstBlock = <K extends Block['type']>(page: Page, type: K) => page.sections.flatMap((section) => section.blocks).find((block) => block.type === type) as BlockOf<K>;

it('accepts the gallery page, which uses every element type', () => {
  const { page, problems } = checkPage(JSON.stringify(galleryPage), tables);
  expect(problems).toEqual([]);
  const used = new Set<string>();
  for (const block of page!.sections.flatMap((section) => section.blocks)) {
    used.add(block.type);
    const inner = block.type === 'tabs' ? block.tabs.flatMap((tab) => tab.blocks) : 'blocks' in block ? block.blocks : [];
    for (const child of inner) used.add(child.type);
  }
  expect([...used].sort()).toEqual([...BLOCK_TYPES].sort());
});

it('finds the tables of the sources and describes them to the model with a few rows', () => {
  expect(tables.map((table) => [table.id, table.label, table.result, table.rows.length])).toEqual([
    ['T1', 'Best pose per ligand', 'Docking of 6 ligands', 6],
    ['T2', 'Summary values', 'Docking of 6 ligands', 2],
    ['T3', 'Key numbers', 'Docking of 6 ligands', 1],
    ['T4', 'Reads per step', 'Read filtering', 4],
  ]);
  const text = describeSources(gallery.sources, tables);
  expect(text).toContain('T1 "Best pose per ligand": 6 rows. Columns: "Ligand" (text), "Vina score (kcal/mol)" (number, -11.2 to -4.8)');
  expect(text).toContain('imatinib | -11.2 | 9 | kinase inhibitor | 493.6');
  expect(text).toContain('Text "Notes": Adapters were removed before quality filtering.');
});

it('reads values from the saved tables instead of trusting retyped ones', () => {
  const chart = readers['bar-chart'](firstBlock(galleryPage, 'bar-chart'), tables);
  expect(chart.labels).toEqual(['imatinib', 'ponatinib', 'nilotinib', 'dasatinib', 'aspirin', 'caffeine']);
  expect(chart.series).toEqual([{ name: 'Vina score (kcal/mol)', values: [-11.2, -10.9, -10.4, -9.1, -5.3, -4.8] }]);
  expect(chart.origin.table?.result).toBe('Docking of 6 ligands');
  expect(readers['key-number'](firstBlock(galleryPage, 'key-number'), tables)).toMatchObject({ text: '-11.2', origin: { note: 'min of "Vina score (kcal/mol)"' } });
  const scatter = readers['scatter-chart'](firstBlock(galleryPage, 'scatter-chart'), tables);
  expect(scatter.series.map((group) => [group.name, group.points.length])).toEqual([['kinase inhibitor', 4], ['control', 2]]);
  // A group column splits one measured column into stacked groups that share the same ranges.
  const histogram = readers.histogram({ type: 'histogram', data: { table: 'T1', y: ['Vina score (kcal/mol)'], group: 'Family' } }, tables);
  expect(histogram.series.map((group) => [group.name, group.values.length])).toEqual([['kinase inhibitor', 4], ['control', 2]]);
  expect(histogram.axis).toBe('Vina score (kcal/mol)');
  const limited = readers['bar-chart']({ type: 'bar-chart', data: { table: 'T1', x: 'Ligand', y: ['Poses'], sort: 'descending', limit: 2 } }, tables);
  expect(limited.origin.note).toBe('highest 2 of 6 rows');
  // The threshold takes plain numbers; labels are optional, and must then match one to one.
  expect(readers.threshold({ type: 'threshold', label: 'Mito %', pass: 'below', data: { name: 'Mito %', values: [1.5, 3, 8.5] } }, tables).labels).toBeUndefined();
  expect(() => readers.threshold({ type: 'threshold', label: 'Mito %', pass: 'below', data: { name: 'Mito %', values: [1.5, 3], labels: ['cell 1'] } }, tables))
    .toThrow('"labels" has 1 entries for 2 values: give one label per value, or leave "labels" out');
  expect(readers.threshold(firstBlock(galleryPage, 'threshold'), tables)).toMatchObject({ name: 'Vina score (kcal/mol)', labels: ['imatinib', 'nilotinib', 'dasatinib', 'ponatinib', 'aspirin', 'caffeine'] });
  // Typed values carry no table, which is what makes the frame label them.
  expect(readers['line-chart'](firstBlock(galleryPage, 'line-chart'), tables).origin.table).toBeUndefined();
});

it('says how many rows had no number wherever numbers are computed from a table', () => {
  const qc = [{ id: 'T1', label: 'Cells', result: 'QC', source: 0, columns: ['Sample', 'Mito %'], rows: [['a', 1.5], ['b', 'NA'], ['a', 3], ['b', '']] }];
  expect(readers['key-number']({ type: 'key-number', label: 'Mean', value: { table: 'T1', column: 'Mito %', stat: 'mean' } }, qc))
    .toMatchObject({ text: '2.25', origin: { note: 'mean of "Mito %"; 2 rows without a number left out' } });
  expect(readers.histogram({ type: 'histogram', data: { table: 'T1', y: ['Mito %'] } }, qc).origin.note)
    .toBe('2 rows without a number in "Mito %" left out');
  expect(readers['box-plot']({ type: 'box-plot', data: { table: 'T1', y: ['Mito %'], group: 'Sample' } }, qc).origin.note)
    .toBe('"Mito %" by "Sample"; 2 rows without a number left out');
});

it('holds the model to the tables and columns that exist, and offers no table forms without tables', () => {
  const withTables = JSON.stringify(pageFormat(tables));
  expect(withTables).toContain('"enum":["T1","T2","T3","T4"]');
  expect(withTables).toContain('"Vina score (kcal/mol)"');
  const without = JSON.stringify(pageFormat([]));
  expect(without).not.toContain('"stat"');
  expect(without).not.toContain('"enum":[]');
  for (const format of [withTables, without]) expect(format).not.toContain('"x-');
  expect(checkPage(JSON.stringify(galleryPage), []).problems.length).toBeGreaterThan(0);
});

it('says where each problem is, in plain words', () => {
  const problems = (change: (page: Page) => void) => checkPage(answer(change), tables).problems;
  expect(problems((page) => { (page.sections[0].blocks[0] as { type: string }).type = 'video'; })[0]).toMatch(/^Section 1, element 1 has no known type \("video"\)/);
  expect(problems((page) => { firstBlock(page, 'bar-chart').data = { table: 'T1', x: 'Ligand', y: ['Score'] }; })[0])
    .toMatch(/^Section 3, element 4, data\.y\[0\] is "Score" but must be one of: "Ligand", "Vina score \(kcal\/mol\)"/);
  expect(problems((page) => { firstBlock(page, 'bar-chart').data = { table: 'T1', x: 'Ligand', y: ['Family'] }; }))
    .toEqual(['Section 3, element 4 (bar-chart): column "Family" of T1 holds text, not numbers.']);
  expect(problems((page) => { firstBlock(page, 'line-chart').data = { labels: ['a', 'b'], series: [{ name: 'RMSD', values: [1] }] }; }))
    .toEqual(['Section 4, element 1 (line-chart): series "RMSD" has 1 values for 2 labels.']);
  expect(problems((page) => { firstBlock(page, 'quiz').answer = 3; })).toEqual(['Section 6, element 3 (quiz): answer is 3 but there are only 2 options.']);
  expect(problems((page) => { page.sections[7].blocks = [{ type: 'card', blocks: [{ type: 'pie-chart', data: { table: 'T1', x: 'Ligand', y: ['Poses', 'Weight (Da)'] } }] }]; }))
    .toEqual(['Section 8, element 1, inner element 1 (pie-chart): a pie chart shows one series, but 2 were given: keep one column in "y" or one entry in "series".']);
  expect(problems((page) => { page.sections = []; })).toEqual(['sections needs at least 2 entries.']);
  expect(checkPage('{"title": "Cut o', tables).problems[0]).toContain('cut off');
});

it('treats an empty optional field as not given', () => {
  const { page, problems } = checkPage(answer((page) => { Object.assign(firstBlock(page, 'quote'), { author: '' }); }), tables);
  expect(problems).toEqual([]);
  expect(firstBlock(page!, 'quote')).not.toHaveProperty('author');
});

it('writes the guide from the definitions and gives an example that passes the check', () => {
  for (const available of [tables, []]) {
    const guide = pageGuide(available);
    for (const type of BLOCK_TYPES) expect(guide).toContain(`- ${type}: `);
    expect(guide).toContain(`ICON = ${ICONS.join('|')}`);
    expect(guide.includes('read from a table')).toBe(available.length > 0);
    expect(checkPage(JSON.stringify(examplePage(available)), available).problems).toEqual([]);
  }
});
