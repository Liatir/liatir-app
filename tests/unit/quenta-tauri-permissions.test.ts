/**
 * Guards against the single most common way to break a Tauri command: writing it, wiring it up, and forgetting
 * to grant it.
 *
 * A `lia_*` command that is not listed in `permissions/liatir-bridge.toml` is simply *denied* at runtime. It
 * compiles, it type-checks, and it fails only when a user actually clicks the thing — which for Quenta means
 * the assistant silently stops working.
 *
 * So this test reads the frontend runtime and the permission file as **text** and checks that every command the
 * code invokes is one the manifest allows. It is a static consistency check between two files that have no other
 * link, and it is what turns a runtime failure into a failing test.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string): string {
  return readFileSync(resolve(rootDir, rel), 'utf8');
}

describe('bridge command permissions', () => {
  /**
   * The Quenta checks below cover one feature. This covers the rule they are an instance of:
   * registering a command in `generate_handler!` is not granting it. A command that is registered
   * and not listed compiles, passes `cargo check`, and is refused at runtime with
   * "not allowed. Command not found" — which is only ever seen by someone clicking the button.
   * `lia_fs_reveal` shipped that way and cost an end-to-end run to find.
   */
  it('grants every bridge command that is registered', () => {
    const main = read('src-tauri/src/main.rs');
    const handler = main.slice(
      main.indexOf('tauri::generate_handler!['),
      main.indexOf('])', main.indexOf('tauri::generate_handler![')),
    );
    const registered = [...handler.matchAll(/^\s*(lia_\w+),/gm)].map((match) => match[1]);
    const allowed = new Set(
      [...read('src-tauri/permissions/liatir-bridge.toml').matchAll(/"([^"]+)"/g)]
        .map((match) => match[1]),
    );

    // A parse that silently matched nothing would make this test vacuously pass forever.
    expect(registered.length).toBeGreaterThan(100);
    expect(registered.filter((command) => !allowed.has(command))).toEqual([]);
  });
});

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
      'lia_quenta_ollama_chat_status',
      'lia_quenta_ollama_cancel_chat',
      'lia_quenta_ollama_forget_chat',
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
