import type {
	LiatirAIModelMetadata,
	LiatirAIModelRuntimePackage,
	LiatirAIModelRuntimeSource,
} from './index';
import type { LiatirRuntimeBoxTargetCandidate } from './runtime-box';

export const MOCK_AI_MODEL_ID = 'liatir-mock-local';
export const CELLTYPIST_MODEL_ID = 'celltypist-local-annotation';
export const NUCLEOTIDE_TRANSFORMER_50M_ID = 'instadeep-nt-v2-50m-multi-species';
export const NUCLEOTIDE_TRANSFORMER_500M_ID = 'instadeep-nt-v2-500m-multi-species';
export const ENFORMER_REGULATORY_MODEL_ID = 'deepmind-enformer-regulatory';
export const BASENJI2_REGULATORY_MODEL_ID = 'calico-basenji2-human-regulatory';
export const BORZOI_K562_RNA_MODEL_ID = 'calico-borzoi-mini-k562-rna';
export const SCGPT_WHOLE_HUMAN_MODEL_ID = 'bowang-scgpt-whole-human';
export const GENEFORMER_V1_10M_MODEL_ID = 'ctheodoris-geneformer-v1-10m';
export const UCE_4LAYER_MODEL_ID = 'snap-stanford-uce-4layer';
export const SCFOUNDATION_100M_MODEL_ID = 'biomap-scfoundation-100m';
export const ESM2_8M_ID = 'facebook-esm2-8m-protein';
export const BOLTZ2_MODEL_ID = 'boltz2-local-structure-binding';
export const CHAI1_MODEL_ID = 'chai1-local-structure';

