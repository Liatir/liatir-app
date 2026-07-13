/**
 * Downloads a model's weights at install time — routing to the right preloader for its source.
 *
 * Preloading exists so the wait happens *once*, during an install the user is already watching,
 * rather than the first time they run the tool. Without it, a model that fetches its own weights
 * lazily would make the user's first analysis appear to hang for several minutes.
 */
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
	// `none` is a legitimate strategy, not an omission: Boltz and Chai fetch their own weights on
	// first run, so there is nothing to preload for them.
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

	// Exhaustiveness check: assigning to `never` makes the *compiler* fail if a new preload kind is
	// added to the union without a branch here, so a new model cannot silently install with no
	// weights. The throw only covers the impossible runtime case.
	const exhaustive: never = spec.preloadKind;
	throw new Error(`Unsupported AI Model preload strategy: ${exhaustive}`);
}
