/**
 * Preloader for UCE (Universal Cell Embeddings), which needs more than a plain file download.
 *
 * UCE ships its per-species protein embeddings as a tarball, so the files it will actually read do
 * not exist until that archive is unpacked. This preloader therefore does three things the generic
 * managed-files preloader does not:
 *
 *   1. **verifies** the download is complete before touching it — a missing file here is a broken
 *      install, and it is better to say so than to fail cryptically at inference time;
 *   2. **extracts safely** — the embedded script rejects symlinks and any entry that would resolve
 *      outside the destination, which is the standard defence against a tar-slip archive;
 *   3. **verifies again** afterwards, checking every expected species embedding is present, so a
 *      truncated archive cannot leave a half-populated directory that looks installed.
 *
 * Extraction is skipped when the directory already exists, which makes re-running it cheap.
 */
import type { JsonValue, LiatirAIModelRecord } from '@liatir/core';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { splitPreloadLog } from './shared';

/** Runs inside the model's runtime. Verifies, extracts, then verifies again. */
const UCE_MANAGED_FILES_PRELOAD_SCRIPT = String.raw`
import json
import os
from pathlib import Path
import sys
import tarfile

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")

if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
if not cache_dir:
    raise SystemExit("UCE preload requires a model cache directory.")

cache_root = Path(cache_dir).resolve()
model_files = cache_root / "model_files"
protein_embeddings_dir = model_files / "protein_embeddings"
tar_path = model_files / "protein_embeddings.tar.gz"

required_files = [
    "species_chrom.csv",
    "species_offsets.pkl",
    "all_tokens.torch",
    "4layer_model.torch",
    "protein_embeddings.tar.gz",
]
missing = [name for name in required_files if not (model_files / name).is_file()]
if missing:
    raise SystemExit("UCE model installation is incomplete. Missing: " + ", ".join(missing))

def safe_extract_tar(tar: tarfile.TarFile, destination: Path) -> None:
    destination = destination.resolve()
    for member in tar.getmembers():
        if member.issym() or member.islnk():
            raise SystemExit(f"Unsafe link inside UCE protein embeddings archive: {member.name}")
        target = (destination / member.name).resolve()
        if not str(target).startswith(str(destination) + os.sep) and target != destination:
            raise SystemExit(f"Unsafe path inside UCE protein embeddings archive: {member.name}")
    tar.extractall(destination)

extracted = False
if not protein_embeddings_dir.is_dir():
    print("Extracting UCE protein embeddings", flush=True)
    with tarfile.open(tar_path, "r:gz") as tar:
        safe_extract_tar(tar, model_files)
    extracted = True

expected_embeddings = [
    "Homo_sapiens.GRCh38.gene_symbol_to_embedding_ESM2.pt",
    "Mus_musculus.GRCm39.gene_symbol_to_embedding_ESM2.pt",
    "Xenopus_tropicalis.Xenopus_tropicalis_v9.1.gene_symbol_to_embedding_ESM2.pt",
    "Danio_rerio.GRCz11.gene_symbol_to_embedding_ESM2.pt",
    "Microcebus_murinus.Mmur_3.0.gene_symbol_to_embedding_ESM2.pt",
    "Sus_scrofa.Sscrofa11.1.gene_symbol_to_embedding_ESM2.pt",
    "Macaca_fascicularis.Macaca_fascicularis_6.0.gene_symbol_to_embedding_ESM2.pt",
    "Macaca_mulatta.Mmul_10.gene_symbol_to_embedding_ESM2.pt",
]
missing_embeddings = [
    name for name in expected_embeddings if not (protein_embeddings_dir / name).is_file()
]
if missing_embeddings:
    raise SystemExit(
        "UCE protein embeddings archive is incomplete. Missing: " + ", ".join(missing_embeddings)
    )

print(json.dumps({
    "cacheDir": str(cache_root),
    "proteinEmbeddings": str(protein_embeddings_dir),
    "extracted": extracted,
    "embeddingFiles": len(expected_embeddings),
}))
`;

export async function preloadUCEManagedModelFiles(
	model: LiatirAIModelRecord,
	onLog?: (lines: string[]) => void
): Promise<void> {
	const result = await runAIPython(
		model,
		UCE_MANAGED_FILES_PRELOAD_SCRIPT,
		{
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePathForModel(model) as JsonValue
		},
		{ timeoutSeconds: 7200, trackJob: false }
	);
	onLog?.([...splitPreloadLog(result.stdout), ...splitPreloadLog(result.stderr)]);
	if (!result.ok)
		throw new Error(result.stderr || `UCE managed files preload exited with code ${result.exitCode}`);
}
