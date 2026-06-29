export type ViewerRuntimeCapability = 'structure-3d' | 'genome-browser' | 'single-cell-spatial';
export type ViewerRuntimeInstallKind = 'managed-script' | 'planned-adapter';
export type ViewerRuntimeStatus = 'available' | 'installed' | 'unavailable' | 'error';

export interface ViewerRuntimeInstallFile {
  url: string;
  relativePath: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface ViewerRuntimeInstallSpec {
  kind: ViewerRuntimeInstallKind;
  entryFile?: string;
  files?: ViewerRuntimeInstallFile[];
  docsUrl?: string;
  note?: string;
}

export interface ViewerRuntimeDefinition {
  id: string;
  name: string;
  description: string;
  capability: ViewerRuntimeCapability;
  license: string;
  sourceUrl: string;
  install: ViewerRuntimeInstallSpec;
}

export interface ViewerRuntimeRecord extends ViewerRuntimeDefinition {
  status: ViewerRuntimeStatus;
  localPath?: string;
  entryPath?: string;
  updatedAt?: number;
  error?: string;
}

export const THREEDMOL_RUNTIME_ID = 'viewer-3dmol-js';
export const JBROWSE_RUNTIME_ID = 'viewer-jbrowse-2';
export const VITESSCE_RUNTIME_ID = 'viewer-vitessce';

export const VIEWER_RUNTIME_REGISTRY: ViewerRuntimeDefinition[] = [
  {
    id: THREEDMOL_RUNTIME_ID,
    name: '3Dmol.js',
    description: 'Interactive WebGL structure viewer for PDB, mmCIF, SDF, MOL2, XYZ, and related molecular formats.',
    capability: 'structure-3d',
    license: 'BSD-3-Clause',
    sourceUrl: 'https://3dmol.org/doc/index.html',
    install: {
      kind: 'managed-script',
      entryFile: '3Dmol-min.js',
      docsUrl: 'https://3dmol.org/doc/tutorial-embeddable.html',
      files: [
        {
          url: 'https://3Dmol.org/build/3Dmol-min.js',
          relativePath: '3Dmol-min.js',
        },
      ],
    },
  },
  {
    id: JBROWSE_RUNTIME_ID,
    name: 'JBrowse 2',
    description: 'Genome browser runtime for indexed FASTA, GFF, BAM, VCF, and AI-generated genomic tracks.',
    capability: 'genome-browser',
    license: 'MIT',
    sourceUrl: 'https://jbrowse.org/jb2/docs/embedded_components/',
    install: {
      kind: 'managed-script',
      entryFile: 'react-linear-genome-view.umd.production.min.js',
      docsUrl: 'https://jbrowse.org/jb2/docs/embedded_components/',
      note: 'Optional UMD runtime kept outside the core bundle.',
      files: [
        {
          url: 'https://unpkg.com/@jbrowse/react-linear-genome-view2@3.5.0/dist/react-linear-genome-view.umd.production.min.js',
          relativePath: 'react-linear-genome-view.umd.production.min.js',
        },
      ],
    },
  },
  {
    id: VITESSCE_RUNTIME_ID,
    name: 'Vitessce',
    description: 'Single-cell and spatial viewer runtime for AnnData-derived artifacts, embeddings, labels, and imaging layouts.',
    capability: 'single-cell-spatial',
    license: 'MIT',
    sourceUrl: 'https://vitessce.io/docs/js-overview/',
    install: {
      kind: 'planned-adapter',
      docsUrl: 'https://vitessce.io/docs/js-overview/',
      note: 'Kept outside the core bundle. Liatir currently emits Vitessce-ready artifacts and a lightweight preview while the full ESM/React adapter stays modular.',
    },
  },
];
