import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
  ],

  server: {
    // Tauri punta a devUrl http://localhost:5173: se la porta è occupata,
    // fallire subito invece di ripiegare in silenzio su un'altra porta
    // (che farebbe caricare a Tauri il contenuto sbagliato).
    port: 5173,
    strictPort: true,
  },
});
