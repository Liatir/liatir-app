export interface ParsedDcdTrajectory {
  atomCount: number;
  sourceFrameCount: number;
  sampledFrameIndexes: number[];
  frames: Float32Array[];
}

interface RecordView {
  payloadOffset: number;
  byteLength: number;
  nextOffset: number;
}

function readRecord(view: DataView, offset: number, littleEndian: boolean): RecordView {
  if (offset + 8 > view.byteLength) throw new Error('The DCD file ends inside a record header.');
  const byteLength = view.getInt32(offset, littleEndian);
  if (byteLength < 0 || offset + 8 + byteLength > view.byteLength) throw new Error('The DCD file contains an invalid record length.');
  const closingLength = view.getInt32(offset + 4 + byteLength, littleEndian);
  if (closingLength !== byteLength) throw new Error('The DCD record markers do not match.');
  return { payloadOffset: offset + 4, byteLength, nextOffset: offset + byteLength + 8 };
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length));
}

/** Parse standard CHARMM/NAMD DCD coordinates and keep a bounded, evenly sampled frame set. */
export function parseDcdTrajectory(
  buffer: ArrayBufferLike,
  options: { maxFrames?: number; requestedStride?: number; maxAtomInstances?: number } = {},
): ParsedDcdTrajectory {
  const view = new DataView(buffer);
  if (view.byteLength < 100) throw new Error('The DCD trajectory is too small to contain a header.');
  const firstLittle = view.getInt32(0, true);
  const firstBig = view.getInt32(0, false);
  const littleEndian = firstLittle === 84 ? true : firstBig === 84 ? false : null;
  if (littleEndian === null) throw new Error('The file does not have a supported DCD header.');

  const header = readRecord(view, 0, littleEndian);
  if (header.byteLength !== 84 || ascii(view, header.payloadOffset, 4) !== 'CORD') {
    throw new Error('Only coordinate DCD trajectories are supported.');
  }
  const declaredFrames = view.getInt32(header.payloadOffset + 4, littleEndian);
  const fixedAtoms = view.getInt32(header.payloadOffset + 4 + 8 * 4, littleEndian);
  // CHARMM/NAMD reserve the last control integer for a format version. Only those files
  // interpret control integers 11 and 12 as the unit-cell and fourth-dimension flags.
  // Treating an X-PLOR control value as a unit-cell flag would corrupt 12-atom trajectories,
  // whose first coordinate record also happens to be 48 bytes long.
  const isCharmm = view.getInt32(header.payloadOffset + 4 + 19 * 4, littleEndian) !== 0;
  const hasUnitCell = isCharmm && view.getInt32(header.payloadOffset + 4 + 10 * 4, littleEndian) !== 0;
  const hasFourthDimension = isCharmm && view.getInt32(header.payloadOffset + 4 + 11 * 4, littleEndian) === 1;
  if (declaredFrames < 1) throw new Error('The DCD header declares no trajectory frames.');
  if (fixedAtoms !== 0) throw new Error('DCD trajectories with fixed-atom compression are not supported by the interactive player.');
  if (hasFourthDimension) throw new Error('Four-dimensional DCD trajectories are not supported by the interactive player.');

  const title = readRecord(view, header.nextOffset, littleEndian);
  if (title.byteLength < 4 || (title.byteLength - 4) % 80 !== 0) throw new Error('The DCD title record is invalid.');
  const titleCount = view.getInt32(title.payloadOffset, littleEndian);
  if (titleCount < 0 || title.byteLength !== 4 + titleCount * 80) throw new Error('The DCD title count does not match its record.');
  const atomRecord = readRecord(view, title.nextOffset, littleEndian);
  if (atomRecord.byteLength !== 4) throw new Error('The DCD atom-count record is invalid.');
  const atomCount = view.getInt32(atomRecord.payloadOffset, littleEndian);
  if (atomCount < 1 || atomCount > 250_000) throw new Error('The DCD atom count is outside the interactive player limit.');

  const requestedMaxFrames = Math.max(1, Math.min(500, Math.floor(options.maxFrames ?? 250)));
  // A frame cap alone is unsafe: 250 frames of a 200,000-atom system would allocate roughly
  // 600 MB just for coordinates, before the viewer creates its own copy. Bound the actual work.
  const maxAtomInstances = Math.max(atomCount, Math.floor(options.maxAtomInstances ?? 500_000));
  const maxFrames = Math.max(1, Math.min(requestedMaxFrames, Math.floor(maxAtomInstances / atomCount)));
  const requestedStride = Math.max(1, Math.floor(options.requestedStride ?? 1));
  const stride = Math.max(requestedStride, Math.ceil(declaredFrames / maxFrames));
  const coordinateBytes = atomCount * 4;
  const frames: Float32Array[] = [];
  const sampledFrameIndexes: number[] = [];
  let offset = atomRecord.nextOffset;
  let sourceFrame = 0;

  while (offset < view.byteLength && sourceFrame < declaredFrames) {
    let record = readRecord(view, offset, littleEndian);
    if (hasUnitCell) {
      if (record.byteLength !== 48) throw new Error(`DCD frame ${sourceFrame + 1} has an invalid unit-cell record.`);
      record = readRecord(view, record.nextOffset, littleEndian);
    }
    const xRecord = record;
    const yRecord = readRecord(view, xRecord.nextOffset, littleEndian);
    const zRecord = readRecord(view, yRecord.nextOffset, littleEndian);
    if ([xRecord, yRecord, zRecord].some((axis) => axis.byteLength !== coordinateBytes)) {
      throw new Error(`DCD frame ${sourceFrame + 1} does not contain ${atomCount} coordinates per axis.`);
    }
    if (sourceFrame % stride === 0) {
      const coordinates = new Float32Array(atomCount * 3);
      for (let atom = 0; atom < atomCount; atom += 1) {
        coordinates[atom * 3] = view.getFloat32(xRecord.payloadOffset + atom * 4, littleEndian);
        coordinates[atom * 3 + 1] = view.getFloat32(yRecord.payloadOffset + atom * 4, littleEndian);
        coordinates[atom * 3 + 2] = view.getFloat32(zRecord.payloadOffset + atom * 4, littleEndian);
      }
      if (!coordinates.every(Number.isFinite)) throw new Error(`DCD frame ${sourceFrame + 1} contains non-finite coordinates.`);
      frames.push(coordinates);
      sampledFrameIndexes.push(sourceFrame);
    }
    offset = zRecord.nextOffset;
    sourceFrame += 1;
  }
  if (sourceFrame !== declaredFrames) throw new Error(`The DCD header declares ${declaredFrames} frames, but only ${sourceFrame} complete frames were found.`);
  if (offset !== view.byteLength) throw new Error('The DCD file contains unexpected data after its declared frames.');
  return { atomCount, sourceFrameCount: sourceFrame, sampledFrameIndexes, frames };
}

