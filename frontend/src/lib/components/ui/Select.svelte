<script lang="ts" module>
	export interface SelectOption {
		value: string;
		label: string;
		description?: string;
		meta?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		value: string;
		options: SelectOption[];
		onchange: (value: string) => void;
		disabled?: boolean;
		class?: string;
		id?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		searchable?: boolean;
		buttonClass?: string;
		stopPropagation?: boolean;
	}

	let {
		value,
		options,
		onchange,
		disabled = false,
		class: className = '',
		id,
		placeholder = 'Select option',
		searchPlaceholder = 'Search...',
		emptyText = 'No options found',
		searchable = false,
		buttonClass = '',
		stopPropagation = false
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let triggerEl: HTMLButtonElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let menuStyle = $state('');

	const selected = $derived(options.find((option) => option.value === value));
	const showSearch = $derived(searchable || options.length > 7);
	const filteredOptions = $derived.by(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return options;

		return options.filter((option) => {
			const haystack = [option.label, option.description, option.meta, option.value]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return haystack.includes(normalizedQuery);
		});
	});

	function positionMenu() {
		if (!triggerEl) return;

		const rect = triggerEl.getBoundingClientRect();
		const availableBelow = window.innerHeight - rect.bottom - 12;
		const availableAbove = rect.top - 12;
		const maxHeight = Math.max(180, Math.min(320, Math.max(availableBelow, availableAbove)));
		const top =
			availableBelow >= 220 || availableBelow >= availableAbove
				? rect.bottom + 6
				: Math.max(12, rect.top - maxHeight - 6);

		menuStyle = [
			`left: ${Math.max(12, rect.left)}px`,
			`top: ${top}px`,
			`width: ${Math.max(180, rect.width)}px`,
			`max-height: ${maxHeight}px`
		].join('; ');
	}

	async function openMenu() {
		if (disabled) return;
		query = '';
		open = true;
		positionMenu();
		await tick();
		if (showSearch) searchEl?.focus();
	}

	function closeMenu() {
		open = false;
		query = '';
	}

	function toggleMenu(event?: MouseEvent) {
		if (stopPropagation) event?.stopPropagation();
		if (open) closeMenu();
		else void openMenu();
	}

	function choose(option: SelectOption) {
		if (option.disabled) return;
		onchange(option.value);
		closeMenu();
		triggerEl?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (stopPropagation) event.stopPropagation();
		if (disabled) return;

		if (event.key === 'Escape') {
			closeMenu();
			triggerEl?.focus();
			return;
		}

		if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) {
			event.preventDefault();
			void openMenu();
			return;
		}

		if (open && event.key === 'Enter') {
			event.preventDefault();
			const firstEnabled = filteredOptions.find((option) => !option.disabled);
			if (firstEnabled) choose(firstEnabled);
		}
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			closeMenu();
			triggerEl?.focus();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const firstEnabled = filteredOptions.find((option) => !option.disabled);
			if (firstEnabled) choose(firstEnabled);
		}
	}

	onMount(() => {
		const reposition = () => {
			if (open) positionMenu();
		};

		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);

		return () => {
			window.removeEventListener('resize', reposition);
			window.removeEventListener('scroll', reposition, true);
		};
	});
</script>

<div class={`relative ${className}`}>
	<button
		bind:this={triggerEl}
		type="button"
		{id}
		class={[
			'flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-neutral-800 shadow-sm transition hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400',
			buttonClass
		].join(' ')}
		aria-haspopup="listbox"
		aria-expanded={open}
		{disabled}
		onclick={toggleMenu}
		onkeydown={handleKeydown}
	>
		<span class="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
		<Icon
			icon="lucide:chevron-down"
			class={`h-4 w-4 shrink-0 text-neutral-400 transition ${open ? 'rotate-180' : ''}`}
		/>
	</button>
</div>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-[9998] cursor-default bg-transparent"
		aria-label="Close menu"
		onclick={closeMenu}
	></button>

	<div
		class="fixed z-[9999] flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
		style={menuStyle}
		role="listbox"
		tabindex="-1"
		onkeydown={handleKeydown}
	>
		{#if showSearch}
			<div class="border-b border-neutral-100 p-2">
				<div class="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2">
					<Icon icon="lucide:search" class="h-4 w-4 shrink-0 text-neutral-400" />
					<input
						bind:this={searchEl}
						bind:value={query}
						type="search"
						class="min-w-0 flex-1 bg-transparent py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
						placeholder={searchPlaceholder}
						onclick={(event) => event.stopPropagation()}
						onkeydown={handleSearchKeydown}
					/>
				</div>
			</div>
		{/if}

		<div class="min-h-0 flex-1 overflow-auto p-1">
			{#if filteredOptions.length === 0}
				<div class="px-3 py-2 text-sm text-neutral-500">{emptyText}</div>
			{:else}
				{#each filteredOptions as option (option.value)}
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
							option.value === value ? 'bg-violet-50 text-violet-700' : 'text-neutral-700 hover:bg-neutral-50',
							option.disabled ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''
						].join(' ')}
						role="option"
						aria-selected={option.value === value}
						disabled={option.disabled}
						onclick={() => choose(option)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{option.label}</span>
							{#if option.description}
								<span class="mt-0.5 block line-clamp-2 text-xs text-neutral-500">
									{option.description}
								</span>
							{/if}
						</span>
						{#if option.meta}
							<span class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
								{option.meta}
							</span>
						{/if}
						{#if option.value === value}
							<Icon icon="lucide:check" class="h-4 w-4 shrink-0 text-violet-600" />
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}
