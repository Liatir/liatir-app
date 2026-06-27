import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({
			// Where to put the final static build
			pages: 'dist',  // <- qui decidi la cartella finale
			assets: 'dist',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		// Shared internal package — aliased here so both Vite (bundling) and
		// svelte-check (type-checking) resolve it without an npm workspace.
		alias: {
			'@liatir/core': '../packages/liatir-core/src',
			'@liatir/core/*': '../packages/liatir-core/src/*',
			'@liatir/output-parser': '../packages/liatir-output-parser/src',
			'@liatir/output-parser/*': '../packages/liatir-output-parser/src/*'
		}
	}
};

export default config;
