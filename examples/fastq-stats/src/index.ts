import { createLiatir } from "@liatir/sdk";
import { readFileSync } from "node:fs";

// Input — keys must match inputSchema in .lia-manifest.json.
export interface Input {
  fastqFile: string; // absolute path chosen in the form / wired from a pipeline
}

// Output — keys must match outputSchema. file/number outputs become pipeline handles.
export interface Output {
  reads: number;
  bases: number;
  avgLength: number;
  gcPercent: number;
  reportPath: string;
}

// `run` is the entry point Liatir calls. A Node module has BOTH Node's own APIs
// (here: node:fs) AND the full Liatir bridge — that's what makes it a "module"
// rather than a sandboxed tool.
export async function run(input: Input): Promise<Output> {
  const Liatir = await createLiatir();

  // 1) Read the input file with plain Node fs (raw filesystem access).
  const text = readFileSync(input.fastqFile, "utf-8");

  // 2) FASTQ = 4 lines per record; line 2 of each is the sequence.
  const lines = text.split(/\r?\n/);
  let reads = 0;
  let bases = 0;
  let gc = 0;
  for (let i = 0; i + 3 < lines.length; i += 4) {
    const seq = lines[i + 1] ?? "";
    if (!seq) continue;
    reads++;
    bases += seq.length;
    for (const ch of seq) {
      const c = ch.toUpperCase();
      if (c === "G" || c === "C") gc++;
    }
  }
  const avgLength = reads ? Math.round(bases / reads) : 0;
  const gcPercent = bases ? Math.round((gc / bases) * 1000) / 10 : 0;

  // 3) Write a report into Liatir's SCOPED data storage via the bridge.
  //    Note: this is NOT node:fs — it's the app's managed storage (safe-joined,
  //    shown in the Data sidebar). This is the key difference vs Node's fs.
  const reportPath = "fastq-stats/report.txt";
  await Liatir.desktop.fs.data.writeText(
    reportPath,
    `reads=${reads}\nbases=${bases}\navgLength=${avgLength}\ngcPercent=${gcPercent}\n`
  );

  // 4) The returned object is the structured result Liatir parses and shows,
  //    and whose fields drive the output handles when used in a pipeline.
  return { reads, bases, avgLength, gcPercent, reportPath };
}
