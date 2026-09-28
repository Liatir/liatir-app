/**
 * The catalogue of external command-line dependencies Liatir knows about.
 *
 * One entry per binary, and each entry carries everything the app needs to *reason* about that
 * dependency: which versions work, how to install it on each platform, and how to recognise the
 * common ways it goes wrong.
 *
 * The design point is that this table is the only place these facts live. The Dependencies screen,
 * the resolvers, the AI-Model compatibility checks and the install commands all read from here — so
 * supporting a new tool means adding one entry, and nothing else in the app has to change.
 *
 * The failure-diagnosis fields (`wrongToolPatterns`, `homebrewLinkConflict`) are what let the app
 * explain a broken dependency instead of merely reporting it — see `dependencies/resolvers/`.
 */
import { versionGte, versionLt } from '$lib/utils/versions';

export interface InstallCmd {
  platform: string;
  cmd: string;
}

export interface DownloadOption {
  label: string;
  url: string;
  recommended?: boolean;
}

export interface DepRequirement {
  binary: string;
  label: string;
  description: string;
  /** Inclusive lower bound; the upper bound is exclusive — an untested new release is not assumed to work. */
  minVersion: string;
  maxVersionExclusive?: string;
  /** Human-readable version range, e.g. "3.10, 3.11, or 3.12". Shown instead of the raw bounds. */
  versionLabel?: string;
  /** `global` is always checked; `model-runtime` only matters for models that ask for it. */
  scope?: 'global' | 'model-runtime' | 'optional';
  category?: 'core-runtime' | 'bioinformatics' | 'workflow' | 'ai-runtime';
  /** Why Liatir needs this at all — shown to the user, who is entitled to ask. */
  reason?: string;
  releasesUrl: string;
  // Package-manager names. They differ per manager (and from the binary's own name), which is
  // precisely why they are recorded rather than derived.
  brew?: string;
  apt?: string;
  conda?: string;
  condaChannel?: string;
  /**
   * Signatures that identify a *different* program answering to this binary's name — a real hazard in
   * bioinformatics, where short names collide. Matched against the tool's `--version` output.
   */
  wrongToolPatterns?: string[];
  wrongToolMessage?: string;
  /**
   * Set when finding the binary proves nothing and only a successful version probe does.
   *
   * Detection reports `available` for anything on PATH, and a `version` of `null` normally just
   * means "it works, it simply did not say which release" — harmless. For `java` on macOS it is not
   * harmless: the system ships a launcher stub at `/usr/bin/java` that is present even when no JVM
   * is installed at all, so the file is always there and "found it" is not evidence of anything.
   * Every real JVM answers a version probe, which makes silence the reliable signal.
   */
  versionMustBeDetectable?: boolean;
  /** Present when a known Homebrew formula can shadow this binary; drives the one-click relink fix. */
  homebrewLinkConflict?: {
    blockerFormula: string;
    targetFormula: string;
    binary: string;
    actionLabel: string;
    confirmTitle: string;
    confirmMessage: string;
  };
  downloadOptions?: DownloadOption[];
  /** Copy-pasteable commands per platform — the fallback for users with no supported package manager. */
  installCmds: InstallCmd[];
}

