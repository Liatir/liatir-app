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
    divider?: boolean;
    icon?: string;
    customIcon?: string;
    match?: string;
    global: boolean;
    workspacePage?: boolean;
    hidden?: boolean;
}

const NAV_PAGES = [
    { href: '/', label: 'Dashboard', icon: 'lucide:house', match: undefined, global: false },
    { href: '/pipelines', label: 'Pipelines', icon: 'lucide:workflow', match: '/pipelines', global: false },
    { divider: true, global: false },
    { href: '/tools', label: 'Tools', icon: 'lucide:dna', match: '/tools', global: true },
    { href: '/plugins', label: 'Plugins', customIcon: '/icons/lia-file-icon.svg', match: '/plugins', global: true },
    { href: '/apis', label: 'API Connector', icon: 'lucide:plug', match: '/apis', global: false },
    { href: '/ai', label: 'AI Models', icon: 'ri:ai-generate-3d-line', match: '/ai', global: true },
    { divider: true, global: true },
    { href: '/data', label: 'Data', icon: 'lucide:database', match: '/data', global: false },
    { href: '/results', label: 'Results', icon: 'lucide:inbox', match: '/results', global: false },
    { href: '/jobs', label: 'Jobs', icon: 'lucide:radio', match: '/jobs', global: false },
    { href: '/quenta', label: 'Ask Quenta', icon: 'mingcute:quill-pen-ai-line', match: '/quenta', global: false, hidden: true},
] as const satisfies readonly SidebarItem[];

const NAV_PAGES_BOTTOM = [
    { href: '/deps', label: 'Dependencies', icon: 'lucide:replace', match: '/deps', global: true },
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

export type NavStructure = (typeof ALL_NAV_PAGES)[number];
export type NavHref = Extract<NavStructure, { href: unknown }>['href'];

export const SIDEBAR_ITEMS: readonly SidebarItem[] = ALL_NAV_PAGES;
export const SIDEBAR_ITEMS_TOP: readonly SidebarItem[] = NAV_PAGES;
export const SIDEBAR_ITEMS_BOTTOM: readonly SidebarItem[] = NAV_PAGES_BOTTOM;

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


export async function sidebarNavigateToPage(sidebarItem: SidebarItem) {
		if(sidebarItem?.workspacePage) {
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