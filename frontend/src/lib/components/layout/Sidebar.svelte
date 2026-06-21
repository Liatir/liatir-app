<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import CustomIcon from '../ui/CustomIcon.svelte';
	import Divider from '../ui/Divider.svelte';

	interface NavItem {
		href?: string;
		label?: string;
		divider?: boolean;
		icon?: string;
		customIcon?: string;
		match?: string;
	}

	const mainNav: NavItem[] = [
		{ href: '/workspaces', label: 'Workspaces', icon: 'lucide:layout-grid', match: "/workspaces" },
		{ divider: true },
		{ href: '/', label: 'Dashboard', icon: 'lucide:house', match: undefined },
		{ href: '/data', label: 'Data', icon: 'lucide:database', match: '/data' },
		{ href: '/pipelines', label: 'Pipelines', icon: 'lucide:workflow', match: '/pipelines' },
		{ href: '/apis', label: 'API Connector', icon: 'lucide:plug', match: '/apis' },
		{ href: '/results', label: 'Results', icon: 'lucide:inbox', match: '/results' },
		{ href: '/jobs', label: 'Jobs', icon: 'lucide:radio', match: '/jobs' },
		{ href: '/tools', label: 'Tools', icon: 'lucide:dna', match: '/tools' },
		{ href: '/modules', label: 'Modules', customIcon: '/icons/lia-file-icon.svg', match: '/modules' },
		{ href: '/plugins', label: 'Plugins', customIcon: '/icons/web-assembly-file-icon.svg', match: '/plugins' },
		{ divider: true }
	];
	const bottomNav: NavItem[] = [
		{ divider: true },
		{ href: '/deps', label: 'Dependencies', icon: 'lucide:replace', match: '/deps' },
		{
			href: '/settings',
			label: 'Settings',
			icon: 'lucide:settings',
			match: '/settings'
		}
	];

	const advancedNav: NavItem[] = [
		{ href: '/scripts', label: 'Scripts', icon: 'lucide:code-2', match: '/scripts' },
		{ href: '/code', label: 'Code Editor', icon: 'lucide:square-terminal', match: '/code' }
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
		const path = page.url.pathname;
		if (item.href === '/') return path === '/';
		return path.startsWith(item.match ?? item.href);
	}

	const advancedActive = $derived(
		advancedNav.some((i) => page.url.pathname.startsWith(i.match ?? i.href))
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
		<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shrink-0 p-1.5">
			<img src="/logo/png/logo-white.png" alt="Liatir" class="h-full w-full object-contain" />
		</div>

		{#if !collapsed}
			<span class="text-md font-semibold tracking-tight text-zinc-900 flex-1 whitespace-nowrap"
				>Liatir</span
			>
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
			{#if item?.divider}
				<Divider my={5}/>
			{:else}
				<a
					href={item.href}
					title={collapsed ? item.label : undefined}
					class="group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
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
				</a>
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
				class="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
				       {collapsed ? 'justify-center' : ''}
				       {advancedActive
					? 'bg-brand/10 text-brand font-medium'
					: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
			>
				<Icon icon="lucide:flask-conical" width="16" height="16" class="shrink-0" />
				{#if !collapsed}
					<span class="flex-1 text-left">Playground</span>
					<Icon
						icon="lucide:chevron-right"
						width="13"
						height="13"
						class="shrink-0 transition-transform duration-150 {advancedOpen ? 'rotate-90' : ''}"
					/>
				{/if}
			</button>

			<!-- Inline submenu -->
			{#if !collapsed && advancedOpen}
				<div class="mt-0.5 space-y-0.5">
					{#each advancedNav as item}
						{@const active = isActive(item)}
						<a
							href={item.href}
							class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100 pl-8
							       {active
								? 'bg-brand/10 text-brand font-medium'
								: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
						>
							<Icon icon={item.icon} width="15" height="15" class="shrink-0"/>
							<span>{item.label}</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Bottom nav -->
		{#each bottomNav as item}
			{@const active = isActive(item)}
			{#if item?.divider}
				<Divider my={5}/>
			{:else}
				<a
					href={item.href}
					title={collapsed ? item.label : undefined}
					class="group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
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
				</a>
			{/if}
		{/each}
	</div>
</aside>

<!-- Floating Playground panel (collapsed sidebar only) -->
{#if collapsed && advancedOpen}
	<div
		class="fixed z-50 rounded-xl border border-border bg-white shadow-xl py-1.5 min-w-44"
		style="left: 60px; {floatingFromBottom ? `bottom: ${floatingY}px` : `top: ${floatingY}px`};"
	>
		<p class="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
			Playground
		</p>
		{#each advancedNav as item}
			{@const active = isActive(item)}
			<a
				href={item.href}
				onclick={closeFloating}
				class="flex items-center gap-3 px-3 py-2 text-sm transition-colors
				       {active
					? 'bg-brand/8 text-brand font-medium'
					: 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}"
			>
				<Icon icon={item.icon} width="15" height="15" class="shrink-0" />
				<span>{item.label}</span>
			</a>
		{/each}
	</div>
{/if}
