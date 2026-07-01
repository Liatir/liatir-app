import type { LiatirAIModelRecord } from '@liatir/core';
import { artifactSpecForModel } from './model-artifacts';
import { preloadCelltypistModel } from './preloaders/celltypist';
import { preloadHuggingFaceTransformersModel } from './preloaders/huggingface-transformers';

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

	const exhaustive: never = spec.preloadKind;
	throw new Error(`Unsupported AI Model preload strategy: ${exhaustive}`);
}
