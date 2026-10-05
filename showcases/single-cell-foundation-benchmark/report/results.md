# Completed single-cell foundation-model study

The complete study ran through Liatir's native Jobs and Results. PBMC has 11,990 cells and pancreas 16,382. PCA, Geneformer V1 10M, Harmony, scVI and scGPT whole-human completed on both datasets: ten measured configurations. The two UCE configurations remain diagnosed blockers with null scientific scores. [summary.csv](../results/summary.csv) and [summary.json](../results/summary.json) contain all twelve rows at full precision; [all 22 figures](../results/figures/) accompany them.

## Exact datasets and evaluation

PBMC is `scvi.data.pbmc_dataset()` from scvi-tools 1.3.3: the original 10x Cell Ranger 2.1.0 PBMC8k and PBMC4k sources plus original scVI annotations. It retains 3,346 historically selected genes, nine cell labels and two batches. Pancreas is the scIB integration benchmark from the official scvi-tools reference-mapping tutorial, Figshare file **24539828**, source SHA-256 **97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c**: 19,093 genes, fourteen labels and nine technologies. Exact URLs, source-file hashes, mappings and exclusions are in [datasets/manifest.json](../datasets/manifest.json).

Prepared values, cell/gene order and seed-23 stratified 80/20 classification splits stayed unchanged across methods. No cells were excluded from the common evaluation: 11,990 PBMC cells and 16,382 pancreas cells. Their source-count checks passed exactly, including all 23,809,035 fractional pancreas entries, without rounding. Mapping uses original PBMC Ensembl identifiers and GENCODE human v47 for exact unique pancreas gene-symbol matches.

Macro-F1 measures cell-type prediction while giving each type equal weight; 1 is perfect. kNN predicts from nearby training cells; logistic regression fits a classifier on the same training labels. ARI and NMI measure agreement between discovered groups and known cell types. Cell silhouette measures how separated cell types are in the full representation. All scientific scores use the representations, rather than the two-dimensional UMAP pictures.

## Observed biological measurements

| Dataset | Method | ARI | NMI | Cell silhouette | kNN macro-F1 | Logistic macro-F1 |
| --- | --- | --- | --- | --- | --- | --- |
| pancreas | pca | 0.71291 | 0.79842 | 0.21986 | 0.95516 | 0.97788 |
| pancreas | geneformer | 0.05019 | 0.11352 | -0.26688 | 0.47460 | 0.76435 |
| pancreas | harmony | 0.92191 | 0.88105 | 0.35242 | 0.88147 | 0.94953 |
| pancreas | scvi | 0.52441 | 0.76738 | 0.24087 | 0.89955 | 0.97184 |
| pancreas | scgpt | 0.27478 | 0.45761 | -0.00891 | 0.69680 | 0.89987 |
| pancreas | uce | ? | ? | ? | ? | ? |
| pbmc | pca | 0.75318 | 0.78586 | 0.20413 | 0.93008 | 0.92880 |
| pbmc | geneformer | 0.28906 | 0.46707 | 0.02574 | 0.78332 | 0.83946 |
| pbmc | harmony | 0.70619 | 0.78677 | 0.20446 | 0.92299 | 0.93241 |
| pbmc | scvi | 0.54180 | 0.73009 | 0.14692 | 0.92714 | 0.94916 |
| pbmc | scgpt | 0.66926 | 0.78583 | 0.25699 | 0.92756 | 0.95685 |
| pbmc | uce | ? | ? | ? | ? | ? |

On PBMC, scGPT's logistic macro-F1 was **0.9568516511**, versus **0.9287970980** for PCA and **0.9491589033** for scVI. PCA had the higher clustering agreement: ARI **0.7531757161**, versus **0.6692582634** for scGPT. Geneformer's logistic macro-F1 was **0.8394624025**. The measures describe different properties and do not identify one overall winner.

