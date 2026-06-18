// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
	namespace App {}

	interface Window {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		Liatir: any;
	}
}

export {};
