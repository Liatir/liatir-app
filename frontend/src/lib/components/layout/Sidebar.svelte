<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import { workspaceStore, TEST_WORKSPACE_ID } from '$lib/stores/workspace.svelte';
	import { pipelineStore } from '$lib/stores/pipeline.svelte';
	import CustomIcon from '../ui/CustomIcon.svelte';
	import Divider from '../ui/Divider.svelte';

	interface NavItem {
		href?: string;
		label?: string;
		divider?: boolean;
		icon?: string;
		customIcon?: string;
		match?: string;
		global: boolean;
		workspacePage?: boolean;
	}

	const mainNav: NavItem[] = [
		{ href: '/workspaces', label: 'Workspaces', icon: 'lucide:layout-grid', match: "/workspaces", global: true, workspacePage: true },
		{ divider: true, global: true },
		{ href: '/', label: 'Dashboard', icon: 'lucide:house', match: undefined, global: false },
		{ href: '/data', label: 'Data', icon: 'lucide:database', match: '/data', global: false },
		{ href: '/pipelines', label: 'Pipelines', icon: 'lucide:workflow', match: '/pipelines', global: false },
		{ href: '/apis', label: 'API Connector', icon: 'lucide:plug', match: '/apis', global: false },
		{ href: '/results', label: 'Results', icon: 'lucide:inbox', match: '/results', global: false },
		{ href: '/jobs', label: 'Jobs', icon: 'lucide:radio', match: '/jobs', global: false },
		{ divider: true, global: false },
		{ href: '/tools', label: 'Tools', icon: 'lucide:dna', match: '/tools', global: true },
		{ href: '/modules', label: 'Modules', customIcon: '/icons/lia-file-icon.svg', match: '/modules', global: true },
		{ href: '/plugins', label: 'Plugins', customIcon: '/icons/web-assembly-file-icon.svg', match: '/plugins', global: true }
	];
	const bottomNav: NavItem[] = [
		{ divider: true, global: true },
		{ href: '/workspace-settings', label: 'Workspace', icon: 'lucide:folder-cog', match: '/workspace-settings', global: false },
		{ divider: true, global: false },
		{ href: '/deps', label: 'Dependencies', icon: 'lucide:replace', match: '/deps', global: true },
		{
			href: '/settings',
			label: 'Settings',
			icon: 'lucide:settings',
			match: '/settings',
			global: true
		},
		{ divider: true, global: true },
	];

	const advancedNav: NavItem[] = [
		{ href: '/scripts', label: 'Scripts', icon: 'lucide:code-2', match: '/scripts', global: true },
		{ href: '/code', label: 'Code Editor', icon: 'lucide:square-terminal', match: '/code', global: true }
	];

	let collapsed = $state(false);
	let advancedOpen = $state(false);
	let advancedBtnEl = $state<HTMLElement | null>(null);
	let floatingY = $state(0);
	let floatingFromBottom = $state(false);

	onMount(() => {
		collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
	});

	$effect(() => {
		localStorage.setItem('sidebar-collapsed', String(collapsed));
	});

	$effect(() => {
		const path = page.url.pathname;
		if (path.startsWith('/scripts') || path.startsWith('/code')) {
			advancedOpen = true;
		}
	});

	function isActive(item: NavItem): boolean {
		if (!item.href) return false;
		const path = page.url.pathname;
		if (item.href === '/') return path === '/';
		if (item.href === '/workspaces') return path === '/workspaces';
		return path.startsWith(item.match ?? item.href);
	}

	const advancedActive = $derived(
		advancedNav.some((i) => i.href && page.url.pathname.startsWith(i.match ?? i.href))
	);

	function togglePlayground() {
		if (collapsed) {
			if (advancedBtnEl) {
				const rect = advancedBtnEl.getBoundingClientRect();
				const PANEL_HEIGHT = 120;
				floatingFromBottom = rect.top + PANEL_HEIGHT > window.innerHeight;
				floatingY = floatingFromBottom ? window.innerHeight - rect.bottom : rect.top;
			}
			advancedOpen = !advancedOpen;
		} else {
			advancedOpen = !advancedOpen;
		}
	}

	function closeFloating() {
		advancedOpen = false;
	}

	async function navigateToPage(navItem: NavItem) {
		if(navItem?.workspacePage) {
			await workspaceStore.switchTo("");
			jobsStore.refresh();
			pipelineStore.init();
			goto(navItem.href);
		} else {
			goto(navItem.href);
		}
	};

	async function toggleTestMode() {
		if (!workspaceStore.isTestMode) {
			await workspaceStore.switchTo(TEST_WORKSPACE_ID);
			jobsStore.refresh();
			pipelineStore.init();
			goto('/');
		} else {
			await workspaceStore.switchTo("");
			jobsStore.refresh();
			pipelineStore.init();
			goto('/workspaces');
		}
	}
</script>

