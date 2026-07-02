<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { goto } from '$app/navigation';
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import { workspaceStore, SANDBOX_WORKSPACE_ID } from '$lib/stores/workspace.svelte';
	import { pipelineStore } from '$lib/stores/pipeline.svelte';
	import CustomIcon from '../ui/CustomIcon.svelte';
	import Divider from '../ui/Divider.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { NAV_PAGES, NAV_PAGES_BOTTOM, routeIsInSidebar, SIDEBAR_EXPANDED_WIDTH, type NavItem } from '$lib/sidebarUtils';
	import { sidebarCollapsed, sidebarWidth } from '$lib/stores/sidebar';
	import { HEADER_HEIGHT } from '$lib/_constants';

	let { forceExpand=false } = $props();

	let sideWidth = $derived(forceExpand ? SIDEBAR_EXPANDED_WIDTH : $sidebarWidth);
	let sideCollapsed = $derived(forceExpand ? false : $sidebarCollapsed);

	onMount(() => {
		const lastCollapsedStatus = localStorage.getItem('sidebar-collapsed') === 'true';
		sidebarCollapsed.set(lastCollapsedStatus);
	});

	sidebarCollapsed.subscribe((value)=>{
		localStorage.setItem('sidebar-collapsed', String(value));
	})

	function isActive(item: NavItem): boolean {
		if (!item.href) return false;
		const path = page.url.pathname;
		if (item.href === '/') return path === '/';
		if (item.href === '/workspaces') return path === '/workspaces';
		return path.startsWith(item.match ?? item.href);
	}

	async function navigateToPage(navItem: NavItem) {
		if(navItem?.workspacePage) {
			await workspaceStore.switchTo("");
			jobsStore.refresh();
			pipelineStore.init();
			if(navItem?.href) goto(navItem.href);
		} else {
			if(navItem?.href) goto(navItem.href);
		}
	};

	async function toggleSandboxMode() {
		if (!workspaceStore.isSandboxMode) {
			const routeId: string = (page.route.id)??"/";
			const params = new URLSearchParams();
			// Lo slash viene codificato automaticamente in %2F
			params.set('fromWorkspace', ((workspaceStore?.activeId?.trim())||""));
			const queryParam: string = params.toString().trim();

			await workspaceStore.switchTo(SANDBOX_WORKSPACE_ID);
			jobsStore.refresh();
			pipelineStore.init();

			const sidebarHasRoute: boolean = routeIsInSidebar(routeId);
			if(sidebarHasRoute) await goto(`${routeId}?${queryParam}`);
			else await goto(`/?${queryParam}`);

			toast.info("Now using sandbox workspace");
		} else {
			const toWorkspace = (page.url.searchParams.get('fromWorkspace')?.trim()) ?? "";
			const routeId: string = (page.route.id)??"/";
			const pageHasToWorkspace:boolean = (toWorkspace?.trim())?true:false;
			const hasPreviousActiveWorkspace:boolean = (workspaceStore?.previousActiveId?.trim())?true:false;
			if(pageHasToWorkspace || hasPreviousActiveWorkspace) {
				if(pageHasToWorkspace) await workspaceStore.switchTo(toWorkspace??"");
				else if(hasPreviousActiveWorkspace) await workspaceStore.switchTo(workspaceStore.previousActiveId??"");
				jobsStore.refresh();
				pipelineStore.init();
				toast.info(`Back to: ${workspaceStore.active?.name}`);

				const sidebarHasRoute: boolean = routeIsInSidebar(routeId);
				if(sidebarHasRoute) await goto(routeId);
				else await goto(`/`);
			} else {
				await workspaceStore.switchTo("");
				jobsStore.refresh();
				pipelineStore.init();
				await goto('/workspaces');
			}
		}
	}
</script>

