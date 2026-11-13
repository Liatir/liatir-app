import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stageRuntimeBuild } from './stage-kit/build.mjs';

export default defineConfig({
  plugins: [
    {
      // React, the Stage kit (shadcn/ui, Liatir charts and the deck's elements) and Tailwind's in-page
      // compiler, as one self-contained script for the sandboxed presentation frame. Its SHA-256 identifies the runtime a
      // saved presentation was made with, so it is stored once and checked when read back.
      name: 'liatir-presentation-runtime',
      resolveId(id) { if (id === 'virtual:liatir-presentation-runtime') return '\0' + id; },
      load(id) {
        if (id !== '\0virtual:liatir-presentation-runtime') return;
        const root = fileURLToPath(new URL('./', import.meta.url));
        const result = buildSync(stageRuntimeBuild(root));
        // The kit's own files, so `npm run dev` rebuilds the runtime when one of them changes.
        for (const input of Object.keys(result.metafile.inputs)) {
          if (input.startsWith('stage-kit/')) this.addWatchFile?.(root + input);
        }
        const source = result.outputFiles[0].text;
        const runtimeId = createHash('sha256').update(source).digest('hex');
        return `export default ${JSON.stringify(source)};\nexport const runtimeId = ${JSON.stringify(runtimeId)};`;
      },
    },
    tailwindcss(),
    sveltekit(),
  ],

  server: {
    // Tauri points at devUrl http://localhost:38173 (conf-templates/tauri.conf.template.local.dev.json).
    // Fail at once if the port is taken instead of silently moving to another one, which would make
    // Tauri load the wrong content. Not Vite's default 5173: other tools (VS Code port forwarding,
    // other Vite projects) commonly hold it.
    port: 38173,
    strictPort: true,
    // Shared packages and the bundled study sources live beside the frontend.
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] },
  },
});
