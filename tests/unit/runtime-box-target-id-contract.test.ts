import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureUrl } from 'scrollcase/contract';
import {
  runtimeBoxTargetId as coreTargetId,
  type LiatirRuntimeBoxTarget,
} from '../../packages/liatir-core/src/runtime-box';
import { runtimeBoxTargetId as cliTargetId } from '../../scripts/runtime-box/targets.mjs';
import { runtimeBoxTargetId as signerTargetId } from '../../services/runtime-box-signer/src/policy.mjs';
import { runtimeBoxTargetIdForRoute } from '../../workers/runtime-box-registry/src/index';

interface TargetIdContract {
  valid: Array<{ name: string; target: LiatirRuntimeBoxTarget; targetId: string }>;
  invalid: Array<{ name: string; target: LiatirRuntimeBoxTarget }>;
}

const contract = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../runtime-boxes/target-id-contract.json'), 'utf8'),
) as TargetIdContract;
const publishedContract = JSON.parse(
  readFileSync(fixtureUrl('target-id-contract'), 'utf8'),
) as TargetIdContract;

describe('Runtime Box target ID cross-language contract', () => {
  it('keeps the tracked compatibility fixture identical to the published reference', () => {
    expect(contract).toEqual(publishedContract);
  });

  it('keeps core, CLI, signer, and Worker IDs identical', () => {
    for (const fixture of contract.valid) {
      expect(coreTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
      expect(cliTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
      expect(signerTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
      expect(runtimeBoxTargetIdForRoute(fixture.target), fixture.name).toBe(fixture.targetId);
    }
  });

  it('rejects unsupported targets and invalid CUDA combinations before signing or routing', () => {
    for (const fixture of contract.invalid) {
      expect(() => coreTargetId(fixture.target), fixture.name).toThrow();
      expect(() => cliTargetId(fixture.target), fixture.name).toThrow();
      expect(() => signerTargetId(fixture.target), fixture.name).toThrow();
      expect(runtimeBoxTargetIdForRoute(fixture.target), fixture.name).toBeNull();
    }
  });
});