const ENFORMER_RUNTIME_PACKAGES = [
	{ package: 'tensorflow', specifier: 'tensorflow>=2.15,<2.16', importName: 'tensorflow' },
	{ package: 'numpy', specifier: 'numpy>=1.24,<2', importName: 'numpy' },
	{ package: 'pandas', specifier: 'pandas>=1.5,<3', importName: 'pandas' },
	{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' },
	{ package: 'tensorflow-hub', specifier: 'tensorflow-hub>=0.16,<1', importName: 'tensorflow_hub' }
];

const BASENJI2_RUNTIME_PACKAGES = [
	{ package: 'tensorflow', specifier: 'tensorflow>=2.15,<2.16', importName: 'tensorflow' },
	{ package: 'numpy', specifier: 'numpy>=1.24,<2', importName: 'numpy' },
	{ package: 'pandas', specifier: 'pandas>=1.5,<3', importName: 'pandas' },
	{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' },
	{ package: 'h5py', specifier: 'h5py>=3.10,<4', importName: 'h5py' },
	{ package: 'natsort', specifier: 'natsort>=8,<9', importName: 'natsort' },
	{
		package: 'basenji',
		specifier: 'git+https://github.com/calico/basenji.git@master',
		importName: 'basenji.seqnn'
	}
];

const BORZOI_MINI_K562_RNA_RUNTIME_PACKAGES = [
	{ package: 'tensorflow', specifier: 'tensorflow>=2.15,<2.16', importName: 'tensorflow' },
	{ package: 'numpy', specifier: 'numpy>=1.24,<2', importName: 'numpy' },
	{ package: 'pandas', specifier: 'pandas>=1.5,<3', importName: 'pandas' },
	{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' },
	{
		package: 'pybedtools',
		specifier: 'pybedtools==0.10.0',
		importName: 'pybedtools',
		installOptions: {
			noBuildIsolation: true
		}
	},
	{
		package: 'baskerville',
		specifier: 'git+https://github.com/calico/baskerville.git@main',
		importName: 'baskerville'
	},
	{
		package: 'borzoi',
		specifier: 'git+https://github.com/calico/borzoi.git@main',
		importName: 'borzoi'
	}
];

const UCE_4LAYER_RUNTIME_PACKAGES = [
	{ package: 'numpy', version: '1.26.4', importName: 'numpy' },
	{ package: 'scipy', version: '1.14.1', importName: 'scipy' },
	{ package: 'pandas', version: '2.2.2', importName: 'pandas' },
	{ package: 'tqdm', version: '4.66.5', importName: 'tqdm' },
	{ package: 'torch', version: '2.1.1', importName: 'torch' },
	{ package: 'scanpy', version: '1.10.2', importName: 'scanpy' },
	{ package: 'accelerate', version: '0.24.0', importName: 'accelerate' },
	{ package: 'requests', version: '2.25.1', importName: 'requests' },
	{ package: 'urllib3', version: '1.26.6', importName: 'urllib3' }
];

const GENEFORMER_V1_10M_REVISION = '04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5';
const SCGPT_WHOLE_HUMAN_REVISION = 'cebd6fae655b9c585a4807daa3ac31bb764f06b4';

const SCGPT_WHOLE_HUMAN_RUNTIME_PACKAGES = [
	{ package: 'torch', version: '2.4.1', importName: 'torch' },
	{ package: 'anndata', version: '0.10.9', importName: 'anndata' },
	{ package: 'numpy', version: '1.26.4', importName: 'numpy' },
	{ package: 'scipy', version: '1.14.1', importName: 'scipy' },
	{ package: 'pandas', version: '2.2.2', importName: 'pandas' },
	{ package: 'h5py', version: '3.11.0', importName: 'h5py' },
	{ package: 'tqdm', version: '4.66.5', importName: 'tqdm' }
];

const GENEFORMER_V1_10M_RUNTIME_PACKAGES = [
	{ package: 'torch', specifier: 'torch>=2.2,<3', importName: 'torch' },
	{ package: 'transformers', specifier: 'transformers>=4.40,<5', importName: 'transformers' },
	{ package: 'anndata', specifier: 'anndata>=0.10,<1', importName: 'anndata' },
	{ package: 'numpy', specifier: 'numpy>=1.26,<2', importName: 'numpy' },
	{ package: 'scipy', specifier: 'scipy>=1.10,<2', importName: 'scipy' },
	{ package: 'pandas', specifier: 'pandas>=2,<3', importName: 'pandas' },
	{ package: 'h5py', specifier: 'h5py>=3.10,<4', importName: 'h5py' },
	{ package: 'safetensors', specifier: 'safetensors>=0.4,<1', importName: 'safetensors' },
	{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' }
];

/** Builds the shared Apple silicon target used by published single-cell Runtime Boxes. */
function publishedMacosArm64MetalTarget(
	minRamGb: number
): readonly LiatirRuntimeBoxTargetCandidate[] {
	return [
		{
			target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
			hostEnvironments: ['native'],
			minRamGb
		}
	];
}

/** Lists the exact Geneformer targets that have completed native product validation. */
function publishedGeneformerTargets(): readonly LiatirRuntimeBoxTargetCandidate[] {
	return [
		...publishedMacosArm64MetalTarget(8),
		{
			target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
			hostEnvironments: ['native'],
			minRamGb: 8
		}
	];
}

const TENSORFLOW_PYTHON_3_10_TO_3_11 = {
	minVersion: '3.10',
	maxVersionExclusive: '3.12',
	label: 'Python 3.10 or 3.11',
	reason: 'These TensorFlow-based regulatory genomics runtimes use TensorFlow 2.15, which is not a Python 3.12 runtime.'
};

const INTERNAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
	{
		id: MOCK_AI_MODEL_ID,
		name: 'Mock Local Model',
		description:
			'Deterministic local model fixture for validating AI Tool wiring without loading model weights.',
		category: 'Development Fixtures',
		version: '0.1.0',
		runtime: {
			kind: 'mock',
			name: 'Liatir Mock Runtime',
			version: '0.1.0'
		},
		source: 'builtin',
		localOnly: true,
		capabilities: ['text-generation', 'structured-extraction'],
		modalities: ['text'],
		license: {
			name: 'Internal development fixture'
		},
		hardware: {
			cpu: true,
			gpu: false,
			minRamGb: 0,
			recommendedRamGb: 0,
			notes: 'No model weights are loaded.'
		},
		install: {
			method: 'builtin'
		},
		tags: ['mock', 'local', 'development']
	}
];

export const BUILT_IN_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
	{
		id: CELLTYPIST_MODEL_ID,
		name: 'CellTypist Local Annotation',
		description:
			'Local single-cell annotation runtime using CellTypist models for h5ad/AnnData workflows.',
		category: 'Single-cell',
		version: '1.x',
		runtime: {
			kind: 'python-venv',
			name: 'CellTypist Python Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['classification', 'cell-annotation'],
		modalities: ['single-cell'],
		license: {
			name: 'MIT License',
			spdxId: 'MIT',
			url: 'https://github.com/Teichlab/celltypist',
			verifiedAt: '2026-06-28'
		},
		hardware: {
			cpu: true,
			gpu: false,
			minRamGb: 4,
			recommendedRamGb: 8,
			notes: 'CPU runtime. Memory depends on AnnData matrix size.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'celltypist',
			modelCacheSubdir: 'model-cache/celltypist',
			runtimePackages: [
				{ package: 'celltypist', specifier: 'celltypist>=1.7,<2', importName: 'celltypist' },
				{ package: 'anndata', specifier: 'anndata>=0.10,<1', importName: 'anndata' },
				{ package: 'pandas', specifier: 'pandas>=2,<3', importName: 'pandas' },
				{ package: 'numpy', specifier: 'numpy>=1.26,<3', importName: 'numpy' },
				{ package: 'scipy', specifier: 'scipy>=1.10,<2', importName: 'scipy' },
				{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' }
			]
		},
		documentation: {
			liatirPath: '/ai/models/celltypist-local-annotation',
			officialUrl: 'https://github.com/Teichlab/celltypist'
		},
		tags: ['built-in', 'managed', 'single-cell', 'annotation']
	},
	{
		id: NUCLEOTIDE_TRANSFORMER_50M_ID,
		name: 'Nucleotide Transformer v2 50M',
		description:
			'Small/base managed local DNA/RNA embedding model for genomic sequence representations.',
		category: 'Genomics',
		version: 'v2-50m-multi-species',
		runtime: {
			kind: 'python-venv',
			name: 'Transformers PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['embedding', 'sequence-embedding', 'variant-effect-scoring'],
		modalities: ['dna', 'rna'],
		parameters: 50_000_000,
		license: {
			name: 'CC-BY-NC-SA-4.0',
			spdxId: 'CC-BY-NC-SA-4.0',
			url: 'https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-50m-multi-species',
			verifiedAt: '2026-06-28'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 8,
			recommendedRamGb: 16,
			minVramGb: 0,
			recommendedVramGb: 8,
			notes: 'CPU is supported for small batches; GPU/MPS is faster when PyTorch can use it.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'sequence-transformers',
			modelCacheSubdir: 'model-cache/huggingface',
			revision: '81b29e5786726d891dbf929404ef20adca5b36f1',
			runtimePackages: [
				{ package: 'torch', specifier: 'torch>=2.2,<3', importName: 'torch' },
				{ package: 'transformers', specifier: 'transformers>=4.40,<5', importName: 'transformers' },
				{ package: 'numpy', specifier: 'numpy>=1.26,<3', importName: 'numpy' },
				{ package: 'safetensors', specifier: 'safetensors>=0.4,<1', importName: 'safetensors' },
				{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' }
			]
		},
		documentation: {
			liatirPath: '/ai/models/instadeep-nt-v2-50m-multi-species',
			officialUrl:
				'https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-50m-multi-species'
		},
		tags: ['built-in', 'managed', 'genomics', 'embedding', 'non-commercial']
	},
	{
		id: NUCLEOTIDE_TRANSFORMER_500M_ID,
		name: 'Nucleotide Transformer v2 500M',
		description:
			'Larger managed local DNA/RNA foundation model for genomic embeddings and embedding-delta variant effect scoring.',
		category: 'Genomics',
		version: 'v2-500m-multi-species',
		runtime: {
			kind: 'python-venv',
			name: 'Transformers PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['embedding', 'sequence-embedding', 'variant-effect-scoring'],
		modalities: ['dna', 'rna'],
		parameters: 500_000_000,
		license: {
			name: 'CC-BY-NC-SA-4.0',
			spdxId: 'CC-BY-NC-SA-4.0',
			url: 'https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-500m-multi-species',
			verifiedAt: '2026-06-30'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			recommendedRamGb: 32,
			minVramGb: 0,
			recommendedVramGb: 16,
			notes:
				'Larger Nucleotide Transformer checkpoint. CPU can work for short windows, but GPU/MPS is strongly preferred for repeated variant scoring.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'sequence-transformers',
			modelCacheSubdir: 'model-cache/huggingface',
			runtimePackages: [
				{ package: 'torch', specifier: 'torch>=2.2,<3', importName: 'torch' },
				{ package: 'transformers', specifier: 'transformers>=4.40,<5', importName: 'transformers' },
				{ package: 'numpy', specifier: 'numpy>=1.26,<3', importName: 'numpy' },
				{ package: 'safetensors', specifier: 'safetensors>=0.4,<1', importName: 'safetensors' },
				{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' }
			]
		},
		documentation: {
			liatirPath: '/ai/models/instadeep-nt-v2-500m-multi-species',
			officialUrl:
				'https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-500m-multi-species'
		},
		tags: ['built-in', 'managed', 'genomics', 'variant-effect', 'embedding', 'non-commercial']
	},
	{
		id: ENFORMER_REGULATORY_MODEL_ID,
		name: 'Enformer Regulatory Prediction',
		description:
			'Managed local Enformer runtime for long-range regulatory activity prediction and variant-effect scoring from genomic sequence windows.',
		category: 'Predictive Genomics',
		version: 'tfhub-deepmind-enformer-1',
		runtime: {
			kind: 'python-venv',
			name: 'TensorFlow Regulatory Runtime',
			version: 'tensorflow-2.15'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['regulatory-prediction', 'variant-effect-scoring'],
		modalities: ['dna'],
		contextWindow: 393_216,
		license: {
			name: 'Apache License 2.0',
			spdxId: 'Apache-2.0',
			url: 'https://github.com/google-deepmind/deepmind-research/tree/master/enformer',
			verifiedAt: '2026-07-01'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			recommendedRamGb: 32,
			minVramGb: 0,
			recommendedVramGb: 16,
			notes:
				'Long input windows make CPU inference slow. GPU acceleration depends on the local TensorFlow backend.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'regulatory-enformer',
			modelCacheSubdir: 'model-cache/enformer',
			runtimePackages: ENFORMER_RUNTIME_PACKAGES,
			hostRequirements: {
				python: TENSORFLOW_PYTHON_3_10_TO_3_11
			}
		},
		documentation: {
			liatirPath: '/ai/models/deepmind-enformer-regulatory',
			officialUrl: 'https://github.com/google-deepmind/deepmind-research/tree/master/enformer',
			paperUrl: 'https://www.nature.com/articles/s41592-021-01252-x'
		},
		tags: ['built-in', 'managed', 'genomics', 'regulatory', 'variant-effect', 'commercial-use-ok']
	},
	{
		id: BASENJI2_REGULATORY_MODEL_ID,
		name: 'Basenji2 Human Regulatory',
		description:
			'Managed local Basenji2 human regulatory model for sequence activity prediction and focused variant-effect scoring.',
		category: 'Predictive Genomics',
		version: 'cross2020-human',
		runtime: {
			kind: 'python-venv',
			name: 'Basenji TensorFlow Runtime',
			version: 'tensorflow-2.15'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['regulatory-prediction', 'variant-effect-scoring'],
		modalities: ['dna'],
		contextWindow: 131_072,
		diskSizeBytes: 122_000_000,
		license: {
			name: 'Apache License 2.0',
			spdxId: 'Apache-2.0',
			url: 'https://github.com/calico/basenji',
			verifiedAt: '2026-07-01'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			recommendedRamGb: 32,
			minVramGb: 0,
			recommendedVramGb: 12,
			notes:
				'CPU inference is supported for small tests, but repeated windows are much faster on a TensorFlow GPU backend.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'regulatory-basenji2-human',
			modelCacheSubdir: 'model-cache/basenji2-human',
			runtimePackages: BASENJI2_RUNTIME_PACKAGES,
			runtimeSources: [
				{
					url: 'https://github.com/calico/basenji.git',
					revision: '06ce5d387e20b47184d05433b3983163c5f923cd',
					relativePath: 'source/basenji',
					pythonPath: true
				}
			],
			files: [
				{
					url: 'https://storage.googleapis.com/basenji_barnyard2/model_human.h5',
					relativePath: 'model_human.h5',
					sizeBytes: 120_813_856
				},
				{
					url: 'https://raw.githubusercontent.com/calico/basenji/master/manuscripts/cross2020/params_human.json',
					relativePath: 'params_human.json',
					sizeBytes: 1_377
				},
				{
					url: 'https://raw.githubusercontent.com/calico/basenji/master/manuscripts/cross2020/targets_human.txt',
					relativePath: 'targets_human.txt',
					sizeBytes: 800_919
				}
			],
			hostRequirements: {
				python: TENSORFLOW_PYTHON_3_10_TO_3_11
			}
		},
		documentation: {
			liatirPath: '/ai/models/calico-basenji2-human-regulatory',
			officialUrl: 'https://github.com/calico/basenji/tree/master/manuscripts/cross2020',
			paperUrl: 'https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1008050'
		},
		tags: ['built-in', 'managed', 'genomics', 'regulatory', 'variant-effect', 'commercial-use-ok']
	},
	{
		id: BORZOI_K562_RNA_MODEL_ID,
		name: 'Borzoi Mini K562 RNA-seq',
		description:
			'Managed local Mini Borzoi K562 RNA-seq model for RNA-seq signal prediction from genomic sequence windows.',
		category: 'Predictive Genomics',
		version: 'mini-k562-rna-f0',
		runtime: {
			kind: 'python-venv',
			name: 'Borzoi TensorFlow Runtime',
			version: 'tensorflow-2.15'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['regulatory-prediction', 'variant-effect-scoring'],
		modalities: ['dna', 'rna'],
		contextWindow: 393_216,
		diskSizeBytes: 126_000_000,
		license: {
			name: 'Apache License 2.0',
			spdxId: 'Apache-2.0',
			url: 'https://github.com/calico/borzoi',
			verifiedAt: '2026-07-01'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 24,
			recommendedRamGb: 48,
			minVramGb: 0,
			recommendedVramGb: 16,
			notes:
				'Borzoi uses very long sequence windows. CPU works for small validation runs, but GPU is strongly preferred.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'regulatory-borzoi-mini-k562-rna',
			modelCacheSubdir: 'model-cache/borzoi-mini-k562-rna',
			runtimePackages: BORZOI_MINI_K562_RNA_RUNTIME_PACKAGES,
			files: [
				{
					url: 'https://storage.googleapis.com/seqnn-share/borzoi/mini/k562_rna/f0/model0_best.h5',
					relativePath: 'model0_best.h5',
					sizeBytes: 123_809_560
				},
				{
					url: 'https://storage.googleapis.com/seqnn-share/borzoi/mini/k562_rna/params.json',
					relativePath: 'params.json',
					sizeBytes: 1_814
				},
				{
					url: 'https://storage.googleapis.com/seqnn-share/borzoi/mini/k562_rna/hg38/targets.txt',
					relativePath: 'targets.txt',
					sizeBytes: 14_149
				}
			],
			hostRequirements: {
				python: {
					minVersion: '3.10',
					maxVersionExclusive: '3.11',
					label: 'Python 3.10',
					reason:
						'The official Borzoi documentation recommends Python 3.10 with TensorFlow 2.15.x.'
				}
			}
		},
		documentation: {
			liatirPath: '/ai/models/calico-borzoi-mini-k562-rna',
			officialUrl: 'https://github.com/calico/borzoi',
			paperUrl: 'https://www.biorxiv.org/content/10.1101/2023.08.30.555582v1'
		},
		tags: ['built-in', 'managed', 'genomics', 'rna-seq', 'regulatory', 'variant-effect', 'commercial-use-ok']
	},
	{
		id: SCGPT_WHOLE_HUMAN_MODEL_ID,
		name: 'scGPT Whole-human',
		description:
			'Packaged human single-cell foundation model for deterministic local cell embeddings.',
		category: 'Single-cell Foundation Models',
		version: 'whole-human-0.2.5',
		runtime: {
			kind: 'python-venv',
			name: 'scGPT PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'runtime-box',
		localOnly: true,
		capabilities: ['single-cell-embedding'],
		modalities: ['single-cell'],
		diskSizeBytes: 310_415_585,
		license: {
			name: 'MIT License',
			spdxId: 'MIT',
			url: 'https://github.com/bowang-lab/scGPT',
			verifiedAt: '2026-07-02'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			recommendedRamGb: 32,
			minVramGb: 0,
			recommendedVramGb: 16,
			notes:
				'CPU is supported but slow. Apple Metal is preferred for interactive embedding runs on supported Macs.'
		},
		install: {
			method: 'runtime-box',
			runtimeId: 'single-cell-foundation-scgpt-whole-human',
			modelCacheSubdir: 'model-cache/scgpt-whole-human',
			revision: SCGPT_WHOLE_HUMAN_REVISION,
			runtimeBox: {
				boxId: 'scgpt-whole-human',
				channel: 'beta',
				registryBaseUrl: 'https://models.liatir.com/v1',
				publishedTargets: publishedMacosArm64MetalTarget(16)
			},
			runtimePackages: SCGPT_WHOLE_HUMAN_RUNTIME_PACKAGES,
			hostRequirements: {
				os: ['macos'],
				arch: ['aarch64'],
				reason: 'The current signed scGPT Runtime Box is built for Apple silicon Macs.'
			}
		},
		documentation: {
			liatirPath: '/ai/models/bowang-scgpt-whole-human',
			officialUrl: 'https://github.com/bowang-lab/scGPT',
			paperUrl: 'https://www.biorxiv.org/content/10.1101/2023.04.30.538439v2'
		},
		tags: ['built-in', 'runtime-box', 'single-cell', 'foundation-model', 'embedding', 'human']
	},
	{
		id: GENEFORMER_V1_10M_MODEL_ID,
		name: 'Geneformer V1 10M',
		description:
			'Packaged human single-cell transcriptome foundation model for rank-encoded cell embeddings.',
		category: 'Single-cell Foundation Models',
		version: 'v1-10m',
		runtime: {
			kind: 'python-venv',
			name: 'Geneformer PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'runtime-box',
		localOnly: true,
		capabilities: ['single-cell-embedding'],
		modalities: ['single-cell'],
		parameters: 10_000_000,
		diskSizeBytes: 201_396_104,
		license: {
			name: 'Apache License 2.0',
			spdxId: 'Apache-2.0',
			url: 'https://huggingface.co/ctheodoris/Geneformer',
			verifiedAt: '2026-07-11'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 8,
			recommendedRamGb: 16,
			minVramGb: 0,
			recommendedVramGb: 8,
			notes:
				'V1 10M can run on CPU for small datasets. CUDA or Apple Metal is preferred for larger cell batches.'
		},
		install: {
			method: 'runtime-box',
			runtimeId: 'single-cell-foundation-geneformer-v1-10m',
			modelCacheSubdir: 'model-cache/geneformer-v1-10m',
			revision: GENEFORMER_V1_10M_REVISION,
			runtimeBox: {
				boxId: 'geneformer-v1-10m',
				channel: 'beta',
				registryBaseUrl: 'https://models.liatir.com/v1',
				publishedTargets: publishedGeneformerTargets()
			},
			runtimePackages: GENEFORMER_V1_10M_RUNTIME_PACKAGES,
			hostRequirements: {
				os: ['macos', 'linux'],
				arch: ['aarch64', 'x86_64'],
				reason: 'Signed Geneformer Runtime Boxes are available for Apple silicon Macs and native Linux x86_64 hosts.'
			}
		},
		documentation: {
			liatirPath: '/ai/models/ctheodoris-geneformer-v1-10m',
			officialUrl: 'https://huggingface.co/ctheodoris/Geneformer',
			paperUrl: 'https://www.nature.com/articles/s41586-023-06139-9'
		},
		tags: ['built-in', 'runtime-box', 'single-cell', 'foundation-model', 'embedding', 'human']
	},
	{
		id: UCE_4LAYER_MODEL_ID,
		name: 'UCE 4-layer',
		description:
			'Packaged zero-shot Universal Cell Embeddings runtime for AnnData single-cell expression embeddings.',
		category: 'Single-cell Foundation Models',
		version: '4-layer',
		runtime: {
			kind: 'python-venv',
			name: 'UCE PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'runtime-box',
		localOnly: true,
		capabilities: ['single-cell-embedding'],
		modalities: ['single-cell'],
		diskSizeBytes: 10_142_871_337,
		license: {
			name: 'MIT code / CC BY 4.0 model assets',
			verifiedAt: '2026-07-13',
			components: [
				{
					scope: 'source-code',
					name: 'MIT License',
					spdxId: 'MIT',
					url: 'https://github.com/snap-stanford/UCE/blob/8ead6e07af0c80f75653598138bb704e865b45c8/LICENSE',
					sourceUrl:
						'https://github.com/snap-stanford/UCE/tree/8ead6e07af0c80f75653598138bb704e865b45c8',
					attribution: 'Copyright (c) 2023 Yanay Rosen, Yusuf Roohani, Jure Leskovec',
					verifiedAt: '2026-07-13'
				},
				{
					scope: 'model-assets',
					name: 'Creative Commons Attribution 4.0 International',
					spdxId: 'CC-BY-4.0',
					url: 'https://creativecommons.org/licenses/by/4.0/',
					sourceUrl:
						'https://figshare.com/articles/dataset/Universal_Cell_Embedding_Model_Files/24320806',
					attribution:
						'Roohani, Yusuf (2023). Universal Cell Embedding Model Files. figshare. Dataset. https://doi.org/10.6084/m9.figshare.24320806.v5',
					verifiedAt: '2026-07-13'
				}
			]
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			notes:
				'A focused 10-cell run used about 7.2 GB peak process footprint on CPU and 7.9 GB on Apple Metal on a 16 GB Apple silicon Mac. Larger datasets and batches require additional memory.'
		},
		install: {
			method: 'runtime-box',
			runtimeId: 'single-cell-foundation-uce',
			modelCacheSubdir: 'model-cache/uce',
			revision: '8ead6e07af0c80f75653598138bb704e865b45c8',
			runtimeBox: {
				boxId: 'uce-4layer',
				channel: 'beta',
				registryBaseUrl: 'https://models.liatir.com/v1',
				publishedTargets: publishedMacosArm64MetalTarget(16)
			},
			runtimePackages: UCE_4LAYER_RUNTIME_PACKAGES,
			hostRequirements: {
				os: ['macos'],
				arch: ['aarch64'],
				reason: 'The current UCE Runtime Box is built for Apple silicon Macs.'
			}
		},
		documentation: {
			liatirPath: '/ai/models/snap-stanford-uce-4layer',
			officialUrl: 'https://github.com/snap-stanford/UCE',
			paperUrl: 'https://www.biorxiv.org/content/10.1101/2023.11.28.568918v2'
		},
		tags: ['built-in', 'runtime-box', 'single-cell', 'foundation-model', 'embedding', 'zero-shot']
	},
	{
		id: SCFOUNDATION_100M_MODEL_ID,
		name: 'scFoundation 100M',
		description:
			'License-restricted single-cell foundation model candidate. Liatir cannot redistribute its weights in a managed Runtime Box.',
		category: 'Single-cell Foundation Models',
		version: '100m',
		releaseStage: 'preview',
		runtime: {
			kind: 'python-venv',
			name: 'scFoundation PyTorch Runtime',
			version: 'preview'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['single-cell-embedding', 'batch-correction'],
		modalities: ['single-cell'],
		parameters: 100_000_000,
		license: {
			name: 'scFoundation Model License (non-commercial research only)',
			url: 'https://github.com/biomap-research/scFoundation/blob/397631c495eddf9ad6644fc00c6ea8139e651245/MODEL_LICENSE',
			verifiedAt: '2026-07-12'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 24,
			recommendedRamGb: 48,
			minVramGb: 0,
			recommendedVramGb: 24,
			notes:
				'Large model candidate. Liatir should keep it behind a dedicated runtime and managed checkpoint box before exposing install.'
		},
		documentation: {
			liatirPath: '/ai/models/biomap-scfoundation-100m',
			officialUrl: 'https://github.com/biomap-research/scFoundation',
			paperUrl: 'https://www.nature.com/articles/s41592-024-02305-7'
		},
		tags: ['preview', 'license-restricted', 'single-cell', 'foundation-model', 'embedding']
	},
	{
		id: ESM2_8M_ID,
		name: 'ESM-2 8M Protein',
		description:
			'Small managed local protein language model for lightweight protein sequence embeddings.',
		category: 'Protein Language Models',
		version: 'esm2_t6_8M_UR50D',
		runtime: {
			kind: 'python-venv',
			name: 'Transformers PyTorch Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['embedding', 'sequence-embedding'],
		modalities: ['protein'],
		parameters: 8_000_000,
		license: {
			name: 'MIT License',
			spdxId: 'MIT',
			url: 'https://huggingface.co/facebook/esm2_t6_8M_UR50D',
			verifiedAt: '2026-06-28'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 4,
			recommendedRamGb: 8,
			minVramGb: 0,
			recommendedVramGb: 4,
			notes: 'Small ESM-2 model. CPU is acceptable for short sequences.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'sequence-transformers',
			modelCacheSubdir: 'model-cache/huggingface',
			revision: 'c731040fcd8d73dceaa04b0a8e6329b345b0f5df',
			runtimePackages: [
				{ package: 'torch', specifier: 'torch>=2.2,<3', importName: 'torch' },
				{ package: 'transformers', specifier: 'transformers>=4.40,<5', importName: 'transformers' },
				{ package: 'numpy', specifier: 'numpy>=1.26,<3', importName: 'numpy' },
				{ package: 'safetensors', specifier: 'safetensors>=0.4,<1', importName: 'safetensors' },
				{ package: 'urllib3', specifier: 'urllib3>=1.26,<2', importName: 'urllib3' }
			]
		},
		documentation: {
			liatirPath: '/ai/models/facebook-esm2-8m-protein',
			officialUrl: 'https://huggingface.co/facebook/esm2_t6_8M_UR50D'
		},
		tags: ['built-in', 'managed', 'protein', 'embedding']
	},
	{
		id: BOLTZ2_MODEL_ID,
		name: 'Boltz-2 Local Structure & Binding',
		description:
			'Managed local Boltz-2 runtime for protein structure prediction and optional protein-ligand affinity scoring.',
		category: 'Protein Structure',
		version: '2.x',
		runtime: {
			kind: 'python-venv',
			name: 'Boltz Python Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['protein-structure-prediction', 'protein-binding'],
		modalities: ['protein', 'ligand'],
		license: {
			name: 'MIT License',
			spdxId: 'MIT',
			url: 'https://github.com/jwohlwend/boltz',
			verifiedAt: '2026-06-29'
		},
		hardware: {
			cpu: true,
			gpu: true,
			minRamGb: 16,
			recommendedRamGb: 32,
			minVramGb: 0,
			recommendedVramGb: 16,
			notes:
				'Boltz officially supports CPU-only installs, but CPU inference is significantly slower than CUDA GPU inference.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'boltz2-structure',
			modelCacheSubdir: 'model-cache/boltz',
			runtimePackages: [
				{ package: 'boltz', specifier: 'boltz>=2,<3', importName: 'boltz' },
				{ package: 'pyyaml', specifier: 'pyyaml>=6,<7', importName: 'yaml' }
			],
			hostRequirements: {
				python: {
					minVersion: '3.10',
					maxVersionExclusive: '3.13',
					label: 'Python 3.10, 3.11, or 3.12',
					reason: 'The official Boltz Python package declares Python >=3.10,<3.13.'
				}
			}
		},
		documentation: {
			liatirPath: '/ai/models/boltz2-local-structure-binding',
			officialUrl: 'https://github.com/jwohlwend/boltz'
		},
		tags: [
			'built-in',
			'managed',
			'protein',
			'structure',
			'binding',
			'requires-python-3.10',
			'commercial-use-ok'
		]
	},
	{
		id: CHAI1_MODEL_ID,
		name: 'Chai-1 Local Structure',
		description: 'Managed Chai-1 runtime for molecular structure prediction on Linux CUDA hosts.',
		category: 'Protein Structure',
		catalogVisibility: 'hidden',
		catalogHiddenReason:
			'Deferred until Liatir can validate the Linux CUDA runtime on supported hardware.',
		version: '0.6.1',
		runtime: {
			kind: 'python-venv',
			name: 'Chai-1 Python Runtime',
			version: 'python-venv'
		},
		source: 'managed-runtime',
		localOnly: true,
		capabilities: ['protein-structure-prediction'],
		modalities: ['protein', 'ligand'],
		license: {
			name: 'Apache License 2.0',
			spdxId: 'Apache-2.0',
			url: 'https://github.com/chaidiscovery/chai-lab',
			verifiedAt: '2026-06-29'
		},
		hardware: {
			cpu: false,
			gpu: true,
			minRamGb: 32,
			recommendedRamGb: 64,
			minVramGb: 24,
			recommendedVramGb: 48,
			notes:
				'Official Chai-1 package requires Linux, Python 3.10+, CUDA, and bfloat16 GPU support. A100/H100/L40S class GPUs are recommended.'
		},
		install: {
			method: 'managed-runtime',
			runtimeId: 'chai1-structure',
			modelCacheSubdir: 'model-cache/chai',
			runtimePackages: [
				{ package: 'chai_lab', specifier: 'chai_lab==0.6.1', importName: 'chai_lab' }
			],
			hostRequirements: {
				os: ['linux'],
				requiresCuda: true,
				python: {
					minVersion: '3.10',
					label: 'Python 3.10+',
					reason: 'The official chai_lab package requires Python 3.10 or newer.'
				},
				reason:
					'The official Chai-1 local runtime is built for Linux CUDA hosts; macOS Apple Metal is not a CUDA backend for this package.'
			}
		},
		documentation: {
			liatirPath: '/ai/models/chai1-local-structure',
			officialUrl: 'https://github.com/chaidiscovery/chai-lab'
		},
		tags: [
			'built-in',
			'managed',
			'protein',
			'structure',
			'requires-python-3.10',
			'requires-linux-cuda',
			'commercial-use-ok'
		]
	}
];

export const LOCAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
	...BUILT_IN_AI_MODEL_REGISTRY,
	...INTERNAL_AI_MODEL_REGISTRY
];

export function isAIModelCatalogVisible(model: LiatirAIModelMetadata): boolean {
	return model.catalogVisibility !== 'hidden';
}

export const VISIBLE_LOCAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] =
	LOCAL_AI_MODEL_REGISTRY.filter(isAIModelCatalogVisible);

export function getLocalAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
	return LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
}

// ── Model → managed-runtime mapping ──────────────────────────────────────────
// Pure derivations from a model's install spec, shared by the app UI and the
// plugin API (Liatir.ai) so the runtime-parameter mapping is defined once.

/** A package presence check (name + optional import name / specifier). */
export interface AiRuntimePackageCheck {
	package: string;
	importName?: string;
	specifier?: string;
}

/** Managed runtime id for a model, or null when the model has no runtime. */
export function runtimeIdForModel(model: LiatirAIModelMetadata): string | null {
	return model.install?.runtimeId ?? null;
}

/** pip requirement strings derived from the model's runtime packages. */
export function requirementsForModel(model: LiatirAIModelMetadata): string[] {
	return (model.install?.runtimePackages ?? []).map((pkg) => {
		if (pkg.specifier) return pkg.specifier;
		if (pkg.version) return `${pkg.package}==${pkg.version}`;
		return pkg.package;
	});
}

export function runtimePackagesForModel(model: LiatirAIModelMetadata): LiatirAIModelRuntimePackage[] {
	return model.install?.runtimePackages ?? [];
}

export function runtimeSourcesForModel(model: LiatirAIModelMetadata): LiatirAIModelRuntimeSource[] {
	return model.install?.runtimeSources ?? [];
}

export function packageChecksForModel(model: LiatirAIModelMetadata): AiRuntimePackageCheck[] {
	return runtimePackagesForModel(model).map((pkg) => ({
		package: pkg.package,
		importName: pkg.importName,
		specifier: pkg.specifier,
	}));
}