<!-- Click-outside backdrop for floating panel -->
{#if collapsed && advancedOpen}
	<div class="fixed inset-0 z-40" role="presentation" onclick={closeFloating}></div>
{/if}

<aside
	class="flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-all duration-200
	       {collapsed ? 'w-14' : 'w-55'}"
>
	<!-- Logo -->
	<div class="flex h-14 items-center border-b border-border px-3 gap-2.5 overflow-hidden">
		<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand shrink-0 p-1.5">
			<img src="/logo/png/logo-white.png" alt="Liatir" class="h-full w-full object-contain" />
		</div>

		{#if !collapsed}
			<div class="flex-1 min-w-0">
				{#if workspaceStore.active}
					<p class="text-[10px] text-zinc-400 truncate leading-none mt-0.5">Workspace:</p>
					{#if workspaceStore.isTestMode}
						<span class="text-[10px] font-medium bg-emerald-100 text-emerald-600 rounded px-1.5 py-1 leading-5">sandbox</span>
					{:else}
						<p class="text-sm font-semibold text-zinc-800 truncate leading-none mt-0.5">{workspaceStore.active.name}</p>
					{/if}
				{:else}
					<span class="text-md font-semibold tracking-tight text-zinc-900 whitespace-nowrap">Liatir</span>
				{/if}
			</div>
		{/if}

		<button
			onclick={() => (collapsed = !collapsed)}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-surface-2 hover:text-zinc-600 transition-colors
			       {collapsed ? 'mx-auto' : 'ml-auto'}"
		>
			<Icon
				icon="lucide:chevron-left"
				width="14"
				height="14"
				class="transition-transform duration-200 {collapsed ? 'rotate-180' : ''}"
			/>
		</button>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 overflow-y-auto px-1.5 py-3 space-y-0.5">
		{#each mainNav as item}
			{@const active = isActive(item)}
			{#if item?.global || (workspaceStore.activeId && page.route.id!="/workspaces")}
				{#if item?.divider}
					<Divider my={5}/>
				{:else}
					<button
						onclick={()=>navigateToPage(item as NavItem)}
						title={collapsed ? item.label : undefined}
						class="group relative flex w-full text-left items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
							{collapsed ? 'justify-center' : ''}
							{active
							? 'bg-brand/10 text-brand font-medium'
							: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
					>
						{#if item?.customIcon}
							<CustomIcon src={item.customIcon} class="w-[16px] h-[16px] opacity-60"/>
						{:else if item?.icon}
							<Icon icon={item.icon} width="16" height="16" class="shrink-0" />
						{/if}

						{#if !collapsed}
							<span class="flex-1">{item.label}</span>
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

	<!-- Bottom: playground + bottom nav -->
	<div class="px-1.5 py-3 space-y-0.5">
		<!-- Playground -->
		<div class="relative">
			<button
				bind:this={advancedBtnEl}
				onclick={togglePlayground}
				title={collapsed ? 'Playground' : undefined}
				class="w-full flex items-center text-left gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
				       {collapsed ? 'justify-center' : ''}
				       {advancedActive
					? 'bg-brand/10 text-brand font-medium'
					: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
			>
				<Icon icon="lucide:search-code" width="16" height="16" class="shrink-0" />
				{#if !collapsed}
					<span class="flex-1 text-left">SDK Playground</span>
					<Icon
						icon="lucide:chevron-right"
						width="13"
						height="13"
						class="shrink-0 transition-transform duration-150 {advancedOpen ? 'rotate-90' : ''}"
					/>
				{/if}
			</button>

		</div>

		<!-- Bottom nav -->
		{#each bottomNav as item}
			{@const active = isActive(item)}
			{#if item?.global || (workspaceStore.activeId && page.route.id!="/workspaces")}
				{#if item?.divider}
					<Divider my={5}/>
				{:else}
					<button
						onclick={()=>navigateToPage(item as NavItem)}
						title={collapsed ? item.label : undefined}
						class="group relative flex w-full text-left items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
							{collapsed ? 'justify-center' : ''}
							{active
							? 'bg-brand/10 text-brand font-medium'
							: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
					>

						{#if item?.customIcon}
							<CustomIcon src={item.customIcon} class="w-[16px] h-[16px] opacity-60"/>
						{:else if item?.icon}
							<Icon icon={item.icon} width="16" height="16" class="shrink-0" />
						{/if}

						{#if !collapsed}
							<span class="flex-1">{item.label}</span>
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
		
		<!-- Toggle Test Mode -->
		<button
			onclick={toggleTestMode}
			title={collapsed ? 'Toggle Test Mode' : undefined}
			class="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
					{collapsed ? 'justify-center' : ''} 
					text-emerald-600 hover:bg-emerald-50"
		>
			<Icon icon="lucide:flask-conical" width="16" height="16" class="shrink-0" />
			{#if !collapsed}
				<span class="flex-1 text-left">Test Mode</span>
				<span class="text-[10px] font-medium bg-emerald-100 text-emerald-600 rounded px-1 leading-5">{workspaceStore.isTestMode?'exit':''}</span>
			{/if}
		</button>
	</div>
</aside>

<!-- Floating Playground panel (collapsed sidebar only) -->
{#if advancedOpen}
	<div
		class="fixed z-50 rounded-xl border border-border bg-white shadow-xl py-1.5 min-w-44"
		style="left: 60px; {floatingFromBottom ? `bottom: ${floatingY}px` : `top: ${floatingY}px`};"
	>
		<p class="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
			Playground
		</p>
		{#each advancedNav as item}
			{@const active = isActive(item)}
			<button
				onclick={()=>{closeFloating(); navigateToPage(item as NavItem)}}
				class="flex items-center w-full text-left gap-3 px-3 py-2 text-sm transition-colors
				       {active
					? 'bg-brand/8 text-brand font-medium'
					: 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}"
			>
				<Icon icon={item.icon} width="15" height="15" class="shrink-0" />
				<span>{item.label}</span>
			</button>
		{/each}
	</div>
{/if}
