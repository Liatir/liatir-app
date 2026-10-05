# Limitations

- One seed; no confidence intervals. Saved Mac representations and new Windows/WSL2 representations retain their own host identities. Costs across these hosts do not establish a same-host speed ranking.
- Random stratified classification split, not leave-one-batch-out prediction. Unsupervised representation fitting uses all cells.
- The PBMC loader supplies a historically selected 3,346-gene subset, not a whole-transcriptome input.
- The canonical pancreas count layer contains fractional quantification values; these are preserved without rounding. Integer count-distribution assumptions are imperfect for this source.
- scVI learns on the evaluation data and must be interpreted separately from zero-shot models.
- Public benchmark data may overlap pretrained corpora; zero-shot does not prove unseen-data generalization.
- Raw cell-type silhouette and ASW-batch have known geometry and batch-composition limitations. Inspect all metrics.
- Peak RAM is the OS process high-water mark; it excludes other processes. Apple unified memory means it is not additive with device memory. Reliable Metal peak memory is unavailable and is null.
- Representation time includes imports, model loading, preprocessing and writing embeddings; common evaluation and UMAP are separate. Downloads and installation are not included. Interrupted executions report only verified timing lower bounds when their unsaved tail cannot be measured.
- Pretrained inputs use each model's required vocabulary and formatting. Exclusions and the common evaluation cell set are exported.
- Historical disk telemetry follows symlink aliases per path. This is a logical file-size sum, not allocated disk blocks. Signed release sizes and the distinct-inode PC audit are retained separately; original Mac telemetry is unchanged.
- Old interrupted scGPT attempts contribute historical costs, not the fresh complete GPU runtime. Unsaved timing tails remain unknown. CPU vectors were not merged into the incompatible GPU checkpoint.
- Increasing PC resources cannot provide UCE's missing signed Linux target. Its old Mac memory refusal is a historical budget diagnosis, not a claim about the PC's larger memory.
