import type { JsonValue, LiatirAIModelRecord } from '@liatir/core';
import { CELLTYPIST_MODEL_ID, ESM2_8M_ID, NUCLEOTIDE_TRANSFORMER_50M_ID } from './model-registry';
import { cachePathForModel, runAIPython } from './runtime';

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
AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
if model_id.startswith("InstaDeepAI/nucleotide-transformer"):
    AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
else:
    AutoModel.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
print(json.dumps({"downloaded": True, "model": model_id}))
`;

function hubModelId(modelId: string): string | null {
  if (modelId === NUCLEOTIDE_TRANSFORMER_50M_ID) return 'InstaDeepAI/nucleotide-transformer-v2-50m-multi-species';
  if (modelId === ESM2_8M_ID) return 'facebook/esm2_t6_8M_UR50D';
  return null;
}

export async function preloadManagedAIModel(model: LiatirAIModelRecord): Promise<void> {
  if (model.id === CELLTYPIST_MODEL_ID) {
    const result = await runAIPython(
      model,
      CELLTYPIST_PRELOAD_SCRIPT,
      {
        runtimePath: model.runtimePath ?? model.localPath ?? null,
        celltypistModel: 'Immune_All_Low.pkl',
      },
      { timeoutSeconds: 7200 },
    );
    if (!result.ok) throw new Error(result.stderr || `CellTypist model preload exited with code ${result.exitCode}`);
    return;
  }

  const hfModel = hubModelId(model.id);
  if (hfModel) {
    const result = await runAIPython(
      model,
      TRANSFORMERS_PRELOAD_SCRIPT,
      {
        runtimePath: model.runtimePath ?? model.localPath ?? null,
        modelCacheDir: cachePathForModel(model) as JsonValue,
        hubModelId: hfModel,
      },
      { timeoutSeconds: 7200 },
    );
    if (!result.ok) throw new Error(result.stderr || `Transformers model preload exited with code ${result.exitCode}`);
  }
}
