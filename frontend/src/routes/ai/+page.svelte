<!-- Runtime Box-only AI Model catalog. Installs are owned by aiModelsStore and survive navigation. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '@iconify/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';
	import Badge, { type BadgeVariants } from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { modelInstallBlock } from '$lib/ai/model-compatibility';
	import { aiModelLiatirDocsUrl, aiModelOfficialUrl } from '$lib/ai/model-docs';
	import { aiModelInfo } from '$lib/ai/model-help';
	import { aiModelsStore } from '$lib/stores/aiModels.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		fmtBytes,
		getLastSegmentsStringFromPath,
		openLinkInBrowser,
		sanitizeLocalPathsForDisplay
	} from '$lib/utils';
	import type { LiatirAIModelRecord, LiatirAIModelRuntimePackage } from '@liatir/core';
	import Divider from '$lib/components/ui/Divider.svelte';

	let loading = $state(!aiModelsStore.initialized);
	let searchQuery = $state('');
	let expandedModelDetails = $state<Record<string, boolean>>({});

	onMount(() => {
		let cancelled = false;
		loading = !aiModelsStore.initialized;
		void (async () => {
			await aiModelsStore.init();
			const runtimeRefresh = aiModelsStore.ensureRuntimeBoxStatuses();
			void aiModelsStore.ensureHardwareInfo();
			if (!cancelled) loading = false;
			void runtimeRefresh;
		})();
		return () => {
			cancelled = true;
		};
	});

	const models = $derived(aiModelsStore.models);
	const runtimeChecks = $derived(aiModelsStore.runtimeChecks);
	const installing = $derived(aiModelsStore.installing);
	const installLogs = $derived(aiModelsStore.installLogs);
	const hardware = $derived(aiModelsStore.hardwareInfo);
	const hardwareInfoChecked = $derived(aiModelsStore.hardwareInfoChecked);
	const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
	const filteredModels = $derived(
		normalizedSearch
			? models.filter((model) => modelSearchText(model).includes(normalizedSearch))
			: models
	);
	const installedCount = $derived(
		models.filter((model) => model.status === 'installed' && !runtimeChecks[model.id]).length
	);
	const filteredInstalledCount = $derived(
		filteredModels.filter((model) => model.status === 'installed' && !runtimeChecks[model.id]).length
	);
	const runnableCount = $derived(aiModelsStore.runnableModels.length);

	function isChecking(model: LiatirAIModelRecord): boolean {
		return runtimeChecks[model.id] === true ||
			(Boolean(model.install.hostRequirements) && !hardwareInfoChecked);
	}

	function statusLabel(model: LiatirAIModelRecord): string {
		if (installing[model.id]) return 'installing';
		if (isChecking(model)) return 'checking';
		if (model.status === 'installed') return 'installed';
		if (model.status === 'error') return 'needs attention';
		return 'not installed';
	}

	function statusVariant(model: LiatirAIModelRecord): BadgeVariants {
		if (installing[model.id] || isChecking(model)) return 'running';
		if (model.status === 'installed') return 'done';
		if (model.status === 'error') return 'failed';
		return 'brand';
	}

	function actionsLocked(model: LiatirAIModelRecord): boolean {
		return Boolean(installing[model.id]) || isChecking(model);
	}

	function modelSearchText(model: LiatirAIModelRecord): string {
		return [
			model.name,
			model.id,
			model.description,
			model.runtime.name,
			model.license?.name,
			...model.capabilities,
			...model.modalities,
			...(model.tags ?? [])
		].filter(Boolean).join(' ').toLowerCase();
	}

	function runtimeLabel(model: LiatirAIModelRecord): string {
		return `${model.runtime.name}${model.runtime.version ? ` ${model.runtime.version}` : ''}`;
	}

	function hardwareLabel(model: LiatirAIModelRecord): string {
		const parts: string[] = [];
		if (model.hardware?.recommendedRamGb != null) parts.push(`${model.hardware.recommendedRamGb} GB RAM`);
		if (model.hardware?.recommendedVramGb != null) parts.push(`${model.hardware.recommendedVramGb} GB VRAM`);
		if (model.hardware?.gpu === false) parts.push('CPU');
		if (model.hardware?.gpu === true) parts.push('GPU');
		return parts.join(' / ') || 'Target-dependent';
	}

	function runtimePackages(model: LiatirAIModelRecord): LiatirAIModelRuntimePackage[] {
		return model.install.runtimePackages ?? [];
	}

	function packageLabel(pkg: LiatirAIModelRuntimePackage): string {
		if (pkg.specifier && pkg.specifier !== pkg.package) return `${pkg.package}: ${pkg.specifier}`;
		if (pkg.version) return `${pkg.package} ${pkg.version}`;
		return pkg.package;
	}

	function installedSize(model: LiatirAIModelRecord): string {
		if (model.installedSizeBytes) return `${fmtBytes(model.installedSizeBytes)} installed`;
		if (model.diskSizeBytes) return `${fmtBytes(model.diskSizeBytes)}`;
		return 'Size reported after install';
	}

	function isDetailsExpanded(id: string): boolean {
		return expandedModelDetails[id] ?? false;
	}

	function toggleDetails(id: string) {
		expandedModelDetails = { ...expandedModelDetails, [id]: !isDetailsExpanded(id) };
	}

	function installLabel(model: LiatirAIModelRecord): string {
		const progress = installing[model.id];
		if (!progress) return 'Install';
		if (progress.message) return progress.message;
		return progress.bytesTotal
			? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}`
			: fmtBytes(progress.bytesDownloaded);
	}

	function installPercent(model: LiatirAIModelRecord): number | null {
		const progress = installing[model.id];
		if (!progress?.bytesTotal || progress.bytesTotal <= 0) return null;
		return Math.max(0, Math.min(100, progress.bytesDownloaded / progress.bytesTotal * 100));
	}

	function installLogState(id: string): { showLog: boolean; logLines: string[] } | null {
		const current = installing[id];
		if (current?.logLines.length) return current;
		const saved = installLogs[id];
		return saved?.logLines.length ? saved : null;
	}

	function logLineClass(line: string): string {
		const lower = line.toLowerCase();
		return lower.includes('error') || lower.includes('failed') ? 'text-red-400' : 'text-zinc-300';
	}

	function errorMessage(error: unknown, fallback: string): string {
		return error instanceof Error && error.message ? error.message : fallback;
	}

	async function installModel(model: LiatirAIModelRecord) {
		if (actionsLocked(model)) return;
		const blocked = modelInstallBlock(model, hardware);
		if (blocked) {
			toast.error(blocked.reason);
			return;
		}
		try {
			await aiModelsStore.installRuntimeBoxModel(model.id);
			toast.success('Runtime Box installed');
		} catch (error) {
			toast.error(errorMessage(error, 'Failed to install Runtime Box'));
		}
	}

	async function removeModel(model: LiatirAIModelRecord) {
		if (actionsLocked(model)) return;
		const ok = await confirm({
			title: 'Remove AI Model',
			message: `Remove the Runtime Box for "${model.name}" from this device?`,
			confirmLabel: 'Remove'
		});
		if (!ok) return;
		try {
			await aiModelsStore.removeRuntimeBoxModel(model.id);
			toast.info('Runtime Box removed');
		} catch (error) {
			toast.error(errorMessage(error, 'Failed to remove Runtime Box'));
		}
	}

	async function openModelDocs(model: LiatirAIModelRecord) {
		const url = aiModelLiatirDocsUrl(model);
		if (url) await openLinkInBrowser(url);
	}

	async function openOfficialModelPage(model: LiatirAIModelRecord) {
		const url = aiModelOfficialUrl(model);
		if (url) await openLinkInBrowser(url);
	}
</script>

<div class="flex flex-col h-full overflow-hidden">
	<PageHeader title="AI Models" description="Signed Runtime Boxes for local scientific AI">
		{#snippet actions()}
			<Button size="sm" variant="secondary" onclick={() => goto('/pipeline')}><Icon icon="lucide:workflow" width="14" height="14" />Pipeline</Button>
		{/snippet}
	</PageHeader>
	<PageContent>
		<div class="flex-1 overflow-y-auto p-6 space-y-5">
			<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
				<div class="border border-border bg-surface rounded-lg px-4 py-3"><p class="text-[10px] font-semibold uppercase text-text-subtle">Published catalog</p><p class="mt-1 text-sm font-semibold text-text">{models.length} Runtime Boxes</p></div>
				<div class="border border-border bg-surface rounded-lg px-4 py-3"><p class="text-[10px] font-semibold uppercase text-text-subtle">Installed</p><p class="mt-1 text-sm font-semibold text-text">{installedCount} model{installedCount === 1 ? '' : 's'}</p></div>
				<div class="border border-border bg-surface rounded-lg px-4 py-3"><p class="text-[10px] font-semibold uppercase text-text-subtle">Runnable</p><p class="mt-1 text-sm font-semibold text-text">{runnableCount} model{runnableCount === 1 ? '' : 's'}</p></div>
			</div>

			<div class="border border-border bg-surface rounded-lg px-4 py-3">
				<p class="text-[10px] font-semibold uppercase text-text-subtle">Detected host</p>
				<p class="mt-1 text-sm font-semibold text-text">{hardware ? `${hardware.cpuCores} CPU cores${hardware.totalMemoryBytes ? ` · ${fmtBytes(hardware.totalMemoryBytes)} RAM` : ''}${hardware.appleMetal ? ' · Apple Metal' : ''}${hardware.cudaAvailable ? ' · CUDA' : ''}${hardware.wsl2Available ? ' · WSL2' : ''}` : 'Hardware detection unavailable'}</p>
			</div>

			<div class="relative max-w-md">
				<Icon icon="lucide:search" width="15" height="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
				<input type="text" bind:value={searchQuery} placeholder="Search Runtime Box models..." data-testid="ai-models-search" class="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-brand" />
			</div>

			{#if loading}
				<div class="flex justify-center py-16"><Spinner /></div>
			{:else if filteredModels.length === 0}
				<div data-testid="ai-models-empty" class="border border-border bg-surface rounded-lg px-4 py-10 text-center text-sm text-text-muted">No Runtime Box model matches this search.</div>
			{:else}
				<div class="space-y-3">
					{#each filteredModels as model (model.id)}
						{@const blocked = modelInstallBlock(model, hardware)}
						{@const progress = installing[model.id]}
						{@const percent = installPercent(model)}
						{@const installLog = installLogState(model.id)}
						<div data-testid="ai-model-card" data-model-id={model.id} class="border border-border bg-surface rounded-lg overflow-hidden">
							<div class="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-4 items-center">
								<div class="min-w-0">
									<div class="flex items-center gap-2"><p class="text-sm font-semibold text-text truncate">{model.name}</p><Badge variant={statusVariant(model)} size="xs">{statusLabel(model)}</Badge></div>
									<p class="mt-1 text-xs text-text-muted leading-relaxed">{model.description}</p>
									<div class="mt-2 flex flex-wrap gap-1.5">{#each model.capabilities as capability}<span class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">{capability}</span>{/each}</div>
									{#if blocked}<div class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800"><p class="font-semibold">{blocked.summary}</p><p class="mt-0.5">{blocked.reason}</p></div>{/if}
								</div>
								<div class="text-xs text-text-secondary min-w-0">
									<p>{runtimeLabel(model)}</p>
									<div class="rounded-lg border bg-brand/12 text-brand border-brand/30 px-2 py-1 mt-2 group cursor-default" title="&#13; Hardware: &#13; {hardwareLabel(model)} &#13;&#13; Approx. model size: &#13; {installedSize(model)} &#13;">
										<p class="mt-1 text-[10px] opacity-65 group-hover:opacity-100"><span class="block font-bold mb-0.5">Hardware:</span>{hardwareLabel(model)}</p><p class="mt-1.5 text-[10px]">~ model size: {installedSize(model)}</p>
									</div>
								</div>
								<div class="flex flex-wrap items-stretch justify-end gap-2 ml-2">
									<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted hover:text-text" title="Model details" aria-label="Model details" onclick={() => toggleDetails(model.id)}><Icon icon={isDetailsExpanded(model.id) ? 'lucide:chevron-up' : 'lucide:list-tree'} width="14" height="14" /></button>
									{#if aiModelLiatirDocsUrl(model)}<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted hover:text-text" title="Documentation" aria-label="Documentation" onclick={() => openModelDocs(model)}><Icon icon="lucide:book-open" width="14" height="14" /></button>{/if}
									{#if aiModelOfficialUrl(model)}<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted hover:text-text" title="Official page" aria-label="Official page" onclick={() => openOfficialModelPage(model)}><Icon icon="lucide:external-link" width="14" height="14" /></button>{/if}
									{#if model.status === 'installed' && !(isChecking(model)) && !progress}<Button size="sm" variant="secondary" class="hover:bg-red-500" testId="ai-model-remove-button" disabled={actionsLocked(model)} onclick={() => removeModel(model)}><Icon icon="lucide:trash"></Icon></Button><Button size="sm" variant="secondary" testId="ai-model-run-button" disabled={actionsLocked(model)} class="min-w-[60px] hover:bg-brand" onclick={() => goto(`/ai/${encodeURIComponent(model.id)}`)}>Run</Button>{:else if !progress && !(isChecking(model))}<Button size="sm" variant="secondary" style="opacity: 0.2; pointer-events: none; {(filteredInstalledCount<=filteredModels.length&&filteredInstalledCount>0)?"":"display: none;"}" disabled><Icon icon="lucide:trash"></Icon></Button><Button size="sm" variant="primary" testId="ai-model-install-button" class="min-w-[60px]" disabled={actionsLocked(model) || !!blocked} onclick={() => installModel(model)}>Install</Button>{/if}
								</div>
							</div>

							{#if progress}
								<div class="mx-4 mb-3"><div class="flex items-center justify-between text-[10px] text-text-muted"><span>{installLabel(model)}</span>{#if percent !== null}<span>{Math.round(percent)}%</span>{/if}<button type="button" class="font-mono hover:text-text" onclick={() => aiModelsStore.toggleInstallLog(model.id)}>{progress.showLog ? 'hide log' : 'log'}</button></div><div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">{#if percent !== null}<div class="h-full rounded-full bg-brand" style={`width: ${percent}%`}></div>{:else}<div class="h-full w-1/2 rounded-full bg-brand/70 animate-pulse"></div>{/if}</div></div>
							{:else if installLog}<div class="mx-4 mb-3 text-right"><button type="button" class="font-mono text-[10px] text-text-subtle hover:text-text" onclick={() => aiModelsStore.toggleInstallLog(model.id)}>{installLog.showLog ? 'hide log' : 'install log'}</button></div>{/if}
							{#if installLog?.showLog}<div class="mx-4 mb-3 rounded-lg border border-border bg-zinc-950 px-3 py-2 max-h-40 overflow-y-auto">{#each installLog.logLines as line}<p class="text-[11px] font-mono leading-relaxed {logLineClass(line)}">{sanitizeLocalPathsForDisplay(line, 2)}</p>{/each}</div>{/if}

							{#if isDetailsExpanded(model.id)}
								<div class="mx-4 mb-4 rounded-lg border border-border bg-surface-2 px-3 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-text-secondary">
									<div>
										<p class="text-[10px] font-semibold uppercase text-text-subtle">Runtime Box</p><p class="mt-1 font-medium text-text">{model.install.runtimeBox.boxId}</p><p class="my-1 text-[11px] text-text-muted">Channel: {model.install.runtimeBox.channel}</p>
										{#if model.localPath}<Divider/><p class="mt-1 text-[10px] text-text-subtle truncate" title={model.localPath}>Local path:<br>.../{getLastSegmentsStringFromPath(model.localPath, 2)}</p>{/if}
									</div>
									<div><p class="text-[10px] font-semibold uppercase text-text-subtle">Runtime packages</p>{#if runtimePackages(model).length}{#each runtimePackages(model) as pkg}<p class="mt-1" title={packageLabel(pkg)}>{packageLabel(pkg)}</p>{/each}{:else}<p class="mt-1">Contained in the signed box</p>{/if}</div>
									<div><p class="text-[10px] font-semibold uppercase text-text-subtle">Licenses</p><p class="mt-1 font-medium text-text">{model.license?.name ?? 'Unspecified'}</p>{#if model.license?.verifiedAt}<p class="mt-1 text-[11px] text-text-muted">Verified {model.license.verifiedAt}</p>{/if}</div>
									<div class="md:col-span-3 text-[11px] text-text-muted">{aiModelInfo(model)}</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</PageContent>
</div>