export const DEP_REQUIREMENTS: Record<string, DepRequirement> = {
  python: {
    binary: 'python',
    label: 'Python',
    description:
      'Python runtime used by managed local AI Models. Liatir creates isolated environments per runtime, but it needs a compatible host Python.',
    minVersion: '3.10',
    maxVersionExclusive: '3.13',
    versionLabel: '3.10, 3.11, or 3.12',
    category: 'core-runtime',
    reason: 'Local AI Models use isolated Python runtimes, and the current protein structure stack requires Python >=3.10,<3.13.',
    releasesUrl: 'https://www.python.org/downloads/',
    brew: 'python@3.12',
    apt: 'python3.12 python3.12-venv',
    conda: 'python=3.12',
    condaChannel: 'conda-forge',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install python@3.12' },
      { platform: 'Ubuntu', cmd: 'sudo apt install python3.12 python3.12-venv' },
      { platform: 'conda', cmd: 'conda install -c conda-forge python=3.12' },
    ],
  },
  'python3.10': {
    binary: 'python3.10',
    label: 'Python 3.10',
    description: 'Host Python runtime used by model boxes that require Python 3.10.',
    minVersion: '3.10',
    maxVersionExclusive: '3.11',
    versionLabel: '3.10.x',
    scope: 'model-runtime',
    category: 'ai-runtime',
    reason: 'Required by Borzoi and compatible with TensorFlow-based regulatory AI Models.',
    releasesUrl: 'https://www.python.org/downloads/release/python-310/',
    brew: 'python@3.10',
    apt: 'python3.10 python3.10-venv',
    conda: 'python=3.10',
    condaChannel: 'conda-forge',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install python@3.10' },
      { platform: 'Ubuntu', cmd: 'sudo apt install python3.10 python3.10-venv' },
      { platform: 'conda', cmd: 'conda install -c conda-forge python=3.10' },
    ],
  },
  'python3.11': {
    binary: 'python3.11',
    label: 'Python 3.11',
    description: 'Host Python runtime recommended for TensorFlow 2.15 AI Model boxes.',
    minVersion: '3.11',
    maxVersionExclusive: '3.12',
    versionLabel: '3.11.x',
    scope: 'model-runtime',
    category: 'ai-runtime',
    reason: 'Recommended for Enformer and Basenji TensorFlow runtime boxes.',
    releasesUrl: 'https://www.python.org/downloads/release/python-311/',
    brew: 'python@3.11',
    apt: 'python3.11 python3.11-venv',
    conda: 'python=3.11',
    condaChannel: 'conda-forge',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install python@3.11' },
      { platform: 'Ubuntu', cmd: 'sudo apt install python3.11 python3.11-venv' },
      { platform: 'conda', cmd: 'conda install -c conda-forge python=3.11' },
    ],
  },
  'python3.12': {
    binary: 'python3.12',
    label: 'Python 3.12',
    description: 'Host Python runtime for general local AI runtimes.',
    minVersion: '3.12',
    maxVersionExclusive: '3.13',
    versionLabel: '3.12.x',
    scope: 'model-runtime',
    category: 'ai-runtime',
    reason: 'Supported by most current local AI runtimes, but not by the TensorFlow 2.15 regulatory runtime boxes.',
    releasesUrl: 'https://www.python.org/downloads/release/python-312/',
    brew: 'python@3.12',
    apt: 'python3.12 python3.12-venv',
    conda: 'python=3.12',
    condaChannel: 'conda-forge',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install python@3.12' },
      { platform: 'Ubuntu', cmd: 'sudo apt install python3.12 python3.12-venv' },
      { platform: 'conda', cmd: 'conda install -c conda-forge python=3.12' },
    ],
  },
  java: {
    binary: 'java',
    label: 'Java',
    description:
      'Java Runtime Environment required by Java-based bioinformatics tools such as SnpEff.',
    minVersion: '21',
    category: 'bioinformatics',
    // The one dependency where "the command exists" and "the tool works" genuinely come apart.
    versionMustBeDetectable: true,
    wrongToolMessage:
      'A java command was found but it reports no version, so it is not a working Java runtime. macOS ships this placeholder even when no Java is installed.',
    releasesUrl: 'https://adoptium.net/temurin/releases/',
    downloadOptions: [
      { label: 'Eclipse Temurin', url: 'https://adoptium.net/temurin/releases/', recommended: true },
      { label: 'Oracle JDK', url: 'https://www.oracle.com/java/technologies/downloads/' },
      { label: 'OpenJDK', url: 'https://jdk.java.net/' },
    ],
    installCmds: [
      { platform: 'macOS', cmd: 'brew install --cask temurin@21' },
      { platform: 'Ubuntu', cmd: 'sudo apt install temurin-21-jdk' },
      { platform: 'conda', cmd: 'conda install -c conda-forge openjdk=21' },
    ],
  },
  samtools: {
    binary: 'samtools',
    label: 'samtools',
    description:
      'Toolkit for SAM/BAM/CRAM files. Used to sort, index, view, filter alignments, and generate mapping statistics.',
    minVersion: '1.12',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/samtools/samtools/releases/latest',
    brew: 'samtools',
    apt: 'samtools',
    conda: 'samtools',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install samtools' },
      { platform: 'Ubuntu', cmd: 'sudo apt install samtools' },
      { platform: 'conda', cmd: 'conda install -c bioconda samtools' },
    ],
  },
  bcftools: {
    binary: 'bcftools',
    label: 'bcftools',
    description:
      'Variant calling and VCF/BCF manipulation toolkit from the samtools/htslib ecosystem.',
    minVersion: '1.12',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/samtools/bcftools/releases/latest',
    brew: 'bcftools',
    apt: 'bcftools',
    conda: 'bcftools',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install bcftools' },
      { platform: 'Ubuntu', cmd: 'sudo apt install bcftools' },
      { platform: 'conda', cmd: 'conda install -c bioconda bcftools' },
    ],
  },
  seqkit: {
    binary: 'seqkit',
    label: 'seqkit',
    description:
      'Toolkit for FASTA/FASTQ manipulation and sequence statistics such as lengths, GC content, and N50.',
    minVersion: '0.16.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/shenwei356/seqkit/releases/latest',
    brew: 'seqkit',
    conda: 'seqkit',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install seqkit' },
      { platform: 'Ubuntu', cmd: 'conda install -c bioconda seqkit' },
      { platform: 'conda', cmd: 'conda install -c bioconda seqkit' },
    ],
  },
  fastp: {
    binary: 'fastp',
    label: 'fastp',
    description:
      'FASTQ quality trimming and filtering tool that removes adapters and low-quality bases and emits QC reports.',
    minVersion: '0.23.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/OpenGene/fastp/releases/latest',
    brew: 'fastp',
    apt: 'fastp',
    conda: 'fastp',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install fastp' },
      { platform: 'Ubuntu', cmd: 'sudo apt install fastp' },
      { platform: 'conda', cmd: 'conda install -c bioconda fastp' },
    ],
  },
  bwa: {
    binary: 'bwa',
    label: 'bwa',
    description:
      'Burrows-Wheeler Aligner for short reads. BWA-MEM maps reads to a reference genome and outputs SAM/BAM.',
    minVersion: '0.7.17',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/lh3/bwa/releases/latest',
    brew: 'bwa',
    apt: 'bwa',
    conda: 'bwa',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install bwa' },
      { platform: 'Ubuntu', cmd: 'sudo apt install bwa' },
      { platform: 'conda', cmd: 'conda install -c bioconda bwa' },
    ],
  },
  minimap2: {
    binary: 'minimap2',
    label: 'minimap2',
    description:
      'Versatile aligner for long reads, short reads, and genome-to-genome alignments. Outputs SAM or PAF.',
    minVersion: '2.24',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/lh3/minimap2/releases/latest',
    brew: 'minimap2',
    apt: 'minimap2',
    conda: 'minimap2',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install minimap2' },
      { platform: 'Ubuntu', cmd: 'sudo apt install minimap2' },
      { platform: 'conda', cmd: 'conda install -c bioconda minimap2' },
    ],
  },
  simpleaf: {
    binary: 'simpleaf',
    label: 'simpleaf',
    description:
      'Single-cell RNA-seq workflow driver. Builds the reference index and runs mapping and quantification in one command, writing an AnnData .h5ad count matrix.',
    minVersion: '0.28.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/COMBINE-lab/simpleaf/releases/latest',
    conda: 'simpleaf',
    condaChannel: 'bioconda',
    installCmds: [
      { platform: 'conda', cmd: 'conda install -c bioconda simpleaf' },
    ],
  },
  'alevin-fry': {
    binary: 'alevin-fry',
    label: 'alevin-fry',
    description:
      'Single-cell quantification engine. Turns mapped reads into a per-cell, per-gene count matrix through permit-list generation, collation and UMI resolution.',
    minVersion: '0.18.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/COMBINE-lab/alevin-fry/releases/latest',
    conda: 'alevin-fry',
    condaChannel: 'bioconda',
    installCmds: [
      { platform: 'conda', cmd: 'conda install -c bioconda alevin-fry' },
    ],
  },
  h5repack: {
    binary: 'h5repack',
    label: 'h5repack',
    description:
      'Rewrites an HDF5 file with different compression, leaving its contents untouched.',
    minVersion: '2.2.0',
    category: 'bioinformatics',
    reason:
      'simpleaf compresses its .h5ad count matrix in a way most AnnData readers cannot open. Liatir rewrites it with standard compression, so the single-cell AI Tools and any other tool can read it.',
    releasesUrl: 'https://github.com/HDFGroup/hdf5/releases/latest',
    conda: 'hdf5',
    condaChannel: 'conda-forge',
    installCmds: [
      // hdf5plugin carries the Blosc decoder h5repack needs to read simpleaf's output.
      { platform: 'conda', cmd: 'conda install -c conda-forge hdf5 hdf5plugin' },
    ],
  },
  nextflow: {
    binary: 'nextflow',
    label: 'Nextflow',
    description:
      'Scientific workflow system for scalable DSL2 pipelines, automatic parallelization, and containerized execution.',
    minVersion: '22.10.0',
    category: 'workflow',
    releasesUrl: 'https://github.com/nextflow-io/nextflow/releases/latest',
    brew: 'nextflow',
    conda: 'nextflow',
    condaChannel: 'conda-forge',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install nextflow' },
      { platform: 'conda', cmd: 'conda install -c conda-forge nextflow' },
    ],
  },
  snakemake: {
    binary: 'snakemake',
    label: 'Snakemake',
    description:
      'Python-based workflow manager with rule-based dependency graphs, conda environments, and cluster/container support.',
    minVersion: '7.0.0',
    category: 'workflow',
    releasesUrl: 'https://github.com/snakemake/snakemake/releases/latest',
    brew: 'snakemake',
    conda: 'snakemake',
    condaChannel: 'bioconda',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install snakemake' },
      { platform: 'conda', cmd: 'conda install -c bioconda snakemake' },
    ],
  },
};

