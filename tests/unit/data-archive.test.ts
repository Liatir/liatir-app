import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listZipEntries, sha256File } from 'scrollcase/build';
import { afterEach, describe, expect, it } from 'vitest';
import { createDataArchive } from '../../scripts/data-archive.mjs';

describe('data archives', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  // Scrollcase's archiver came to require a runtime. Every data-archive caller kept the old
  // three-argument call, and none of them runs in the unit or verify gates, so the break surfaced
  // only when the UI profile reached its single-cell index suite.
  it('builds a reproducible archive whose data carries no executable bit', async () => {
    root = await mkdtemp(join(tmpdir(), 'liatir-data-archive-'));
    const payload = join(root, 'payload');
    await mkdir(join(payload, 'index'), { recursive: true });
    await writeFile(join(payload, 'index', 't2g_3col.tsv'), 'ENST00000000001\tENSG00000000001\tS\n');
    await writeFile(join(payload, 'bundle.json'), '{}\n');

    await createDataArchive(payload, join(root, 'first.zip'));
    await createDataArchive(payload, join(root, 'second.zip'));

    expect(await sha256File(join(root, 'first.zip'))).toBe(await sha256File(join(root, 'second.zip')));
    const files = (await listZipEntries(join(root, 'first.zip'))).filter((entry) => entry.kind === 'file');
    expect(files.map((entry) => entry.path).sort()).toEqual(['bundle.json', 'index/t2g_3col.tsv']);
    expect(files.filter((entry) => (entry.mode & 0o111) !== 0)).toEqual([]);
  });
});
