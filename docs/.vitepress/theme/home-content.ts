/**
 * The home page copy, in one place.
 *
 * There are two home page components — the pre-launch one and the released one — and they used to
 * carry their own copy of every word, which is how the released page ends up shipping last year's
 * promises on launch day. Both now read this file, so the copy is written once.
 *
 * What the page claims must be something Liatir actually does. A capability that is planned but not
 * yet validated end to end does not belong here, however good it would look.
 */



export interface HomeCard {
  /** An icon name defined in `HomeIcon.vue`. */
  icon: string;
  title: string;
  text: string;
}


/** Rendered as separate lines, so the break is copy rather than markup. */
export const heroHeadline = [
  'Bioinformatics on your machine.',
  'Under your control.',
];

export const heroTagline = [
  'An open-source desktop app that runs bioinformatics tools, AI models and pipelines on your own computer.',
  'The models install in one click instead of a day of conda, Docker and CUDA versions — and nothing you open ever leaves the machine.',
];

/** Short enough to read at a glance; the pre-launch page shows them as separate metrics. */
export const heroTrust = [
  'No cloud or server',
  'No conda, no Docker',
  '100% free forever',
];

/**
 * The three reasons Liatir exists, in the order a reader needs them: what it protects, what it
 * spares you, and what makes the rest of the page possible.
 */
export const pillars: HomeCard[] = [
  {
    icon: 'shield',
    title: 'Private by design',
    text: 'Stay on your machine. No API calls, no servers, no cloud, no telemetry — Liatir runs the same on an air-gapped workstation with no access to the web as on a connected laptop.',
  },
  {
    icon: 'box',
    title: 'Models that simply install',
    text: 'Geneformer, scGPT and the rest are free to download and a day of work to install. Liatir delivers them as signed, verifiable packages: one click, no environment to build, and they run offline — on your GPU when you have one.',
  },
  {
    icon: 'link',
    title: 'Everything speaks one language',
    text: 'Native tools, AI models, your own plugins, API calls and Nextflow workflows share the same inputs, outputs, Jobs, Results and provenance. That is why any step can feed any other — and why an assistant can drive the whole thing.',
  },
];

export const sectionHead = {
  title: 'Everything in one place',
  text: 'From raw reads to annotated results without leaving your desktop — and every step hands the next one something it can actually read.',
};

/**
 * Three rows of three: what you run, how you put it together, and what you get back.
 * The grid is three columns wide, so the count stays a multiple of three.
 */
export const capabilities: HomeCard[] = [
  {
    icon: 'terminal',
    title: 'Tools, ready to run',
    text: 'FastQC, fastp, seqkit, samtools, bcftools, BWA-MEM, minimap2 and SnpEff, bundled and verified. Nothing to install and no containers to manage.',
  },
  {
    icon: 'spark',
    title: 'Local AI models',
    text: 'Single-cell embeddings and annotation, molecular relaxation and dynamics — on your own hardware, on your GPU where there is one. A model family is added only once it has been validated end to end, which is why the list grows slowly.',
  },
  {
    icon: 'workflow',
    title: 'The Nextflow you already have',
    text: 'Already trust a Nextflow pipeline? Liatir runs it as a step like any other, with the same Jobs, Results and provenance. Nothing to rewrite, nothing to abandon.',
  },
  {
    icon: 'flow',
    title: 'Visual pipelines',
    text: 'Connect tools, AI models and your own plugins by drawing the connection. No code required, unless you want it.',
  },
  {
    icon: 'plug',
    title: 'API connectors',
    text: 'Wire an external service into a workflow and drop it into a pipeline as an ordinary node — configured visually, not hand-coded.',
  },
  {
    icon: 'layers',
    title: 'One data library',
    text: 'Import a file once and use it everywhere. Liatir tracks every file by path, shows type-aware previews, and tells you when one moves or disappears.',
  },
  {
    icon: 'eye',
    title: 'Built-in viewers',
    text: 'Inspect genome tracks, protein and molecular structures, and single-cell data inline, right next to the step that produced them.',
  },
  {
    icon: 'chat',
    title: 'Your assistant can run it',
    text: 'An AI assistant on your computer can start a pipeline you saved — that exact version, with only the files you allowed, and only after you approve the run.',
  },
  {
    icon: 'bolt',
    title: 'Native speed',
    text: 'Every file read, process and parse runs in Rust through Tauri. Open a 40 GB BAM, stream gzipped FASTQ or scan a dense VCF without freezing the interface.',
  },
];
