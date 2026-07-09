import { page } from "$app/state";

export const SIDEBAR_EXPANDED_WIDTH: number = 200;
export const SIDEBAR_COLLAPSED_WIDTH: number = 62;

export interface NavItem {
    href?: string;
    label?: string;
    divider?: boolean;
    icon?: string;
    customIcon?: string;
    match?: string;
    global: boolean;
    workspacePage?: boolean;
}

export const NAV_PAGES: NavItem[] = [
    { href: '/', label: 'Dashboard', icon: 'lucide:house', match: undefined, global: false },
    { href: '/pipelines', label: 'Pipelines', icon: 'lucide:workflow', match: '/pipelines', global: false },
    { divider: true, global: false },
    { href: '/tools', label: 'Tools', icon: 'lucide:dna', match: '/tools', global: true },
    { href: '/plugins', label: 'Plugins', customIcon: '/icons/lia-file-icon.svg', match: '/plugins', global: true },
    { href: '/apis', label: 'API Connector', icon: 'lucide:plug', match: '/apis', global: false },
    { href: '/ai', label: 'AI Models', icon: 'mingcute:ai-line', match: '/ai', global: true },
    { href: '/quenta', label: 'Quenta', icon: 'lucide:scroll-text', match: '/quenta', global: false },
    { divider: true, global: true },
    { href: '/data', label: 'Data', icon: 'lucide:database', match: '/data', global: false },
    { href: '/results', label: 'Results', icon: 'lucide:inbox', match: '/results', global: false },
    { href: '/jobs', label: 'Jobs', icon: 'lucide:radio', match: '/jobs', global: false },
];

export const NAV_PAGES_BOTTOM: NavItem[] = [
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
];

export const routeIsInSidebar = (route: string, onlyTop?: boolean): boolean => {
    let pages: NavItem[];
    if(onlyTop) pages = NAV_PAGES;
    else pages = [...NAV_PAGES, ...NAV_PAGES_BOTTOM];

    const routes: string[] = [];

    pages.forEach(page => {
        const hrefRoute: string = ((page?.href) ?? "").trim().replace("/","");
        if(hrefRoute && !routes.includes(hrefRoute)) routes.push(hrefRoute);
    });

    const r = (route??"").trim().replace("/","");

    return routes?.includes(r);
}
