/**
 * Preloader for models delivered as plain files (weights, params, target tables).
 *
 * Downloading happens inside the model's *own* Python runtime rather than from TypeScript. That is
 * not incidental: the files land exactly where that interpreter will later look for them, under the
 * same HOME and cache directory the inference run will use, so there is no chance of preloading to
 * one location and reading from another.
 *
 * The embedded script writes to a `.part` file and only renames it into place once complete, so an
 * interrupted download can never be mistaken for a finished one; a re-run then skips whatever is
 * already there at the expected size.
 */
import type { JsonValue, LiatirAIModelInstallFile, LiatirAIModelRecord } from '@liatir/core';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

/** Runs inside the model's runtime. Reads its arguments as JSON on stdin. */
const MANAGED_FILES_PRELOAD_SCRIPT = String.raw`
import json
import os
import sys
import urllib.request

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
files = payload.get("files") or []

if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
if not cache_dir:
    raise SystemExit("Managed model files require a model cache directory.")
os.makedirs(cache_dir, exist_ok=True)

downloaded = []
skipped = []
for item in files:
    relative_path = item["relativePath"]
    if os.path.isabs(relative_path) or ".." in relative_path.split("/"):
        raise SystemExit(f"Unsafe managed file path: {relative_path}")
    dest = os.path.join(cache_dir, relative_path)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    expected_size = item.get("sizeBytes")
    if os.path.isfile(dest) and (not expected_size or os.path.getsize(dest) == expected_size):
        skipped.append(relative_path)
        print(f"Skipping existing {relative_path}", flush=True)
        continue
    print(f"Downloading {relative_path}", flush=True)
    tmp = dest + ".part"
    urllib.request.urlretrieve(item["url"], tmp)
    os.replace(tmp, dest)
    downloaded.append(relative_path)

print(json.dumps({
    "downloaded": downloaded,
    "skipped": skipped,
    "cacheDir": cache_dir,
}))
`;

export async function preloadManagedModelFiles(
	model: LiatirAIModelRecord,
	onLog?: (lines: string[]) => void
): Promise<void> {
	const files = model.install?.files ?? [];
	if (files.length === 0) return;

	const result = await runAIPython(
		model,
		MANAGED_FILES_PRELOAD_SCRIPT,
		{
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePathForModel(model) as JsonValue,
			files: files as unknown as JsonValue
		},
		// Two hours: model weights run to many gigabytes on a slow connection. `trackJob: false`
		// keeps this out of the Jobs list — it is a step *inside* an install the user is already
		// watching, not a run of its own.
		{ timeoutSeconds: 7200, trackJob: false }
	);
	// Both streams are surfaced: progress goes to stdout, but the reason a download failed is on stderr.
	onLog?.([...splitPreloadLog(result.stdout), ...splitPreloadLog(result.stderr)]);
	// A failed preload must fail the install. Otherwise the model would be marked installed while
	// its weights are missing, and only break later, at inference time.
	if (!result.ok)
		throw new Error(result.stderr || `Managed model files preload exited with code ${result.exitCode}`);
}

/** The files this model expects on disk — used to verify an install is actually complete. */
export function managedFileRelativePaths(model: Pick<LiatirAIModelRecord, 'install'>): string[] {
	return (model.install?.files ?? []).map((file: LiatirAIModelInstallFile) => file.relativePath);
}
