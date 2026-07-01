import type { JsonValue, LiatirAIModelRecord } from '@liatir/core';
import type { AIModelArtifactSpec } from '$lib/ai/model-artifacts';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

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
			transformersLoader: spec.transformersLoader ?? 'auto-model',
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
