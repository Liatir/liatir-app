<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { jobsStore } from '$lib/stores/jobs.svelte';

	interface NavItem {
		href: string;
		label: string;
		match?: string;
	}

	const mainNav: NavItem[] = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/data', label: 'Data', match: '/data' },
		{ href: '/tools', label: 'Tools', match: '/tools' },
		{ href: '/modules', label: 'Modules', match: '/modules' },
		{ href: '/pipeline', label: 'Pipeline', match: '/pipeline' },
		{ href: '/apis', label: 'API Connector', match: '/apis' },
		{ href: '/results', label: 'Results', match: '/results' },
		{ href: '/jobs', label: 'Jobs', match: '/jobs' },
		{ href: '/deps', label: 'Dependencies', match: '/deps' }
	];

	const advancedNav: NavItem[] = [
		{ href: '/scripts', label: 'Scripts', match: '/scripts' },
		{ href: '/code', label: 'Code Editor', match: '/code' }
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
				const PANEL_HEIGHT = 120; // approx: header + 2 items
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
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="transition-transform duration-200 {collapsed ? 'rotate-180' : ''}"
			>
				<polyline points="15 18 9 12 15 6" />
			</svg>
		</button>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 overflow-y-auto px-1.5 py-3 space-y-0.5">
		{#each mainNav as item}
			{@const active = isActive(item)}
			<a
				href={item.href}
				title={collapsed ? item.label : undefined}
				class="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100
          {collapsed ? 'justify-center' : ''}
          {active
					? 'bg-brand/10 text-brand font-medium'
					: 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-800'}"
			>
				{#if item.href === '/'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						<polyline points="9 22 9 12 15 12 15 22" />
					</svg>
				{:else if item.match === '/data'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
						<polyline points="13 2 13 9 20 9" />
					</svg>
				{:else if item.match === '/tools'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.07 4.93a10 10 0 0 1 0 14.14M16.24 7.76a6 6 0 0 1 0 8.49M4.93 4.93a10 10 0 0 0 0 14.14M7.76 7.76a6 6 0 0 0 0 8.49"
						/>
					</svg>
				{:else if item.match === '/modules'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
						/>
						<polyline points="7.5 4.21 12 6.81 16.5 4.21" />
						<polyline points="7.5 19.79 7.5 14.6 3 12" />
						<polyline points="21 12 16.5 14.6 16.5 19.79" />
						<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
						<line x1="12" y1="22.08" x2="12" y2="12" />
					</svg>
				{:else if item.match === '/pipeline'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="5" y1="12" x2="19" y2="12" />
						<circle cx="5" cy="12" r="2" /><circle cx="12" cy="7" r="2" /><circle
							cx="19"
							cy="12"
							r="2"
						/><circle cx="12" cy="17" r="2" />
						<line x1="12" y1="9" x2="12" y2="10" /><line x1="12" y1="14" x2="12" y2="15" />
						<line x1="7" y1="12" x2="10" y2="12" /><line x1="14" y1="12" x2="17" y2="12" />
					</svg>
				{:else if item.match === '/apis'}
					<svg xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						class="shrink-0"
						width="16"
						height="16"
						fill="none">
						<path d="M0 0h24v24H0z" fill="none" />
						<g fill="none" stroke="currentColor" stroke-width="1.5">
							<path
								d="M17.854 12.16c-.383.45-1.09.454-1.537.007l-4.484-4.483c-.447-.447-.444-1.155.007-1.538l1.231-1.047a6.5 6.5 0 0 1 3.133-1.448l.725-.122c.685-.116 1.405.123 1.919.637l.986.987c.514.513.753 1.233.637 1.918l-.122.725a6.5 6.5 0 0 1-1.448 3.133z"
							/>
							<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 4.5l2-2m-19 19l2-2" />
							<path
								d="M6.146 11.84c.383-.45 1.09-.454 1.538-.007l4.483 4.484c.447.446.444 1.154-.007 1.537l-1.231 1.047a6.5 6.5 0 0 1-3.133 1.448l-.725.122c-.685.116-1.405-.123-1.918-.637l-.987-.986c-.514-.514-.753-1.234-.637-1.919l.122-.725a6.5 6.5 0 0 1 1.448-3.133z"
							/>
							<path stroke-linecap="round" stroke-linejoin="round" d="m8.5 12.5l2-2m1 5l2-2" />
						</g>
					</svg>
				{:else if item.match === '/results'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
					</svg>
				{:else if item.match === '/jobs'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<polyline points="12 6 12 12 16 14" />
					</svg>
				{:else if item.match === '/deps'}
					<svg
						class="shrink-0"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
						/>
						<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
						<line x1="12" y1="22.08" x2="12" y2="12" />
					</svg>
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
		{/each}
	</nav>

	<!-- Bottom: Playground + Settings -->
	<div class="border-t border-border px-1.5 py-3 space-y-0.5">
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
				<svg
					class="shrink-0"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polygon points="12 2 2 7 12 12 22 7 12 2" />
					<polyline points="2 17 12 22 22 17" />
					<polyline points="2 12 12 17 22 12" />
				</svg>

				{#if !collapsed}
					<span class="flex-1 text-left">Playground</span>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="shrink-0 transition-transform duration-150 {advancedOpen ? 'rotate-90' : ''}"
					>
						<polyline points="9 18 15 12 9 6" />
					</svg>
				{/if}
			</button>

			<!-- Inline submenu (expanded sidebar) -->
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
							{#if item.match === '/scripts'}
								<svg
									class="shrink-0"
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
								</svg>
							{:else if item.match === '/code'}
								<svg
									class="shrink-0"
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
									<line x1="3" y1="9" x2="21" y2="9" />
									<line x1="9" y1="21" x2="9" y2="9" />
								</svg>
							{/if}
							<span>{item.label}</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Settings -->
		<div>
			<a
				href="/settings"
				title={collapsed ? 'Settings' : undefined}
				class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-zinc-500
             hover:bg-surface-2 hover:text-zinc-800 transition-colors duration-100
             {collapsed ? 'justify-center' : ''}
             {page.url.pathname === '/settings' ? 'bg-brand/10 text-brand font-medium' : ''}"
			>
				<svg
					class="shrink-0"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="3" />
					<path
						d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
					/>
				</svg>
				{#if !collapsed}
					<span>Settings</span>
				{/if}
			</a>
		</div>
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
				{#if item.match === '/scripts'}
					<svg
						class="shrink-0"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
					</svg>
				{:else if item.match === '/code'}
					<svg
						class="shrink-0"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
						<line x1="3" y1="9" x2="21" y2="9" />
						<line x1="9" y1="21" x2="9" y2="9" />
					</svg>
				{/if}
				<span>{item.label}</span>
			</a>
		{/each}
	</div>
{/if}
