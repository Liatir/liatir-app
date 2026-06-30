import type { LiatirAIModelMetadata } from '@liatir/core';

export const MOCK_AI_MODEL_ID = 'liatir-mock-local';
export const CELLTYPIST_MODEL_ID = 'celltypist-local-annotation';
export const NUCLEOTIDE_TRANSFORMER_50M_ID = 'instadeep-nt-v2-50m-multi-species';
export const NUCLEOTIDE_TRANSFORMER_500M_ID = 'instadeep-nt-v2-500m-multi-species';
export const ESM2_8M_ID = 'facebook-esm2-8m-protein';
export const BOLTZ2_MODEL_ID = 'boltz2-local-structure-binding';
export const CHAI1_MODEL_ID = 'chai1-local-structure';

const INTERNAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
	{
		id: MOCK_AI_MODEL_ID,
		name: 'Mock Local Model',
		description:
			'Deterministic local model fixture for validating AI Tool wiring without loading model weights.',
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
		tags: ['built-in', 'managed', 'single-cell', 'annotation']
	},
	{
		id: NUCLEOTIDE_TRANSFORMER_50M_ID,
		name: 'Nucleotide Transformer v2 50M',
		description:
			'Small/base managed local DNA/RNA embedding model for genomic sequence representations.',
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
		tags: ['built-in', 'managed', 'genomics', 'embedding', 'non-commercial']
	},
	{
		id: NUCLEOTIDE_TRANSFORMER_500M_ID,
		name: 'Nucleotide Transformer v2 500M',
		description:
			'Larger managed local DNA/RNA foundation model for genomic embeddings and embedding-delta variant effect scoring.',
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
		tags: ['built-in', 'managed', 'genomics', 'variant-effect', 'embedding', 'non-commercial']
	},
	{
		id: ESM2_8M_ID,
		name: 'ESM-2 8M Protein',
		description:
			'Small managed local protein language model for lightweight protein sequence embeddings.',
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
		tags: ['built-in', 'managed', 'protein', 'embedding']
	},
	{
		id: BOLTZ2_MODEL_ID,
		name: 'Boltz-2 Local Structure & Binding',
		description:
			'Managed local Boltz-2 runtime for protein structure prediction and optional protein-ligand affinity scoring.',
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

export function getLocalAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
	return LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
}
