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
  minVersion: string;
  maxVersionExclusive?: string;
  versionLabel?: string;
  scope?: 'global' | 'model-runtime' | 'optional';
  category?: 'core-runtime' | 'bioinformatics' | 'workflow' | 'ai-runtime';
  reason?: string;
  releasesUrl: string;
  brew?: string;
  apt?: string;
  conda?: string;
  condaChannel?: string;
  wrongToolPatterns?: string[];
  wrongToolMessage?: string;
  homebrewLinkConflict?: {
    blockerFormula: string;
    targetFormula: string;
    binary: string;
    actionLabel: string;
    confirmTitle: string;
    confirmMessage: string;
  };
  downloadOptions?: DownloadOption[];
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
  fastqc: {
    binary: 'fastqc',
    label: 'FastQC',
    description:
      'Quality control for raw FASTQ sequencing data. Generates per-base quality, GC content, duplication, and adapter reports.',
    minVersion: '0.11.9',
    category: 'bioinformatics',
    releasesUrl: 'https://www.bioinformatics.babraham.ac.uk/projects/fastqc/',
    brew: 'fastqc',
    apt: 'fastqc',
    conda: 'fastqc',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install fastqc' },
      { platform: 'Ubuntu', cmd: 'sudo apt install fastqc' },
      { platform: 'conda', cmd: 'conda install -c bioconda fastqc' },
    ],
  },
  hisat2: {
    binary: 'hisat2',
    label: 'HISAT2',
    description:
      'Splice-aware graph-based RNA-seq aligner for reads spanning exon-exon junctions.',
    minVersion: '2.2.1',
    category: 'bioinformatics',
    releasesUrl: 'https://daehwankimlab.github.io/hisat2/',
    apt: 'hisat2',
    conda: 'hisat2',
    installCmds: [
      { platform: 'Ubuntu', cmd: 'sudo apt install hisat2' },
      { platform: 'conda', cmd: 'conda install -c bioconda hisat2' },
    ],
  },
  star: {
    binary: 'STAR',
    label: 'STAR',
    description:
      'RNA-seq aligner for splice junction discovery and chimeric read detection.',
    minVersion: '2.7.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/alexdobin/STAR/releases/latest',
    brew: 'rna-star',
    apt: 'rna-star',
    conda: 'star',
    wrongToolPatterns: [
      'standard tap archiver',
      'schily',
      'jörg schilling',
      'joerg schilling',
      'star: star 1.7.0',
    ],
    wrongToolMessage:
      'Found the Schily star archiver, not the STAR RNA-seq aligner. Install RNA-seq STAR with rna-star; if Homebrew reports a link conflict, remove or unlink the archiver formula named star first.',
    homebrewLinkConflict: {
      blockerFormula: 'star',
      targetFormula: 'rna-star',
      binary: 'STAR',
      actionLabel: 'Resolve Homebrew link',
      confirmTitle: 'Resolve STAR link conflict',
      confirmMessage:
        'Homebrew has RNA-seq STAR installed as rna-star, but the archiver formula named star is shadowing the STAR command. Liatir can run "brew unlink star" and then "brew link rna-star". This keeps both formulas installed, but makes STAR resolve to the RNA-seq aligner.',
    },
    installCmds: [
      { platform: 'macOS', cmd: 'brew install rna-star' },
      { platform: 'Ubuntu', cmd: 'sudo apt install rna-star' },
      { platform: 'conda', cmd: 'conda install -c bioconda star' },
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
  bedtools: {
    binary: 'bedtools',
    label: 'bedtools',
    description:
      'Genome arithmetic toolkit for intersecting, merging, counting, and manipulating genomic intervals.',
    minVersion: '2.30.0',
    category: 'bioinformatics',
    releasesUrl: 'https://github.com/arq5x/bedtools2/releases/latest',
    brew: 'bedtools',
    apt: 'bedtools',
    conda: 'bedtools',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install bedtools' },
      { platform: 'Ubuntu', cmd: 'sudo apt install bedtools' },
      { platform: 'conda', cmd: 'conda install -c bioconda bedtools' },
    ],
  },
};

export function depScope(req: DepRequirement | undefined): NonNullable<DepRequirement['scope']> {
  return req?.scope ?? 'global';
}

export function isSoftDep(req: DepRequirement | undefined): boolean {
  const scope = depScope(req);
  return scope === 'model-runtime' || scope === 'optional';
}

export function depRequirementLabel(req: DepRequirement): string {
  if (req.versionLabel) return req.versionLabel;
  if (req.maxVersionExclusive) return `${req.minVersion} - <${req.maxVersionExclusive}`;
  return `${req.minVersion}+`;
}

const DEP_REQUIREMENTS_BY_BINARY = new Map(
  Object.values(DEP_REQUIREMENTS).map((req) => [req.binary, req])
);

export function depRequirementForBinary(binary: string): DepRequirement | undefined {
  return DEP_REQUIREMENTS[binary] ?? DEP_REQUIREMENTS_BY_BINARY.get(binary);
}

export function dependencyBinaryForKeyOrBinary(value: string): string {
  return depRequirementForBinary(value)?.binary ?? value;
}

export const GLOBAL_DEPENDENCY_BINARIES = Object.values(DEP_REQUIREMENTS)
  .filter((req) => depScope(req) === 'global')
  .map((req) => req.binary);