/** Scope defaults to `global`, so omitting it means "every user needs this". */
export function depScope(req: DepRequirement | undefined): NonNullable<DepRequirement['scope']> {
  return req?.scope ?? 'global';
}

/**
 * A "soft" dependency is one whose absence is not a problem in itself.
 *
 * A model-runtime Python is only needed by the models that ask for it, and an optional tool by
 * definition is not required. Reporting those as missing on the Dependencies screen would alarm a
 * user about something that is not actually wrong.
 */
export function isSoftDep(req: DepRequirement | undefined): boolean {
  const scope = depScope(req);
  return scope === 'model-runtime' || scope === 'optional';
}

/**
 * Whether a detected version satisfies its requirement — the single answer both the Dependencies
 * screen and the per-tool `DepCheck` card read, so the two can never disagree about one dependency.
 *
 * An undetectable version passes by default: most tools that decline to identify themselves still
 * work. `versionMustBeDetectable` inverts that for the requirements where silence is itself the
 * failure.
 */
export function depVersionSatisfied(
  version: string | null,
  req: DepRequirement | undefined
): boolean {
  if (!req) return true;
  if (!version) return !req.versionMustBeDetectable;
  if (!versionGte(version, req.minVersion)) return false;
  if (req.maxVersionExclusive && !versionLt(version, req.maxVersionExclusive)) return false;
  return true;
}

