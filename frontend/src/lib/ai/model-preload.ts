import type { LiatirAIModelRecord } from '@liatir/core';
import { artifactSpecForModel } from './model-artifacts';
import { preloadCelltypistModel } from './preloaders/celltypist';
import { preloadHuggingFaceTransformersModel } from './preloaders/huggingface-transformers';
import { preloadManagedModelFiles } from './preloaders/managed-files';
import { preloadTensorFlowHubModel } from './preloaders/tensorflow-hub';

export async function preloadManagedAIModel(
	model: LiatirAIModelRecord,
	onLog?: (lines: string[]) => void
): Promise<void> {
	const spec = artifactSpecForModel(model);
	if (!spec || spec.preloadKind === 'none') return;

	if (spec.preloadKind === 'celltypist') {
		await preloadCelltypistModel(model, spec, onLog);
		return;
	}

	if (spec.preloadKind === 'huggingface-transformers') {
		await preloadHuggingFaceTransformersModel(model, spec, onLog);
		return;
	}

	if (spec.preloadKind === 'tensorflow-hub') {
		await preloadTensorFlowHubModel(model, spec, onLog);
		return;
	}

	if (spec.preloadKind === 'managed-files') {
		await preloadManagedModelFiles(model, onLog);
		return;
	}

	const exhaustive: never = spec.preloadKind;
	throw new Error(`Unsupported AI Model preload strategy: ${exhaustive}`);
}
