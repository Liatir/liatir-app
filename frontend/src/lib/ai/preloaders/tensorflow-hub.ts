/**
 * Preloader for TensorFlow Hub models (Enformer, for regulatory genomics).
 *
 * `hub.load()` both downloads the model and builds it, so this doubles as a validation step: a
 * model that downloads but cannot be constructed fails here, during the install, rather than on the
 * user's first analysis. The script reports back which inference interface the loaded object
 * exposes, since TF Hub models differ in how they are called.
 *
 * `TFHUB_CACHE_DIR` redirects the download into Liatir's managed cache — the same reason as the
 * other preloaders: a library left to its own defaults writes outside anything the app manages.
 */
import type { JsonValue, LiatirAIModelRecord } from '@liatir/core';
import type { AIModelArtifactSpec } from '$lib/ai/model-artifacts';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

/** Runs inside the model's runtime, where tensorflow_hub is installed. */
const TENSORFLOW_HUB_PRELOAD_SCRIPT = String.raw`
import json
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
tfhub_url = payload["tfhubUrl"]

if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("TFHUB_CACHE_DIR", os.path.join(cache_dir, "tfhub"))

import tensorflow_hub as hub

model = hub.load(tfhub_url)
has_predict = hasattr(model, "predict_on_batch")
has_model = hasattr(model, "model")
print(json.dumps({
    "downloaded": True,
    "model": tfhub_url,
    "hasPredict": has_predict,
    "hasModel": has_model,
}))
`;

export async function preloadTensorFlowHubModel(
	model: LiatirAIModelRecord,
	spec: AIModelArtifactSpec,
	onLog?: (lines: string[]) => void
): Promise<void> {
	if (!spec.upstreamModelId) throw new Error(`${model.name} is missing a TensorFlow Hub URL.`);

	const result = await runAIPython(
		model,
		TENSORFLOW_HUB_PRELOAD_SCRIPT,
		{
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePathForModel(model) as JsonValue,
			tfhubUrl: spec.upstreamModelId
		},
		{ timeoutSeconds: 7200, trackJob: false }
	);
	onLog?.([...splitPreloadLog(result.stdout), ...splitPreloadLog(result.stderr)]);
	if (!result.ok)
		throw new Error(result.stderr || `TensorFlow Hub model preload exited with code ${result.exitCode}`);
}
