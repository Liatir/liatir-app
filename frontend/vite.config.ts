import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    {
      name: 'liatir-presentation-runtime',
      resolveId(id) { if (id === 'virtual:liatir-presentation-runtime') return '\0' + id; },
      load(id) {
        if (id !== '\0virtual:liatir-presentation-runtime') return;
        const result = buildSync({ stdin: { contents: 'import * as core from "preact"; import * as hooks from "preact/hooks"; window.Preact = {...core, ...hooks};', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, minify: true, write: false, format: 'iife' });
        return `export default ${JSON.stringify(result.outputFiles[0].text)}`;
      },
    },
    tailwindcss(),
    sveltekit(),
  ],

  server: {
    // Tauri punta a devUrl http://localhost:5173: se la porta è occupata,
    // fallire subito invece di ripiegare in silenzio su un'altra porta
    // (che farebbe caricare a Tauri il contenuto sbagliato).
    port: 5173,
    strictPort: true,
    // Shared packages and the bundled study sources live beside the frontend.
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] },
  },
});