/** The version requirement as displayed: an explicit label wins, else the bounds are rendered. */
export function depRequirementLabel(req: DepRequirement): string {
  if (req.versionLabel) return req.versionLabel;
  if (req.maxVersionExclusive) return `${req.minVersion} - <${req.maxVersionExclusive}`;
  return `${req.minVersion}+`;
}

/**
 * Secondary index by `binary`, because a requirement's *key* in the table is not always its binary
 * name — so lookups have to work either way (see `depRequirementForBinary`).
 */
const DEP_REQUIREMENTS_BY_BINARY = new Map(
  Object.values(DEP_REQUIREMENTS).map((req) => [req.binary, req])
);

/** Looks a requirement up by table key first, then by binary name. */
export function depRequirementForBinary(binary: string): DepRequirement | undefined {
  return DEP_REQUIREMENTS[binary] ?? DEP_REQUIREMENTS_BY_BINARY.get(binary);
}

/** Normalises a key-or-binary into the actual binary name to probe on PATH. */
export function dependencyBinaryForKeyOrBinary(value: string): string {
  return depRequirementForBinary(value)?.binary ?? value;
}

/**
 * The binaries checked on every startup. Derived from the table rather than listed by hand, so a
 * requirement cannot be added to the catalogue and then forgotten by the detection pass.
 */
export const GLOBAL_DEPENDENCY_BINARIES = Object.values(DEP_REQUIREMENTS)
  .filter((req) => depScope(req) === 'global')
  .map((req) => req.binary);
