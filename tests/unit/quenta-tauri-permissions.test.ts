import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Quenta Tauri permissions', () => {
  it('allows every Quenta Ollama command invoked by the frontend runtime', () => {
    const runtimeSource = readFileSync(
      resolve(rootDir, 'frontend/src/lib/quenta/runtime-ollama.ts'),
      'utf8',
    );
    const permissionSource = readFileSync(
      resolve(rootDir, 'src-tauri/permissions/liatir-bridge.toml'),
      'utf8',
    );

    const invokedCommands = [...runtimeSource.matchAll(/invoke\('([^']+)'/g)]
      .map((match) => match[1])
      .filter((command) => command.startsWith('lia_quenta_ollama_'));
    const allowedCommands = new Set(
      [...permissionSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    );

    expect(invokedCommands).toEqual([
      'lia_quenta_ollama_status',
      'lia_quenta_ollama_models',
      'lia_quenta_ollama_bootstrap',
      'lia_quenta_ollama_chat',
      'lia_quenta_ollama_cancel_chat',
      'lia_quenta_ollama_embed',
    ]);
    expect(invokedCommands.filter((command) => !allowedCommands.has(command))).toEqual([]);
  });

  it('allows the serialized Quenta conversation storage command', () => {
    const storeSource = readFileSync(
      resolve(rootDir, 'frontend/src/lib/stores/quenta.svelte.ts'),
      'utf8',
    );
    const permissionSource = readFileSync(
      resolve(rootDir, 'src-tauri/permissions/liatir-bridge.toml'),
      'utf8',
    );

    expect(storeSource).toContain("invoke('lia_quenta_conversations_compare_and_swap'");
    expect(permissionSource).toContain('"lia_quenta_conversations_compare_and_swap"');
  });
});
