/** Resolve the actual TypeScript export, including shared Python fragments. */
import { build } from 'esbuild';

export async function loadProductPythonScript(file, exportName) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  if (typeof module[exportName] !== 'string') throw new Error(`Missing Python script export: ${exportName}`);
  return module[exportName];
}
