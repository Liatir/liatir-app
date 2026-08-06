// See https://svelte.dev/docs/kit/types#app.d.ts
import type { LiatirBrowserAPI } from '../../src-ts/liatir/_types';

// The Plotly runtime imported as a raw string, to inline it into exported reports (offline-safe).
declare module 'plotly.js-dist-min/plotly.min.js?raw' {
	const source: string;
	export default source;
}

declare global {
	namespace App {}

	interface Window {
		Liatir?: LiatirBrowserAPI;
	}
}

export {};
