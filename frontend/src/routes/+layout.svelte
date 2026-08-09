<script lang="ts">
	import '../app.css';
	import '$lib/icons';
	import '$lib/stores/workspace-reset';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import InstallBanner from '$lib/components/ui/InstallBanner.svelte';
	import StartupCleanupBanner from '$lib/components/ui/StartupCleanupBanner.svelte';
	import {
		finalizeCompletedAIDirectRuns,
		hasRunningDirectAIJob
	} from '$lib/ai/direct-run-finalizer';
	import { initAppCloseGuard } from '$lib/stores/appCloseGuard.svelte';
	import { installGlobalErrorHandler } from '$lib/diagnostics/global-error-handler';
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { pipelineStore } from '$lib/stores/pipeline.svelte';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sidebarWidth } from '$lib/stores/sidebar';
	// import QuentaFloatingButton from '$lib/components/quenta/QuentaFloatingButton.svelte';

	let { children } = $props();

	let initialized: boolean = $state(false);
	let jobRefreshInterval: ReturnType<typeof setInterval> | null = null;
	let closeGuardUnlisten: (() => void) | null = null;
	let refreshingJobs = false;
	let sidebarForceExpand = $state(false);
	const isPluginDevRoute = $derived(page.url.pathname.startsWith('/plugin-dev'));
	const isStandaloneQuenta = $derived(
		page.url.pathname === '/quenta' && page.url.searchParams.get('window') === '1'
	);

	async function refreshJobsAndFinalize() {
		if (refreshingJobs) return;
		refreshingJobs = true;
		try {
			await jobsStore.refresh();
			await finalizeCompletedAIDirectRuns(jobsStore.jobs);
		} finally {
			refreshingJobs = false;
		}
	}

	// Finalization is driven by the jobs list, not by any screen (see direct-run-finalizer): react to
	// every change to the jobs so a completed direct AI run becomes a Result immediately. Without this
	// a run that finished after the running-job poll interval stopped — for example one observed only
	// once the Jobs page refreshed it into the store — would not be finalized until the interval ran
	// again or a reload remounted this layout. The finalizer is idempotent, so overlapping calls with
	// the interval are safe.
	$effect(() => {
		const jobs = jobsStore.jobs;
		if (!initialized || isPluginDevRoute || !workspaceStore.activeId) return;
		void finalizeCompletedAIDirectRuns(jobs);
	});

	onMount(async () => {
		// Capture uncaught errors app-wide (incl. the plugin-dev window) before
		// anything else runs, so early failures are recorded too.
		installGlobalErrorHandler();
		// Load persisted settings early so the theme applies app-wide
		// (including the plugin-dev window). Fire-and-forget: nothing below
		// depends on it and the boot theme is already set from app.html.
		void settingsStore.init();
		if (isPluginDevRoute) {
			initialized = true;
			return;
		}
		closeGuardUnlisten = await initAppCloseGuard();
		await workspaceStore.init();
		if (!(workspaceStore.activeId && workspaceStore.active)) {
			goto('/workspaces');
			initialized = true;
			return;
		}
		await refreshJobsAndFinalize();
		jobRefreshInterval = setInterval(() => {
			if (jobsStore.runningCount > 0 || hasRunningDirectAIJob(jobsStore.jobs)) {
				void refreshJobsAndFinalize();
			}
		}, 2000);
		pipelineStore.init();
		
		initialized = true;
	});

	const setSidebarForceExpand = (status: boolean) => {
		if((sidebarForceExpand && status) || (!sidebarForceExpand && !status)) return;
		sidebarForceExpand = status;
	};

	onDestroy(() => {
		closeGuardUnlisten?.();
		if (jobRefreshInterval) clearInterval(jobRefreshInterval);
	});
</script>

{#if isPluginDevRoute}
	<div class="h-screen overflow-hidden" style="background-color: var(--color-bg);">
		{@render children()}
	</div>
	<Toast />
{:else if !workspaceStore.initialized || !initialized}
	<div class="h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
		<svg
			class="animate-spin h-5 w-5 text-brand"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
		>
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
			></circle>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
			></path>
		</svg>
	</div>
{:else}
<div style="{workspaceStore.isSandboxMode ? 'background-color: var(--color-sandbox-500);' : ''}">
<div
        class="{workspaceStore.isSandboxMode
            ? 'border-t-2 3xl:border-t-3'
            : ''} flex h-screen overflow-hidden border-sandbox-500 transition-[border-width] duration-[0.48s] ease-in-out relative"
        style="background-color: var(--color-bg);"
    >
			{#if workspaceStore.active && workspaceStore.activeId && initialized && !isStandaloneQuenta}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute left-0 top-0 h-full z-20" onmouseenter={()=>setSidebarForceExpand(true)} onmouseleave={()=>setSidebarForceExpand(false)}>
					<Sidebar forceExpand={sidebarForceExpand}/>
				</div>
			{/if}
			
		{#key workspaceStore.activeId}
			<main class="w-full h-full overflow-y-auto" style:padding-left={isStandaloneQuenta ? '0' : `${$sidebarWidth}px`}>
				{@render children()}
			</main>
		{/key}
    </div>
</div>
	<Toast />
	<InstallBanner />
	<StartupCleanupBanner />
{/if}

<ConfirmDialog />


<!-- <QuentaFloatingButton/> -->