/**
 * The app's navigation structure.
 *
 * The one field that carries real meaning here is `global`. Liatir's data is organised into
 * workspaces, and most pages show *this workspace's* content — its pipelines, its data, its results.
 * A `global: true` page is one that does not belong to any workspace: the AI Models installed on the
 * machine, the dependencies on the system, the app's own settings. Marking that distinction here is
 * what lets the shell keep the two apart rather than each page having to know.
 */
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { jobsStore } from "./stores/jobs.svelte";
import { pipelineStore } from "./stores/pipeline.svelte";
import { workspaceStore } from "./stores/workspace.svelte";

export const SIDEBAR_EXPANDED_WIDTH: number = 200;
export const SIDEBAR_COLLAPSED_WIDTH: number = 62;

export interface SidebarItem {
    href?: string;
    label?: string;
    /** A separator, not a link: it has no href and renders as a rule. */
    divider?: boolean;
    icon?: string;
    /** An SVG path, for icons the icon set does not provide (e.g. the `.lia` plugin mark). */
    customIcon?: string;
    customIconDark?: string;
    /** Prefix used to decide whether this item is the active one for the current route. */
    match?: string;
    /** True when the page is not scoped to a workspace — see the note at the top of this file. */
    global: boolean;
    /** Navigating here *leaves* the current workspace. Only the Workspaces page does this. */
    workspacePage?: boolean;
    /** Reachable by route but not listed in the sidebar (Quenta is opened from context, not the nav). */
    hidden?: boolean;
}

const NAV_PAGES = [
    { href: '/', label: 'Dashboard', icon: 'lucide:house', match: undefined, global: false },
    { href: '/pipelines', label: 'Pipelines', icon: 'lucide:workflow', match: '/pipelines', global: false },
    { divider: true, global: false },
    { href: '/tools', label: 'Tools', icon: 'lucide:dna', match: '/tools', global: true },
    { href: '/plugins', label: 'Plugins', customIcon: '/icons/lia-file-icon/light.svg', customIconDark: '/icons/lia-file-icon/dark.svg', match: '/plugins', global: true },
    { href: '/apis', label: 'API Connector', icon: 'lucide:plug', match: '/apis', global: false },
    { href: '/ai', label: 'AI Models', icon: 'ri:ai-generate-3d-line', match: '/ai', global: true },
    { divider: true, global: true },
    { href: '/data', label: 'Data', icon: 'lucide:database', match: '/data', global: false },
    { href: '/results', label: 'Results', icon: 'lucide:inbox', match: '/results', global: false },
    { href: '/jobs', label: 'Jobs', icon: 'lucide:radio', match: '/jobs', global: false },
    { divider: true, global: true },
    { href: '/quenta', label: 'Ask Quenta', icon: 'lucide:sparkles', match: '/quenta', global: false},
] as const satisfies readonly SidebarItem[];

const NAV_PAGES_BOTTOM = [
    { href: '/deps', label: 'Dependencies', icon: 'lucide:replace', match: '/deps', global: true, hidden: true },
    {
        href: '/settings',
        label: 'App Settings',
        icon: 'lucide:settings',
        match: '/settings',
        global: true
    },
    { divider: true, global: true },
    { href: '/workspaces', label: 'Workspaces', icon: 'lucide:layout-grid', match: "/workspaces", global: true, workspacePage: true },
] as const satisfies readonly SidebarItem[];

const ALL_NAV_PAGES = [...NAV_PAGES, ...NAV_PAGES_BOTTOM] as const satisfies readonly SidebarItem[];

// `as const satisfies` above does double duty: `satisfies` checks each entry against SidebarItem,
// while `as const` keeps the literal types — which is what makes NavHref below a union of the actual
// routes rather than plain `string`. A typo in a link is then a compile error, not a dead click.
export type NavStructure = (typeof ALL_NAV_PAGES)[number];
/** The union of real hrefs. `Extract` drops the dividers, which have no href. */
export type NavHref = Extract<NavStructure, { href: unknown }>['href'];

export const SIDEBAR_ITEMS: readonly SidebarItem[] = ALL_NAV_PAGES;
export const SIDEBAR_ITEMS_TOP: readonly SidebarItem[] = NAV_PAGES;
export const SIDEBAR_ITEMS_BOTTOM: readonly SidebarItem[] = NAV_PAGES_BOTTOM;

/** Whether a route corresponds to a sidebar entry. Compared without the leading slash on both sides. */
export const routeIsInSidebar = (route: string, onlyTop?: boolean): boolean => {
    let pages;
    if(onlyTop) pages = SIDEBAR_ITEMS_TOP;
    else pages = SIDEBAR_ITEMS;

    const routes: string[] = [];

    pages.forEach(page => {
        const hrefRoute: string = ((page?.href) ?? "").trim().replace("/","");
        if(hrefRoute && !routes.includes(hrefRoute)) routes.push(hrefRoute);
    });

    const r = (route??"").trim().replace("/","");

    return routes?.includes(r);
}


/**
 * Navigates from the sidebar.
 *
 * The `workspacePage` branch is the reason this is not a plain `goto`. Opening the Workspaces page
 * means *leaving* the current workspace, so the workspace is exited first (which clears every
 * workspace-scoped store — see `workspace-reset.ts`) and the global views are refreshed. Navigating
 * there without that would leave the previous workspace's jobs and pipelines on screen.
 */
export async function sidebarNavigateToPage(sidebarItem: SidebarItem) {
		if(sidebarItem?.workspacePage) {
			// Empty ID = no active workspace.
			await workspaceStore.switchTo("");
			jobsStore.refresh();
			pipelineStore.init();
			if(sidebarItem?.href) goto(sidebarItem.href);
		} else {
			if(sidebarItem?.href) goto(sidebarItem.href);
		}
	};


export function getSidebarItemsFromHref(href: NavHref): SidebarItem {
		const sidebarItem = SIDEBAR_ITEMS.find((item)=>item.href===href);
        return sidebarItem as SidebarItem;
	};