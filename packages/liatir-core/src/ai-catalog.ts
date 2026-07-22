import type { LiatirAIModelMetadata, LiatirAIModelRuntimePackage } from './index';
import type { LiatirRuntimeBoxTargetCandidate } from './runtime-box';

export const SCGPT_WHOLE_HUMAN_MODEL_ID = 'bowang-scgpt-whole-human';
export const GENEFORMER_V1_10M_MODEL_ID = 'ctheodoris-geneformer-v1-10m';
export const UCE_4LAYER_MODEL_ID = 'snap-stanford-uce-4layer';

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

const GENEFORMER_V1_10M_REVISION = '04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5';
const SCGPT_WHOLE_HUMAN_REVISION = 'cebd6fae655b9c585a4807daa3ac31bb764f06b4';

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
		},
		{
			target: {
				platform: 'linux',
				arch: 'x86_64',
				accelerator: 'cuda',
				cudaVersion: '12.4'
			},
			hostEnvironments: ['native'],
			minRamGb: 8,
			minNvidiaDriverVersion: '550.54.14'
		},
		{
			target: { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' },
			hostEnvironments: ['native'],
			minRamGb: 8
		}
	];
}

/**
 * Product AI Model catalog.
 *
 * Every entry must be delivered by a signed Runtime Box. A model is added only
 * after at least one exact native target is published and recorded here.
 */
export const RUNTIME_BOX_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
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
				os: ['macos', 'linux', 'windows'],
				arch: ['aarch64', 'x86_64'],
				reason:
					'Signed Geneformer Runtime Boxes are available for Apple silicon Macs, native Linux x86_64 hosts, and native Windows x86_64 CPU hosts.'
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
		diskSizeBytes: 10_142_864_860,
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
	}
];

export function getRuntimeBoxAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
	return RUNTIME_BOX_AI_MODEL_REGISTRY.find((model) => model.id === id);
}

/** A package presence check used to inspect an installed Runtime Box. */
export interface AiRuntimePackageCheck {
	package: string;
	importName?: string;
	specifier?: string;
}

/** Runtime ID for a Runtime Box model. */
export function runtimeIdForModel(model: LiatirAIModelMetadata): string {
	return model.install.runtimeId;
}

export function runtimePackagesForModel(
	model: LiatirAIModelMetadata
): LiatirAIModelRuntimePackage[] {
	return model.install.runtimePackages ?? [];
}

export function packageChecksForModel(model: LiatirAIModelMetadata): AiRuntimePackageCheck[] {
	return runtimePackagesForModel(model).map((pkg) => ({
		package: pkg.package,
		importName: pkg.importName,
		specifier: pkg.specifier
	}));
}
