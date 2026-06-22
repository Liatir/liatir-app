<script lang="ts">
	import '../app.css';
	import '$lib/icons';
	import '$lib/stores/workspace-reset';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import InstallBanner from '$lib/components/ui/InstallBanner.svelte';
	import StartupCleanupBanner from '$lib/components/ui/StartupCleanupBanner.svelte';
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import { pipelineStore } from '$lib/stores/pipeline.svelte';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { children } = $props();

	let initialized: boolean = $state(false);

	onMount(async () => {
		await workspaceStore.init();
		if (!(workspaceStore.activeId && workspaceStore.active)) {
			goto('/workspaces');
			initialized=true;
			return;
		}
		jobsStore.refresh();
		pipelineStore.init();
		initialized=true;
	});
</script>


{#if !workspaceStore.initialized || !initialized}
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
	<div
		class="{workspaceStore.isSandboxMode
			? 'border-x-[5px]'
			: ''} flex h-screen overflow-hidden border-sandbox-500 transition-[border-width] duration-[0.48s] ease-in-out"
		style="background-color: var(--color-bg);"
	>
		{#if workspaceStore.active && workspaceStore.activeId && initialized}
			<Sidebar />
		{/if}
		<main class="flex-1 overflow-y-auto">
			{@render children()}
		</main>
	</div>

	<ConfirmDialog />
	<Toast />
	<InstallBanner />
	<StartupCleanupBanner />
{/if}
