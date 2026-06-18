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
  minVersion: string;
  releasesUrl: string;
  downloadOptions?: DownloadOption[];
  installCmds: InstallCmd[];
}

export const DEP_REQUIREMENTS: Record<string, DepRequirement> = {
  java: {
    binary: 'java',
    label: 'Java',
    minVersion: '21',
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
    minVersion: '1.12',
    releasesUrl: 'https://github.com/samtools/samtools/releases/latest',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install samtools' },
      { platform: 'Ubuntu', cmd: 'sudo apt install samtools' },
      { platform: 'conda', cmd: 'conda install -c bioconda samtools' },
    ],
  },
  bcftools: {
    binary: 'bcftools',
    label: 'bcftools',
    minVersion: '1.12',
    releasesUrl: 'https://github.com/samtools/bcftools/releases/latest',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install bcftools' },
      { platform: 'Ubuntu', cmd: 'sudo apt install bcftools' },
      { platform: 'conda', cmd: 'conda install -c bioconda bcftools' },
    ],
  },
  seqkit: {
    binary: 'seqkit',
    label: 'seqkit',
    minVersion: '0.16.0',
    releasesUrl: 'https://github.com/shenwei356/seqkit/releases/latest',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install seqkit' },
      { platform: 'Ubuntu', cmd: 'conda install -c bioconda seqkit' },
      { platform: 'conda', cmd: 'conda install -c bioconda seqkit' },
    ],
  },
  fastp: {
    binary: 'fastp',
    label: 'fastp',
    minVersion: '0.23.0',
    releasesUrl: 'https://github.com/OpenGene/fastp/releases/latest',
    installCmds: [
      { platform: 'macOS', cmd: 'brew install fastp' },
      { platform: 'Ubuntu', cmd: 'sudo apt install fastp' },
      { platform: 'conda', cmd: 'conda install -c bioconda fastp' },
    ],
  },
};