<aside
	class="flex relative h-screen shrink-0 flex-col border-r border-border bg-surface transition-all duration-200"
	id="sidebar-container"
	style="width: {sideWidth}px;"
	>
	<!-- <button
		onclick={()=> sidebarCollapsed.set(!sideCollapsed)}
		title={sideCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		class="shrink-0 w-5 h-8 p-0.5 top-[calc(50vh-10px)] font-semibold z-50 rounded-r-md absolute border-y border-r border-y-border border-r-border bg-zinc-50 text-zinc-300"
		id="collapse-sidebar-button"
		style="left: {(forceExpand ? SIDEBAR_EXPANDED_WIDTH : sideWidth)}px;"
	>
		<Icon
			icon="lucide:chevron-left"
			class="w-full h-full transition-transform duration-200 {sideCollapsed?'scale-x-[-1]':''}"
		/>
	</button> -->
	<!-- Logo -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex items-center justify-start border-b border-border pt-1.5 px-3 gap-2.5 text-left {workspaceStore.active?'hover:bg-zinc-100 hover:cursor-pointer':''}"
		id="logo-section"
		onclick={()=>{if(workspaceStore.active) goto("/workspace-settings")}}
		style="height: {HEADER_HEIGHT}px"
		>
		<div class="flex w-9 h-9 overflow-hidden items-center gap-0 space-x-0 justify-center rounded-lg bg-brand shrink-0" id="sidebar-logo-container">
			<div class="h-9 w-9 flex p-1.5 justify-center items-center shrink-0" id="sidebar-logo">
				<img src="/logo/png/logo-white.png" alt="Liatir" class="h-full w-full opacity-100 object-contain" />
			</div>
		</div>

		{#if !sideCollapsed}
			<div class="flex items-center justify-start min-w-0 h-9 w-full overflow-hidden">
				<div class="h-fit w-full">
					{#if workspaceStore.active}
						<p class="text-[11px] text-zinc-400 truncate mb-0.5">Workspace:</p>
						{#if workspaceStore.isSandboxMode}
							<div class="flex items-center justify-start bg-sandbox-100 rounded px-1.5 h-[16px] w-fit">
								<p class="text-[11px] font-medium text-sandbox-600 w-fit">sandbox</p>
							</div>
						{:else}
							<div class="flex items-center justify-start h-[16px]">
								<p class="text-sm font-semibold text-zinc-800 truncate">{workspaceStore.active.name}</p>
							</div>
						{/if}
					{:else}
						<div class="flex items-center justify-start">
							<p class="text-md font-semibold text-zinc-800 truncate">Liatir</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Navigation -->
	<nav class="flex-1 overflow-y-auto px-1.5 py-3 space-y-0.5">
		{#each NAV_PAGES as item}
			{@const active = isActive(item)}
			{#if item?.global || (workspaceStore.activeId && page.route.id!="/workspaces")}
				{#if item?.divider}
					<Divider my={5}/>
				{:else}
					<button
						onclick={()=>navigateToPage(item as NavItem)}
						title={sideCollapsed ? item.label : undefined}
						data-testid="sidebar-nav-item"
						data-route={item.href}
						class="group relative flex w-full overflow-hidden text-left items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
							{sideCollapsed ? 'justify-center' : ''}
							{(active && !(item?.workspacePage))
							? 'bg-brand/10 text-brand font-medium'
							: 'text-zinc-500 hover:bg-zinc-100/90 hover:text-zinc-800'}"
					>
						{#if item?.customIcon}
							<CustomIcon src={item.customIcon} class="w-[16px] h-[16px] opacity-60"/>
						{:else if item?.icon}
							<Icon icon={item.icon} width="16" height="16" class="shrink-0" />
						{/if}

						{#if !sideCollapsed}
							<span class="flex-1 truncate">{item.label}</span>
							{#if item.match === '/jobs' && jobsStore.runningCount > 0}
								<span
									class="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-600"
								>
									{jobsStore.runningCount}
								</span>
							{/if}
						{:else if item.match === '/jobs' && jobsStore.runningCount > 0}
							<span class="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-sky-500"></span>
						{/if}
					</button>
				{/if}
			{/if}
		{/each}
	</nav>

	<div class="px-1.5 py-3 space-y-0.5 overflow-hidden">
		<!-- Bottom nav -->
		{#each NAV_PAGES_BOTTOM as item}
			{@const active = isActive(item)}
			{#if item?.global || (workspaceStore.activeId && page.route.id!="/workspaces")}
				{#if item?.divider}
					<Divider my={5}/>
				{:else}
					<button
						onclick={()=>navigateToPage(item as NavItem)}
						title={sideCollapsed ? item.label : undefined}
						data-testid="sidebar-nav-item"
						data-route={item.href}
						class="group relative flex overflow-hidden w-full text-left items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
							{sideCollapsed ? 'justify-center' : ''}
							{(active && !(item?.workspacePage))
							? 'bg-brand/10 text-brand font-medium'
							: 'text-zinc-500 hover:bg-zinc-100/90 hover:text-zinc-800'}"
					>

						{#if item?.customIcon}
							<CustomIcon src={item.customIcon} class="w-[16px] h-[16px] opacity-60"/>
						{:else if item?.icon}
							<Icon icon={item.icon} width="16" height="16" class="shrink-0" />
						{/if}

						{#if !sideCollapsed}
							<span class="flex-1 truncate">{item.label}</span>
						{/if}
					</button>
				{/if}
			{/if}
		{/each}

		<!-- Toggle Sandbox -->
		<button
			onclick={toggleSandboxMode}
			title={sideCollapsed ? 'Toggle Sandbox' : undefined}
			class="w-full flex items-center overflow-hidden gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
					{sideCollapsed ? 'justify-center' : ''}
					{workspaceStore.isSandboxMode?'text-sandbox-600 hover:bg-sandbox-50':'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100/90'}"
		>
			<Icon icon="lucide:flask-conical" width="16" height="16" class="shrink-0" />
			{#if !sideCollapsed}
				<span class="flex-1 text-left">Sandbox</span>
				<span class="text-[10px] font-medium bg-sandbox-100 text-sandbox-600 rounded px-1 leading-5">{workspaceStore.isSandboxMode?'exit':''}</span>
			{/if}
		</button>

					<Divider my={5}/>

		<!-- Set sidebar collapsed status -->
		<div
			class="w-full flex items-center overflow-hidden gap-3 rounded-lg px-1 text-sm transition-colors duration-100
					{sideCollapsed ? 'justify-center' : ''}"
		>

			{#if $sidebarCollapsed}
				<button data-testid="sidebar-collapse-toggle" class="w-fit text-right text-zinc-800 hover:bg-zinc-100 py-1.5 px-1.5 rounded-md" onclick={()=>sidebarCollapsed.set(false)}>
					<Icon icon="ph:sidebar-simple-light" width="17" height="17" class="shrink-0 rotate-180" />
				</button>
			{:else}
				<button data-testid="sidebar-collapse-toggle" class="w-fit text-right text-zinc-800 hover:bg-zinc-100 py-1.5 px-1.5 rounded-md" onclick={()=>sidebarCollapsed.set(true)}>
					<Icon icon="ph:sidebar-simple-light" width="17" height="17" class="shrink-0" />
				</button>
			{/if}
			{#if !sideCollapsed}
				<span class="flex-1 truncate text-right text-[11px] text-zinc-300 mr-1.5">© {new Date().getFullYear()} Liatir</span>
			{/if}
		</div>
	</div>
</aside>
