import type { LiatirAIModelRecord } from '@liatir/core';
import type { AIModelArtifactSpec } from '$lib/ai/model-artifacts';
import { runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

const CELLTYPIST_PRELOAD_SCRIPT = String.raw`
import json
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
    os.environ.setdefault("XDG_CACHE_HOME", os.path.join(runtime_path, "model-cache"))

from celltypist import models

model_name = payload.get("celltypistModel") or "Immune_All_Low.pkl"
models.download_models(model=[model_name], force_update=False)
print(json.dumps({"downloaded": True, "model": model_name}))
`;

export async function preloadCelltypistModel(
	model: LiatirAIModelRecord,
	spec: AIModelArtifactSpec,
	onLog?: (lines: string[]) => void
): Promise<void> {
	const result = await runAIPython(
		model,
		CELLTYPIST_PRELOAD_SCRIPT,
		{
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			celltypistModel: spec.defaultAsset ?? 'Immune_All_Low.pkl'
		},
		{ timeoutSeconds: 7200, trackJob: false }
	);
	onLog?.([...splitPreloadLog(result.stdout), ...splitPreloadLog(result.stderr)]);
	if (!result.ok)
		throw new Error(result.stderr || `CellTypist model preload exited with code ${result.exitCode}`);
}