/** Apply one DCD frame to the fixed-column ATOM/HETATM records of its exact starting PDB. */
export function dcdFrameAsPdb(topology: string, coordinates: Float32Array): string {
  const lines = topology.split(/\r?\n/);
  const atomLines = lines.reduce<number[]>((indexes, line, index) => {
    if (line.startsWith('ATOM  ') || line.startsWith('HETATM')) indexes.push(index);
    return indexes;
  }, []);
  if (atomLines.length !== coordinates.length / 3) {
    throw new Error(`The starting PDB has ${atomLines.length} atoms, but the DCD frame has ${coordinates.length / 3}.`);
  }
  atomLines.forEach((lineIndex, atomIndex) => {
    const line = lines[lineIndex].padEnd(80, ' ');
    const fields = [coordinates[atomIndex * 3], coordinates[atomIndex * 3 + 1], coordinates[atomIndex * 3 + 2]]
      .map((value) => value.toFixed(3).padStart(8, ' '));
    lines[lineIndex] = `${line.slice(0, 30)}${fields.join('')}${line.slice(54)}`.trimEnd();
  });
  return lines.join('\n');
}

/** Encode sampled coordinates as one PDB trajectory that 3Dmol can keep in a single viewer. */
export function dcdTrajectoryAsMultiModelPdb(topology: string, frames: Float32Array[]): string {
  if (frames.length === 0) throw new Error('The DCD trajectory has no sampled frames to display.');
  return frames.map((coordinates, index) => {
    const frame = dcdFrameAsPdb(topology, coordinates)
      .split(/\r?\n/)
      .filter((line) => line !== 'END' && !line.startsWith('MODEL ') && !line.startsWith('ENDMDL'))
      .join('\n');
    return `MODEL     ${String(index + 1).padStart(4, ' ')}\n${frame}\nENDMDL`;
  }).join('\n') + '\nEND\n';
}
