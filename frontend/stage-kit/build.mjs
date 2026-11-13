/**
 * How the presentation runtime is bundled into one self-contained script: the single definition used
 * by the app build (vite.config.ts) and by the tests that draw pages in a real frame.
 *
 * @param {string} frontendDir Absolute path of `frontend/`.
 * @returns {import('esbuild').BuildOptions & { write: false, metafile: true }}
 */
export function stageRuntimeBuild(frontendDir) {
  return {
    entryPoints: ['stage-kit/index.tsx'], absWorkingDir: frontendDir, bundle: true, minify: true, write: false, metafile: true,
    format: 'iife', target: 'es2022', jsx: 'automatic', loader: { '.css': 'text' }, conditions: ['style'],
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  };
}
