import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "$lib/sidebarUtils";
import { writable } from "svelte/store";


export const sidebarWidth = writable<number>(SIDEBAR_COLLAPSED_WIDTH);

export const sidebarCollapsed = writable<boolean>(true);

sidebarCollapsed.subscribe((v)=>{
    if(v) sidebarWidth.set(SIDEBAR_COLLAPSED_WIDTH);
    else sidebarWidth.set(SIDEBAR_EXPANDED_WIDTH);
});