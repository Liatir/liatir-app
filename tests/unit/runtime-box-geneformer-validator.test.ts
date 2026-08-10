import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadVerified } from '../../scripts/runtime-box/assets.mjs';

const validator = readFileSync(resolve('scripts/validate-geneformer-parity.mjs'), 'utf8');

describe('Geneformer Runtime Box scientific validator', () => {
  it('uses a content-verified immutable tokenizer source instead of a partial Git clone', () => {
    expect(validator).not.toContain('--filter=blob:none');
    expect(validator).not.toContain("'clone', '--quiet'");
    expect(validator).toContain('689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002');
    expect(validator).toContain('sizeBytes: 34_686');
    expect(validator).toContain('downloadVerified');
  });

  it('binds a verified scientific asset to its declared destination', async () => {
    await expect(downloadVerified({
      label: 'Geneformer tokenizer',
      destinationSegments: ['geneformer', 'tokenizer.py'],
      url: 'https://example.invalid/tokenizer.py',
      sizeBytes: 1,
      sha256: '0'.repeat(64),
    }, resolve('unexpected.py'))).rejects.toThrow(/Unexpected asset destination/);
  });
});
