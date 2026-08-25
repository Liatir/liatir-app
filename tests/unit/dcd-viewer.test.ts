import { describe, expect, it } from 'vitest';
import {
  dcdFrameAsPdb,
  dcdTrajectoryAsMultiModelPdb,
  parseDcdTrajectory,
} from '../../frontend/src/lib/viewers/dcd';

function record(payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.length + 8);
  const view = new DataView(result.buffer);
  view.setInt32(0, payload.length, true);
  result.set(payload, 4);
  view.setInt32(payload.length + 4, payload.length, true);
  return result;
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output.buffer;
}

function intPayload(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return bytes;
}

function floatPayload(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function doublePayload(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
}

function fixtureDcd(options: { atomCount?: number; unitCell?: boolean; xplorControlValue?: number } = {}): ArrayBuffer {
  const atomCount = options.atomCount ?? 2;
  const header = new Uint8Array(84);
  header.set(new TextEncoder().encode('CORD'));
  const headerView = new DataView(header.buffer);
  headerView.setInt32(4, 2, true);
  if (options.unitCell) {
    headerView.setInt32(4 + 10 * 4, 1, true);
    headerView.setInt32(4 + 19 * 4, 24, true);
  } else if (options.xplorControlValue !== undefined) {
    headerView.setInt32(4 + 10 * 4, options.xplorControlValue, true);
  }
  const title = new Uint8Array(84);
  new DataView(title.buffer).setInt32(0, 1, true);
  title.set(new TextEncoder().encode('Liatir test trajectory'), 4);
  const axes = [0, 1, 2].map((axis) => floatPayload(Array.from({ length: atomCount }, (_, atom) => atom + axis * atomCount + 1)));
  const nextAxes = axes.map((axis) => {
    const view = new DataView(axis.buffer, axis.byteOffset, axis.byteLength);
    return floatPayload(Array.from({ length: atomCount }, (_, atom) => view.getFloat32(atom * 4, true) + 1));
  });
  const cell = options.unitCell ? [record(doublePayload([10, 0, 10, 0, 0, 10]))] : [];
  return concat([
    record(header), record(title), record(intPayload([atomCount])),
    ...cell, ...axes.map(record),
    ...cell, ...nextAxes.map(record),
  ]);
}

describe('lazy DCD trajectory player data', () => {
  it('parses bounded frames and applies coordinates to the linked PDB topology', () => {
    const trajectory = parseDcdTrajectory(fixtureDcd());
    expect(trajectory).toMatchObject({ atomCount: 2, sourceFrameCount: 2, sampledFrameIndexes: [0, 1] });
    expect(Array.from(trajectory.frames[1])).toEqual([2, 4, 6, 3, 5, 7]);
    const pdb = [
      'ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.00           C',
      'ATOM      2  C   ALA A   1       0.000   0.000   0.000  1.00  0.00           C',
      'END',
    ].join('\n');
    expect(dcdFrameAsPdb(pdb, trajectory.frames[0])).toContain('   1.000   3.000   5.000');
    expect(dcdTrajectoryAsMultiModelPdb(pdb, trajectory.frames))
      .toMatch(/^MODEL[\s\S]*ENDMDL\nEND\n$/);
  });

  it('rejects a topology whose atom order cannot match the trajectory', () => {
    const trajectory = parseDcdTrajectory(fixtureDcd());
    expect(() => dcdFrameAsPdb('ATOM      1  CA  ALA A   1', trajectory.frames[0])).toThrow(/starting PDB has 1 atoms/);
  });

  it('uses CHARMM header flags to read unit cells without confusing 12-atom X-PLOR coordinates', () => {
    expect(parseDcdTrajectory(fixtureDcd({ unitCell: true }))).toMatchObject({ atomCount: 2, sourceFrameCount: 2 });
    expect(parseDcdTrajectory(fixtureDcd({ atomCount: 12, xplorControlValue: 1 }))).toMatchObject({ atomCount: 12, sourceFrameCount: 2 });
  });
});