On pancreas, PCA's logistic macro-F1 was **0.9778758692**, scVI's **0.9718409740**, Harmony's **0.9495305510**, scGPT's **0.8998650307**, and Geneformer's **0.7643451754**. Harmony had ARI **0.9219064771**, compared with PCA **0.7129127580**, scGPT **0.2747793994** and Geneformer **0.0501931811**. These fixed-split observations do not show a uniform advantage for pretrained representations over the established baselines.

## Observed batch measurements

A batch is a group of cells measured in the same experiment or technology. Batch silhouette measures separation by batch; its label-adjusted ASW score rewards mixing within cell types. Connectivity measures whether cells of each type remain connected in the neighbor graph. Scaled iLISI, calculated with scib-metrics 0.5.7, measures local batch mixing on a zero-to-one scale. These measures depend on batch composition and must be interpreted alongside biological preservation.

| Dataset | Method | Batch silhouette | ASW-batch | Connectivity | Scaled iLISI |
| --- | --- | --- | --- | --- | --- |
| pancreas | pca | -0.11014 | 0.84632 | 0.94257 | 0.00309 |
| pancreas | geneformer | 0.05526 | 0.85506 | 0.50387 | 0.01433 |
| pancreas | harmony | -0.22126 | 0.86698 | 0.88707 | 0.21006 |
| pancreas | scvi | -0.04770 | 0.85842 | 0.93658 | 0.11818 |
| pancreas | scgpt | 0.04135 | 0.84927 | 0.76947 | 0.00637 |
| pancreas | uce | ? | ? | ? | ? |
| pbmc | pca | -0.00041 | 0.97292 | 0.77356 | 0.78681 |
| pbmc | geneformer | 0.00296 | 0.96751 | 0.76477 | 0.70082 |
| pbmc | harmony | -0.00117 | 0.97793 | 0.77901 | 0.82647 |
| pbmc | scvi | 0.00113 | 0.97782 | 0.93785 | 0.76160 |
| pbmc | scgpt | 0.00165 | 0.96945 | 0.84780 | 0.74429 |
| pbmc | uce | ? | ? | ? | ? |

Pancreas Harmony's scaled iLISI was **0.2100591660**, versus PCA **0.0030920506** and scGPT **0.0063738227**. On PBMC, Harmony's scaled iLISI was **0.8264739513** and scGPT's **0.7442889214**; scVI's connectivity was **0.9378488242**. No combined score, uncertainty estimate or statistical superiority claim is made.

## Measured cost and computers

Nine saved representations were produced on the **Apple M1, 16 GiB, macOS 14.4.1**, using CPU, one numerical thread, one-cell pretrained-model batches and the original 2 GiB process-family ceiling. Those embeddings, configurations and telemetry were reused byte for byte. Only unfinished pancreas scGPT inference was newly executed on the **Intel i7-8700K / RTX 4060 Ti PC**, using the compiled Linux Liatir app in WSL2 and a virtual display. Windows has 31.93 GiB RAM; WSL exposes about 23.47 GiB under its existing 24 GiB setting. The new calculation used CUDA 12.9, six threads and batches of sixteen, after explicit user authorization and a bounded interruption/resume diagnostic.

Seconds below measure complete representation work: imports, preprocessing, loading, inference/training and serialization. Common evaluation, UMAP, installation and downloads are separate. RSS is the worker's OS memory high-water mark; the separate sampled process-family guard has a different scope. CUDA memory below is PyTorch's peak allocated tensors; CPU rows have no accelerator allocation and store a null with its reason.

