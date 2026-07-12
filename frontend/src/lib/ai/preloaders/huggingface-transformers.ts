/**
 * Preloader for models hosted on Hugging Face (ESM-2, Nucleotide Transformer, …).
 *
 * Rather than downloading files by hand, it asks the Transformers library to fetch the model — so
 * whatever the library will need at inference time is exactly what gets cached, including files a
 * manual list would be liable to miss.
 *
 * Two details in the embedded script carry the weight:
 *
 *   - `HF_HOME` is pointed at Liatir's own model cache. Left alone, Transformers would download
 *     into `~/.cache/huggingface`, outside anything Liatir manages — which means uninstalling the
 *     model would not reclaim the space, and the weights would be invisible to the app.
 *   - the **revision** is passed through, pinning the model to a specific upstream commit. Without
 *     it, an upstream repository update would silently change the weights behind a user's results.
 */
import type { JsonValue, LiatirAIModelRecord } from '@liatir/core';
import type { AIModelArtifactSpec } from '$lib/ai/model-artifacts';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

/** Runs inside the model's runtime, where the Transformers library is installed. */
const TRANSFORMERS_PRELOAD_SCRIPT = String.raw`
import json
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", cache_dir)
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)

from transformers import AutoModel, AutoModelForMaskedLM, AutoTokenizer

model_id = payload["hubModelId"]
revision = payload.get("hubRevision") or None
loader = payload.get("transformersLoader") or "auto-model"
AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
if loader == "masked-lm":
    AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
else:
    AutoModel.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
print(json.dumps({"downloaded": True, "model": model_id, "revision": revision}))
`;

export async function preloadHuggingFaceTransformersModel(
	model: LiatirAIModelRecord,
	spec: AIModelArtifactSpec,
	onLog?: (lines: string[]) => void
): Promise<void> {
	if (!spec.upstreamModelId) throw new Error(`${model.name} is missing a Hugging Face model id.`);

	const result = await runAIPython(
		model,
		TRANSFORMERS_PRELOAD_SCRIPT,
		{
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePathForModel(model) as JsonValue,
			hubModelId: spec.upstreamModelId,
			// The loader class must match how the model will actually be used: loading a masked-LM
			// with the plain AutoModel class silently drops its prediction head.
			transformersLoader: spec.transformersLoader ?? 'auto-model',
			// Only sent when pinned — omitting the key lets Transformers resolve the default branch.
			...(model.install?.revision ? { hubRevision: model.install.revision } : {})
		},
		{ timeoutSeconds: 7200, trackJob: false }
	);
	onLog?.([...splitPreloadLog(result.stdout), ...splitPreloadLog(result.stderr)]);
	if (!result.ok)
		throw new Error(
			result.stderr || `Transformers model preload exited with code ${result.exitCode}`
		);
}
