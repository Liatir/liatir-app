// See https://svelte.dev/docs/kit/types#app.d.ts
import type { LiatirBrowserAPI } from '../../src-ts/liatir/_types';

declare global {
	namespace App {}

	interface Window {
		Liatir?: LiatirBrowserAPI;
	}
}

export {};
