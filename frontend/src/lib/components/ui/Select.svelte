<!--
	The shared dropdown, used everywhere a choice is offered.

	A custom listbox rather than a native `<select>`, because a native one can only show a flat list of
	strings. The choices here need to *explain themselves* — an AI Model needs its description and size
	beside its name, a tool needs its category — and long lists (models, tools, files) need a search box.
	None of that is possible in a native select.

	Two behaviours make it safe to use inside a pipeline node on the canvas, which is the awkward case:
	`stopPropagation` keeps a click on the dropdown from dragging the node underneath it, and the
	`nowheel` class on the menu keeps scrolling the list from zooming the canvas.
-->
<script lang="ts" module>
	export interface SelectOption {
		value: string;
		label: string;
		/** Shown under the label — this is what makes the list self-explanatory. */
		description?: string;
		/** A short badge (a size, a status, a category). */
		meta?: string;
		/** Listed but unselectable, so the user sees an option exists and that it is unavailable. */
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '@iconify/svelte';
	import { clickOutside } from '$lib/actions/clickOutside';

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
		/** Forces the search box on. It also appears automatically past 7 options — see `showSearch`. */
		searchable?: boolean;
		buttonClass?: string;
		textSize?: 'xs' | 'sm' | 'md' | 'lg' | string,
		/** Set when rendered inside a draggable canvas node: stops clicks from reaching the node. */
		stopPropagation?: boolean;
	}

	let {
		value,
		options,
		onchange,
		disabled = false,
		class: className = '',
		textSize='xs',
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
	// Computed when the menu opens, not fixed — see positionMenu().
	let menuPlacement = $state<'below' | 'above'>('below');
	let menuMaxHeight = $state(280);

	const selected = $derived(options.find((option) => option.value === value));
	// Past a handful of options, scanning the list stops being viable, so search appears on its own.
	const showSearch = $derived(searchable || options.length > 7);
	const filteredOptions = $derived.by(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return options;

		return options.filter((option) => {
			// Searches the description and meta too, not just the label: a user hunting for a model is as
			// likely to type "single-cell" (its description) as its actual name.
			const haystack = [option.label, option.description, option.meta, option.value]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return haystack.includes(normalizedQuery);
		});
	});

	/**
	 * Decides whether the menu opens downwards or upwards, and how tall it may be.
	 *
	 * A dropdown near the bottom of the window would otherwise open off-screen. It prefers below unless
	 * there is genuinely more room above, and the height is clamped so the menu never overflows the
	 * viewport (but is never uselessly short either).
	 */
	function positionMenu() {
		if (!triggerEl) return;

		const rect = triggerEl.getBoundingClientRect();
		const availableBelow = window.innerHeight - rect.bottom - 12;
		const availableAbove = rect.top - 12;
		// Below wins if it has a comfortable 220px, or if it simply has more room than above.
		menuPlacement = availableBelow >= 220 || availableBelow >= availableAbove ? 'below' : 'above';
		const available = menuPlacement === 'below' ? availableBelow : availableAbove;
		menuMaxHeight = Math.max(160, Math.min(320, available));
	}

	async function openMenu() {
		if (disabled) return;
		// Always open with an empty search: a leftover query from last time would hide most options and
		// look like they had disappeared.
		query = '';
		open = true;
		positionMenu();
		// The search input does not exist until the menu has rendered, hence the tick before focusing.
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
		// Focus returns to the trigger, so keyboard navigation continues from where it left off rather
		// than jumping back to the top of the page.
		triggerEl?.focus();
	}

	/** Keyboard support on the trigger: Escape closes, Enter/Space/Down opens, Enter picks. */
	function handleKeydown(event: KeyboardEvent) {
		if (stopPropagation) event.stopPropagation();
		if (disabled) return;

		if (event.key === 'Escape') {
			closeMenu();
			triggerEl?.focus();
			return;
		}

		if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) {
			// preventDefault stops Space from scrolling the page.
			event.preventDefault();
			void openMenu();
			return;
		}

		// Enter selects the first *selectable* match — so typing a query and pressing Enter picks the
		// obvious result, and a disabled option is never chosen by accident.
		if (open && event.key === 'Enter') {
			event.preventDefault();
			const firstEnabled = filteredOptions.find((option) => !option.disabled);
			if (firstEnabled) choose(firstEnabled);
		}
	}

	/**
	 * The search box handles its own keys. Always stops propagation, so typing (including Escape and
	 * Enter) is not also interpreted by the trigger's handler above.
	 */
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
</script>

<!-- clickOutside is only armed while open, so it costs nothing when the menu is closed. -->
<div class={`relative min-w-0 max-w-full ${className}`} use:clickOutside={{ enabled: open, onOutside: closeMenu }}>
	<!-- The trigger. aria-haspopup/aria-expanded make it a real listbox to a screen reader. -->
	<button
		bind:this={triggerEl}
		type="button"
		{id}
		class={[
			`flex min-w-0 max-w-full w-full items-center justify-between gap-2 overflow-hidden rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-${textSize} text-text shadow-sm transition hover:border-border-2 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-subtle`,
			buttonClass
		].join(' ')}
		aria-haspopup="listbox"
		aria-expanded={open}
		title={selected?.label ?? placeholder}
		{disabled}
		onclick={toggleMenu}
		onkeydown={handleKeydown}
	>
		<span class="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
		<Icon
			icon="lucide:chevron-down"
			class={`h-4 w-4 shrink-0 text-text-subtle transition ${open ? 'rotate-180' : ''}`}
		/>
	</button>

	{#if open}
		<!--
			`nowheel` tells the pipeline canvas not to treat a scroll here as a zoom, so the option list
			scrolls normally when this Select sits inside a node. The very high z-index keeps the menu
			above the canvas and any surrounding panels.
		-->
		<div
			class={[
				'nowheel absolute left-0 right-0 z-[9999] flex min-w-fit max-w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl',
				menuPlacement === 'above' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
			].join(' ')}
			style={`max-height: ${menuMaxHeight}px`}
			role="listbox"
			tabindex="-1"
			onkeydown={handleKeydown}
		>
			{#if showSearch}
				<div class="border-b border-border p-2">
					<div class="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2">
						<Icon icon="lucide:search" class="h-4 w-4 shrink-0 text-text-subtle" />
						<input
							bind:this={searchEl}
							bind:value={query}
							type="search"
							class="min-w-0 flex-1 bg-transparent py-1.5 {`text-${textSize}`} text-text outline-none placeholder:text-text-subtle"
							placeholder={searchPlaceholder}
							onclick={(event) => event.stopPropagation()}
							onkeydown={handleSearchKeydown}
						/>
					</div>
				</div>
			{/if}

			<div class="min-h-0 flex-1 overflow-auto p-1">
				{#if filteredOptions.length === 0}
					<div class="px-3 py-1.5 text-sm text-text-muted">{emptyText}</div>
				{:else}
					{#each filteredOptions as option (option.value)}
						<button
							type="button"
							class={[
								`flex min-w-0 w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-1.5 text-left text-${textSize} transition`,
								option.value === value ? 'bg-violet-50 text-violet-700' : 'text-text-secondary hover:bg-surface-2',
								option.disabled ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''
							].join(' ')}
							role="option"
							data-value={option.value}
							aria-selected={option.value === value}
							disabled={option.disabled}
							onclick={() => choose(option)}
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">{option.label}</span>
								{#if option.description}
									<span class="mt-0.5 block line-clamp-2 text-xs text-text-muted">
										{option.description}
									</span>
								{/if}
							</span>
							{#if option.meta}
								<span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
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
</div>
