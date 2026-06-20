import { addCollection } from '@iconify/svelte';
import lucideData from '@iconify-json/lucide/icons.json';

// Preload all Lucide icons for offline use in Tauri
addCollection(lucideData as never);
