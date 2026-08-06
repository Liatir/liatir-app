/**
 * Sidebar open/closed state and its rendered width.
 *
 * The width is derived from the collapsed flag rather than set by callers: keeping it as a separate
 * store means layout code can bind to a number (for CSS and transitions) while the rest of the app
 * only ever toggles a boolean, so the two can never disagree.
 */
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "$lib/sidebarUtils";
import { writable } from "svelte/store";


export const sidebarWidth = writable<number>(SIDEBAR_COLLAPSED_WIDTH);

export const sidebarCollapsed = writable<boolean>(true);

// The one place width is assigned — it always follows the collapsed flag.
sidebarCollapsed.subscribe((v)=>{
    if(v) sidebarWidth.set(SIDEBAR_COLLAPSED_WIDTH);
    else sidebarWidth.set(SIDEBAR_EXPANDED_WIDTH);
});