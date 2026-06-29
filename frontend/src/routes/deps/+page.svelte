<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import { depsStore } from '$lib/stores/deps.svelte';
	import { managedBins } from '$lib/stores/managedBins.svelte';
	import { installProgress } from '$lib/stores/installProgress.svelte';
	import { viewerRuntimesStore, type ViewerRuntimeInstallProgress } from '$lib/stores/viewerRuntimes.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { liatir } from '$lib/api';
	import { runNativeTool } from '$lib/utils/native-tool';
	import {
		getRelease,
		installBinary,
		type OsPlatform,
		type Arch,
		type InstallProgress
	} from '$lib/tools/binary-manager';
	import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
	import { versionGte } from '$lib/utils/versions';

	// ── tool metadata ─────────────────────────────────────────────────
	interface ToolMeta {
		label: string;
		description: string;
		brew?: string;
		apt?: string;
		conda?: string;
	}

	const TOOL_META: Record<string, ToolMeta> = {
		java: {
			label: 'Java',
			description:
				'Java Runtime Environment — required by SnpEff for variant annotation. Version 21 or later is needed. Any standard JDK distribution works (Temurin, Oracle JDK, OpenJDK).',
		},
		fastqc: {
			label: 'FastQC',
			description:
				'Quality control for raw FASTQ sequencing data. Generates per-base quality score profiles, GC content, duplication levels, and adapter content reports. Run before any alignment step.',
			brew: 'fastqc',
			apt: 'fastqc',
			conda: 'fastqc'
		},
		bwa: {
			label: 'BWA',
			description:
				'Burrows-Wheeler Aligner for short Illumina reads. Maps reads to a reference genome and outputs SAM/BAM. BWA-MEM (included) is the recommended algorithm for reads > 70 bp.',
			brew: 'bwa',
			apt: 'bwa',
			conda: 'bwa'
		},
		samtools: {
			label: 'Samtools',
			description:
				'Swiss-army knife for SAM/BAM/CRAM files. Sort, index, view, filter alignments and generate mapping statistics (flagstat, stats, idxstats). Required by most downstream tools.',
			brew: 'samtools',
			apt: 'samtools',
			conda: 'samtools'
		},
		minimap2: {
			label: 'Minimap2',
			description:
				'Versatile aligner for long reads (PacBio CLR/HiFi, Oxford Nanopore) and short reads. Also performs genome-to-genome alignment. Outputs SAM or PAF format.',
			brew: 'minimap2',
			apt: 'minimap2',
			conda: 'minimap2'
		},
		hisat2: {
			label: 'HISAT2',
			description:
				'Graph-based RNA-seq aligner. Splice-aware — accurately maps reads spanning exon-exon junctions. Uses a genome graph index for fast, sensitive alignment of RNA-seq reads.',
			apt: 'hisat2',
			conda: 'hisat2'
		},
		star: {
			label: 'STAR',
			description:
				'Ultrafast RNA-seq aligner. Detects novel splice junctions de novo and handles chimeric reads. Widely used upstream of differential expression tools like DESeq2 and edgeR.',
			brew: 'star',
			apt: 'rna-star',
			conda: 'star'
		},
		nextflow: {
			label: 'Nextflow',
			description:
				'Dataflow-driven scientific workflow system. Runs scalable DSL2 pipelines with automatic parallelization, containerization, and cluster/cloud execution. Powers nf-core community pipelines.',
			brew: 'nextflow',
			conda: 'nextflow'
		},
		snakemake: {
			label: 'Snakemake',
			description:
				'Python-based workflow manager with Makefile-inspired syntax. Supports conda environments, containers, and cluster execution. Define rules once and Snakemake resolves the dependency graph.',
			brew: 'snakemake',
			conda: 'snakemake'
		},
		bcftools: {
			label: 'BCFtools',
			description:
				'Call variants and manipulate VCF/BCF files. Works with samtools output for SNP/indel calling, filtering, merging, and format conversion. Part of the samtools/htslib ecosystem.',
			brew: 'bcftools',
			apt: 'bcftools',
			conda: 'bcftools'
		},
		bedtools: {
			label: 'bedtools',
			description:
				'Genome arithmetic toolkit. Intersect, merge, count, and manipulate genomic intervals in BED, GFF, VCF, and BAM formats. Essential for annotation overlap and peak calling workflows.',
			brew: 'bedtools',
			apt: 'bedtools',
			conda: 'bedtools'
		},
		fastp: {
			label: 'fastp',
			description:
				'Fast FASTQ quality trimming and filtering. Removes adapters, low-quality bases and reads in a single pass. Produces HTML/JSON QC reports. Used upstream of alignment.',
			brew: 'fastp',
			apt: 'fastp',
			conda: 'fastp'
		},
		seqkit: {
			label: 'seqkit',
			description:
				'Toolkit for FASTA/FASTQ file manipulation and statistics. Computes N50, sequence lengths, GC content, quality scores. Useful for quick sanity checks on sequencing data.',
			brew: 'seqkit',
			conda: 'seqkit'
		}
	};

	// ── platform + package manager ─────────────────────────────────────
	let platformOs = $state<OsPlatform>('macos');
	let platformArch = $state<Arch>('x86_64');
	let brewAvailable = $state(false);
	let condaAvailable = $state(false);
	let pmChecked = $state(false);

	// ── per-tool install state ─────────────────────────────────────────
	interface ToolInstallState {
		phase: InstallProgress['phase'] | 'idle' | 'pm-installing';
		bytesDownloaded: number;
		bytesTotal: number | null;
		error: string | null;
		pmLog: string[];
		showLog: boolean;
	}

	let toolStates = $state<Record<string, ToolInstallState>>({});
	let viewerRuntimeProgress = $state<Record<string, ViewerRuntimeInstallProgress>>({});

	function toolState(binary: string): ToolInstallState {
		return (
			toolStates[binary] ?? {
				phase: 'idle',
				bytesDownloaded: 0,
				bytesTotal: null,
				error: null,
				pmLog: [],
				showLog: false
			}
		);
	}

	function setToolState(binary: string, patch: Partial<ToolInstallState>) {
		toolStates = {
			...toolStates,
			[binary]: { ...toolState(binary), ...patch }
		};
	}

	onMount(async () => {
		if (!depsStore.checked) depsStore.checkAll();
		await managedBins.init();
		await viewerRuntimesStore.init();

		const api = liatir();
		if (api) {
			const info = await api.desktop.app.info();
			platformOs = info.os as OsPlatform;
			platformArch = (info.arch === 'aarch64' ? 'arm64' : 'x86_64') as Arch;

			const [brewRes, condaRes] = await Promise.all([
				api.deps.check('brew'),
				api.deps.check('conda')
			]);
			brewAvailable = brewRes.available;
			condaAvailable = condaRes.available;
		}
		pmChecked = true;
	});

	// ── download install (precompiled binary) ──────────────────────────
	async function downloadInstall(binary: string) {
		const label = TOOL_META[binary]?.label ?? binary;
		setToolState(binary, {
			phase: 'downloading',
			error: null,
			bytesDownloaded: 0,
			bytesTotal: null
		});
		installProgress.start(binary, label);
		try {
			await installBinary(binary, platformOs, platformArch, (p) => {
				if (p.phase === 'downloading') {
					setToolState(binary, {
						phase: 'downloading',
						bytesDownloaded: p.bytesDownloaded,
						bytesTotal: p.bytesTotal
					});
					installProgress.update(binary, {
						phase: 'downloading',
						bytesDownloaded: p.bytesDownloaded,
						bytesTotal: p.bytesTotal
					});
				} else if (p.phase === 'extracting') {
					setToolState(binary, { phase: 'extracting' });
					installProgress.update(binary, { phase: 'extracting' });
				} else if (p.phase === 'done') {
					setToolState(binary, { phase: 'done' });
				}
			});
			await depsStore.recheckOne(binary);
			installProgress.done(binary);
		} catch (e) {
			setToolState(binary, { phase: 'error', error: String(e) });
			installProgress.error(binary, String(e));
		}
	}

	// ── package manager install (brew / conda) ─────────────────────────
	function pmInstallCmd(binary: string): { cmd: string; args: string[] } | null {
		const meta = TOOL_META[binary];
		if (!meta) return null;
		if (brewAvailable && meta.brew) return { cmd: 'brew', args: ['install', meta.brew] };
		if (condaAvailable && meta.conda)
			return { cmd: 'conda', args: ['install', '-c', 'bioconda', '-y', meta.conda] };
		return null;
	}

	async function pmInstall(binary: string) {
		const cmd = pmInstallCmd(binary);
		if (!cmd) return;

		const label = TOOL_META[binary]?.label ?? binary;
		setToolState(binary, { phase: 'pm-installing', error: null, pmLog: [], showLog: true });
		installProgress.start(binary, label);
		installProgress.update(binary, { phase: 'pm-installing' });
		try {
			const result = await runNativeTool(cmd.cmd, cmd.args, (line) => {
				setToolState(binary, { pmLog: [...toolState(binary).pmLog, line] });
			});
			if (!result.ok) {
				const msg = result.stderr || `Exited ${result.exitCode}`;
				setToolState(binary, { phase: 'error', error: msg });
				installProgress.error(binary, msg);
			} else {
				setToolState(binary, { phase: 'done' });
				await depsStore.recheckOne(binary);
				installProgress.done(binary);
			}
		} catch (e) {
			setToolState(binary, { phase: 'error', error: String(e) });
			installProgress.error(binary, String(e));
		}
	}

	function fmtBytes(b: number): string {
		if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
		if (b >= 1_000) return `${(b / 1_000).toFixed(0)} KB`;
		return `${b} B`;
	}

	function pmLabel(): string {
		if (brewAvailable) return 'Via Homebrew';
		if (condaAvailable) return 'Via conda';
		return '';
	}

	function viewerProgressLabel(id: string): string {
		const progress = viewerRuntimeProgress[id];
		if (!progress) return '';
		if (progress.phase === 'done') return 'Installed';
		const file = `File ${progress.fileIndex + 1}/${progress.fileCount}`;
		const bytes = progress.bytesTotal
			? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}`
			: fmtBytes(progress.bytesDownloaded);
		return `${file} · ${bytes}`;
	}

	async function installViewerRuntime(id: string) {
		viewerRuntimeProgress = {
			...viewerRuntimeProgress,
			[id]: {
				phase: 'downloading-files',
				fileIndex: 0,
				fileCount: 1,
				bytesDownloaded: 0,
				bytesTotal: null,
			},
		};
		try {
			await viewerRuntimesStore.installManagedRuntime(id, (progress) => {
				viewerRuntimeProgress = { ...viewerRuntimeProgress, [id]: progress };
			});
			toast.success('Viewer runtime installed');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to install viewer runtime');
		} finally {
			const { [id]: _done, ...rest } = viewerRuntimeProgress;
			viewerRuntimeProgress = rest;
		}
	}

	async function removeViewerRuntime(id: string) {
		const runtime = viewerRuntimesStore.byId(id);
		if (!runtime) return;
		const ok = await confirm({
			title: 'Remove viewer runtime',
			message: `Remove "${runtime.name}" from this device? It can be installed again later.`,
			confirmLabel: 'Remove',
		});
		if (!ok) return;
		try {
			await viewerRuntimesStore.removeManagedRuntime(id);
			toast.info('Viewer runtime removed');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to remove viewer runtime');
		}
	}
</script>

<div class="flex flex-col h-full">
	<PageHeader title="Dependencies" description="Bioinformatics tools available on this system">
		{#snippet actions()}
			<Button
				variant="secondary"
				size="sm"
				onclick={() => depsStore.checkAll()}
				loading={depsStore.loading}
			>
				{depsStore.checked ? 'Re-check all' : 'Check all'}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 overflow-y-auto p-6 space-y-4">
		{#if depsStore.loading}
			<div class="flex flex-col items-center gap-3 py-16">
				<Spinner size={28} />
				<p class="text-sm text-zinc-500">Checking {Object.keys(TOOL_META).length} tools…</p>
			</div>
		{:else if !depsStore.checked}
			<div class="flex flex-col items-center gap-4 py-16">
				<p class="text-sm text-zinc-600">No check has been run yet.</p>
				<Button variant="primary" onclick={() => depsStore.checkAll()}>Check Dependencies</Button>
			</div>
		{:else}
			<!-- Summary -->
			<div class="grid grid-cols-3 gap-3">
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Available</p>
					<p class="text-2xl font-semibold text-emerald-500">{depsStore.availableCount}</p>
					<p class="text-xs text-zinc-400 mt-1">of {depsStore.results.length} tools</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Not found</p>
					<p class="text-2xl font-semibold text-red-400">
						{depsStore.results.length - depsStore.availableCount}
					</p>
					<p class="text-xs text-zinc-400 mt-1">not in PATH</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Checked</p>
					<p class="text-2xl font-semibold text-zinc-900">{depsStore.results.length}</p>
					<p class="text-xs text-zinc-400 mt-1">total</p>
				</Card>
			</div>

			<!-- Tool list -->
			<Card>
				<div class="divide-y divide-border">
					<div>
						{#each depsStore.results as dep (dep.binary)}
							{@const meta = TOOL_META[dep.binary]}
							{@const state = toolState(dep.binary)}
							{@const hasRelease = !!getRelease(dep.binary, platformOs, platformArch)}
							{@const hasPm = !!pmInstallCmd(dep.binary)}
							{@const managed = managedBins.get(dep.binary)}
							{@const isBusy =
								state.phase === 'downloading' ||
								state.phase === 'extracting' ||
								state.phase === 'pm-installing'}
							{@const req = DEP_REQUIREMENTS[dep.binary]}
							{@const versionOk = !req || !dep.available || !dep.version || versionGte(dep.version, req.minVersion)}
							{@const isOutdated = dep.available && req && dep.version && !versionGte(dep.version, req.minVersion)}

							<div>
								<!-- Main row -->
								<div class="flex items-center gap-3 px-4 py-3">
									<!-- Status dot -->
									<span
										class="h-2 w-2 rounded-full shrink-0 {isOutdated
											? 'bg-amber-400'
											: dep.available || managed
											? 'bg-emerald-500'
											: 'bg-red-400'}"
									></span>

									<!-- Binary name -->
									<p class="text-sm font-mono font-medium text-zinc-800 w-24 shrink-0">
										{dep.binary}
									</p>

									<!-- Info popup -->
									{#if meta}
										<InfoPopup text="{meta.label} — {meta.description}" />
									{/if}

									<!-- Status message -->
									<div class="flex-1 min-w-0">
										{#if managed && !dep.available}
											<p class="text-xs text-emerald-600 truncate">
												Managed v{managed.version} —
												<span class="font-mono text-zinc-400">{managed.path}</span>
											</p>
										{:else if dep.available}
											{#if isOutdated}
												<p class="text-xs text-amber-600 truncate">
													{dep.version} — requires {req!.minVersion}+
												</p>
											{:else if dep.version}
												<p class="text-xs font-mono text-zinc-500 truncate" data-selectable>
													{dep.version}{req ? ` (min ${req.minVersion})` : ''}
												</p>
											{:else if dep.path}
												<p class="text-xs font-mono text-zinc-400 truncate" data-selectable>
													{dep.path}
												</p>
											{:else}
												<p class="text-xs text-zinc-400">Found in PATH</p>
											{/if}
										{:else if state.phase === 'downloading'}
											<p class="text-xs text-brand">
												Downloading…
												{#if state.bytesTotal}
													{fmtBytes(state.bytesDownloaded)} / {fmtBytes(state.bytesTotal)}
												{:else}
													{fmtBytes(state.bytesDownloaded)}
												{/if}
											</p>
										{:else if state.phase === 'extracting'}
											<p class="text-xs text-brand">Extracting…</p>
										{:else if state.phase === 'pm-installing'}
											<p class="text-xs text-brand">Installing via {pmLabel()}…</p>
										{:else if state.phase === 'done'}
											<p class="text-xs text-emerald-600">Installed successfully</p>
										{:else if state.phase === 'error'}
											<p class="text-xs text-red-500 truncate">{state.error}</p>
										{:else}
											<p class="text-xs text-zinc-400">
												Not found in PATH
												{#if pmChecked && !hasRelease && !hasPm}
													— install via <span class="font-mono">brew</span>,
													<span class="font-mono">conda</span>, or
													<span class="font-mono">apt</span>
												{/if}
											</p>
										{/if}
									</div>

									<!-- Action buttons -->
									{#if (isOutdated || (!dep.available && !managed)) && pmChecked && !isBusy}
										<div class="flex items-center gap-2 shrink-0">
											{#if req?.downloadOptions}
												{#each req.downloadOptions as opt}
													<Button
														variant={opt.recommended ? 'primary' : 'secondary'}
														size="sm"
														onclick={async () => { const api = liatir(); if (api) await api.openBrowser(opt.url); }}
													>
														{opt.label} ↗
													</Button>
												{/each}
											{:else}
												{#if hasRelease}
													<Button
														variant="primary"
														size="sm"
														onclick={() => downloadInstall(dep.binary)}
													>
														Download & Install
													</Button>
												{/if}
												{#if hasPm}
													<Button variant="secondary" size="sm" onclick={() => pmInstall(dep.binary)}>
														{pmLabel()}
													</Button>
												{/if}
											{/if}
										</div>
									{:else if isBusy}
										<div class="shrink-0">
											<svg class="animate-spin h-4 w-4 text-brand" viewBox="0 0 24 24" fill="none">
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="3"
												/>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
											</svg>
										</div>
									{:else if !isBusy && (dep.available || managed) && pmChecked}
										<p class="text-xs text-zinc-400">Installed</p>
									{/if}

									<!-- Toggle log -->
									{#if (state.pmLog.length > 0 || state.phase === 'error') && !isBusy}
										<button
											onclick={() => setToolState(dep.binary, { showLog: !state.showLog })}
											class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors shrink-0 font-mono"
										>
											{state.showLog ? 'hide' : 'log'}
										</button>
									{/if}
								</div>

								<!-- Install log -->
								{#if state.showLog && (state.pmLog.length > 0 || state.phase === 'error')}
									<div
										class="mx-4 mb-3 rounded-lg border border-border bg-zinc-950 px-3 py-2 max-h-40 overflow-y-auto"
									>
										{#if state.phase === 'error' && state.error}
											<p class="text-xs font-mono text-red-400 mb-1">{state.error}</p>
										{/if}
										{#each state.pmLog as line}
											<p class="text-[11px] font-mono text-zinc-300 leading-relaxed">{line}</p>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div></Card
			>

			<Card>
				<div class="border-b border-border px-4 py-3">
					<p class="text-sm font-semibold text-zinc-800">Viewer runtimes</p>
					<p class="mt-1 text-xs text-zinc-400">
						Optional scientific visualization dependencies. Install only the runtimes needed by your workflows.
					</p>
				</div>
				<div class="divide-y divide-border">
					{#each viewerRuntimesStore.runtimes as runtime (runtime.id)}
						{@const progress = viewerRuntimeProgress[runtime.id]}
						{@const installable = runtime.install.kind === 'managed-script'}
						<div class="flex items-center gap-3 px-4 py-3">
							<span
								class="h-2 w-2 rounded-full shrink-0 {runtime.status === 'installed'
									? 'bg-emerald-500'
									: installable
									? 'bg-amber-400'
									: 'bg-zinc-300'}"
							></span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="truncate text-sm font-medium text-zinc-800">{runtime.name}</p>
									<span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">
										{runtime.capability}
									</span>
								</div>
								<p class="mt-1 text-xs text-zinc-500">{runtime.description}</p>
								<p class="mt-1 text-[10px] text-zinc-400">
									{runtime.license}
									{#if runtime.localPath}
										<span class="font-mono"> · {runtime.localPath}</span>
									{:else if runtime.install.note}
										 · {runtime.install.note}
									{/if}
								</p>
								{#if progress}
									<p class="mt-1 text-xs text-brand">{viewerProgressLabel(runtime.id)}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if progress}
									<svg class="h-4 w-4 animate-spin text-brand" viewBox="0 0 24 24" fill="none">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
									</svg>
								{:else if runtime.status === 'installed' && installable}
									<Button size="sm" variant="ghost" onclick={() => removeViewerRuntime(runtime.id)}>
										Remove
									</Button>
								{:else if installable}
									<Button size="sm" variant="primary" onclick={() => installViewerRuntime(runtime.id)}>
										Install
									</Button>
								{:else if runtime.install.docsUrl}
									<Button
										size="sm"
										variant="secondary"
										onclick={async () => { const api = liatir(); if (api) await api.openBrowser(runtime.install.docsUrl!); }}
									>
										Docs ↗
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</Card>

			<!-- Footer note -->
			{#if pmChecked}
				<p class="text-xs text-zinc-400 text-center">
					{#if brewAvailable && condaAvailable}
						Homebrew and conda detected.
					{:else if brewAvailable}
						Homebrew detected.
					{:else if condaAvailable}
						conda detected.
					{:else}
						No package manager detected in PATH.
					{/if}
					"Download & Install" bundles precompiled binaries directly into Liatir — no package manager
					required.
				</p>
			{/if}
		{/if}
	</div>
</div>
