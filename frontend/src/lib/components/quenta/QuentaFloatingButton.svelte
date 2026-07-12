<!--
	The floating "Ask Quenta" affordance.

	Quenta is marked `hidden` in the sidebar, so it has no nav entry — it is reached from here instead,
	which keeps the assistant within reach on every screen without adding another item to the navigation.
	The button still reuses the sidebar's own definition (icon, label, href), so the two cannot drift.

	The condition below is where the rules live: it appears only inside a workspace (Quenta answers
	questions *about* a workspace's runs and data, so it is meaningless without one), and never on the
	Workspaces page or on the Quenta page itself.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { HEADER_HEIGHT } from '$lib/_constants';
	import { getSidebarItemsFromHref, sidebarNavigateToPage } from '$lib/sidebarUtils';
	import type { SidebarItem } from '$lib/sidebarUtils';
	import { sidebarWidth } from '$lib/stores/sidebar';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import CustomIcon from '../ui/CustomIcon.svelte';

	let quentaSidebarItem: SidebarItem;

	onMount(() => {
		quentaSidebarItem = getSidebarItemsFromHref('/quenta');
	});
</script>

{#if workspaceStore.activeId && page.route.id != '/workspaces' && quentaSidebarItem && page.route.id != '/quenta'}
	<div class="absolute" style="top: {HEADER_HEIGHT+15}px; right: {workspaceStore.isSandboxMode?20:15}px;">
		<button
			onclick={() => sidebarNavigateToPage(quentaSidebarItem as SidebarItem)}
			data-testid="sidebar-nav-item"
			data-route={quentaSidebarItem.href}
			class="group relative flex w-full overflow-hidden text-left group-hover:justify-center items-center gap-0 
             rounded-lg px-2.5 py-2 text-sm bg-white border border-border text-zinc-600 hover:text-brand"
		>

            {#if quentaSidebarItem?.customIcon}
                <CustomIcon src={quentaSidebarItem.customIcon} class="w-[18px] h-[18px]"/>
            {:else if quentaSidebarItem?.icon}
			    <Icon icon={quentaSidebarItem.icon as string} width="18" height="18" class="shrink-0" />
            {/if}

			<span class="hidden group-hover:flex flex-1 truncate text-sm"
				>{quentaSidebarItem.label}</span
			>
		</button>
	</div>
{/if}