| Dataset | Method | Producer | Representation seconds | Peak worker RAM GiB | Peak CUDA tensors GiB |
| --- | --- | --- | --- | --- | --- |
| pancreas | pca | Mac / CPU | 7.94170 | 1.79889 | ? |
| pancreas | geneformer | Mac / CPU | 8448.01173 | 1.71463 | ? |
| pancreas | harmony | Mac / CPU | 22.92940 | 1.71384 | ? |
| pancreas | scvi | Mac / CPU | 333.28791 | 1.67360 | ? |
| pancreas | scgpt | WSL2 / CUDA | 515.53657 | 2.34560 | 3.26922 |
| pancreas | uce | WSL2 / not started | ? | ? | ? |
| pbmc | pca | Mac / CPU | 7.51471 | 1.19182 | ? |
| pbmc | geneformer | Mac / CPU | 804.10073 | 0.68120 | ? |
| pbmc | harmony | Mac / CPU | 15.19599 | 1.20992 | ? |
| pbmc | scvi | Mac / CPU | 249.21706 | 0.94943 | ? |
| pbmc | scgpt | Mac / CPU | 4994.06596 | 1.15265 | ? |
| pbmc | uce | Mac / CPU | 0.14232 | 0.02168 | ? |

New pancreas scGPT completed in **515.536567396 seconds**. Its worker peak was **2,518,573,056 bytes**; PyTorch peak tensors were **3,510,297,600 bytes**. The independent whole-device monitor measured **4,799,332,352 bytes**, including graphics and other processes, below the approved 6 GiB ceiling. The workload cgroup had a 16 GiB RAM ceiling and zero swapping; WSL retained more than the required 6 GiB available RAM. These heterogeneous costs do not establish a same-host speed ranking.

Runtime identities and embedding dimensions/bytes are retained per row and in [compute_metrics.csv](../results/compute_metrics.csv). Signed releases were Geneformer **1.0.0-beta.2**, scGPT **0.2.5-beta.2** and UCE **1.0.0-beta.2**; archive and payload hashes identify their platform-specific installations. Historical `model_runtime_bytes` sums installed file lengths following each symlink alias separately, and must not be interpreted as physical disk consumption. The new CUDA box declares **13,278,575,392 installed bytes**; a distinct-inode audit observed **13,315,193,600 bytes**, versus the alias-expanded historical sum **27,751,283,099**. [Disk counting evidence](../validation/completed-study/disk-footprint-audit.json) preserves these separate scopes without rewriting original telemetry.

## Blockers and interrupted work

- **PBMC / UCE, historical Mac:** the pinned loader would materialize at least **3,403,469,828 tensor bytes**, exceeding its then-approved **2,147,483,648-byte** process-family budget. Preflight refused loading; logs and configuration remain. This historical refusal does not prove inability under the PC's larger RAM allowance.
- **Pancreas / UCE, PC:** the checked signed catalog has only a macOS UCE target. Native Liatir reported no published Linux Runtime Box for this host. The increased PC RAM cannot resolve platform availability. No target was fabricated, published or built on paid infrastructure; all UCE scores are null.
- **Earlier pancreas scGPT:** the interrupted Mac calculation reached 10,752 cells but had no saved vectors. A subsequent PC CPU attempt stopped at the swap-growth safeguard; its native resume was cancelled after approval for GPU resources. The separately preserved CPU database has **2,066 committed cells**. Its saved attempt times total **5,086.23864293 seconds through the last committed batches**, with any unsaved tail unknown. These CPU costs and original Mac logs remain historical attachments and are excluded from the fresh GPU representation time. CPU and GPU checkpoints were never mixed.

## Interpretation and verification boundaries

Geneformer and scGPT used pretrained weights without fitting them to these datasets; UCE produced no representation. scVI was trained on all evaluation counts and is reported separately. PCA/Harmony also use all cells without test-label supervision. The held-out split therefore tests prediction of hidden cell labels within these datasets, rather than generalization to unseen studies or batches. One seed, rare pancreas labels, possible pretraining overlap, historical PBMC gene selection and fractional pancreas quantification limit wider claims. See [limitations](limitations.md).

The actual native app passed dataset import, ownership in Jobs, Results/charts and ZIP export. Independent reproduction matched every completed biological/batch score within absolute tolerance **1e-9** and relative tolerance **1e-8**, with identical missing values and reasons; it repeated evaluation only. Original source-count checks and the twelve-row artifact validator passed. Repository/native test details, exact commands and portable-bundle instructions are in [tested reproduction](reproduction-validation.md) and [reproduction](reproduction.md).
