/**
 * The connection snippets are pasted verbatim into another program's configuration, so a wrong
 * shape does not fail here — it fails silently in a client the user cannot debug. These tests pin
 * the parts each client actually cares about, and the rule that the secret shown on screen is not
 * the secret.
 */
import { describe, expect, it } from 'vitest';

import {
  LIATIR_MCP_SERVER_NAME,
  MCP_CLIENT_RECIPES,
  MCP_TOKEN_MASK,
} from '../../frontend/src/lib/mcp/clients';

const ENDPOINT = 'http://127.0.0.1:49152/mcp';
const TOKEN = 'a1'.repeat(32);

function recipe(id: string) {
  const found = MCP_CLIENT_RECIPES.find((entry) => entry.id === id);
  if (!found) throw new Error(`No MCP client recipe named "${id}"`);
  return found;
}

describe('MCP client connection recipes', () => {
  it('carries the live address and the exact bearer token into every client', () => {
    for (const entry of MCP_CLIENT_RECIPES) {
      const snippet = entry.build(ENDPOINT, TOKEN);
      expect(snippet, entry.id).toContain(ENDPOINT);
      expect(snippet, entry.id).toContain(TOKEN);
      expect(snippet, entry.id).toContain('Bearer');
    }
  });

  it('produces configuration a client can actually parse', () => {
    for (const entry of MCP_CLIENT_RECIPES.filter((candidate) => candidate.language === 'json')) {
      expect(() => JSON.parse(entry.build(ENDPOINT, TOKEN)), entry.id).not.toThrow();
    }
  });

  it('keeps the configuration shape each client actually expects', () => {
    // VS Code is the odd one out twice: `servers`, not `mcpServers`, and it launches the address as
    // a program unless `type` says otherwise.
    const vscode = JSON.parse(recipe('vscode').build(ENDPOINT, TOKEN));
    expect(vscode.servers[LIATIR_MCP_SERVER_NAME].type).toBe('http');
    expect(vscode.mcpServers).toBeUndefined();

    const cursor = JSON.parse(recipe('cursor').build(ENDPOINT, TOKEN));
    expect(cursor.mcpServers[LIATIR_MCP_SERVER_NAME].url).toBe(ENDPOINT);
    expect(cursor.mcpServers[LIATIR_MCP_SERVER_NAME].headers.Authorization).toBe(`Bearer ${TOKEN}`);

    expect(recipe('claude-code').build(ENDPOINT, TOKEN)).toContain('claude mcp add --transport http');
  });

  it('keeps the Claude Desktop token out of the argument list', () => {
    // Claude Desktop on Windows mangles a space inside an argument, which would corrupt the token
    // without saying so. The header value belongs in `env`, and the argument must stay space-free.
    const config = JSON.parse(recipe('claude-desktop').build(ENDPOINT, TOKEN));
    const server = config.mcpServers[LIATIR_MCP_SERVER_NAME];
    const headerArgument = server.args[server.args.indexOf('--header') + 1];
    expect(headerArgument).not.toContain(' ');
    expect(headerArgument).not.toContain(TOKEN);
    expect(server.env.LIATIR_MCP_TOKEN).toBe(`Bearer ${TOKEN}`);
    expect(server.args).toContain('http-only');
  });

  it('never shows the real token when the page is masking it', () => {
    for (const entry of MCP_CLIENT_RECIPES) {
      const masked = entry.build(ENDPOINT, MCP_TOKEN_MASK);
      expect(masked, entry.id).not.toContain(TOKEN);
      expect(masked, entry.id).toContain(MCP_TOKEN_MASK);
      // A mask that is as long as the secret tells the room how long the secret is.
      expect(MCP_TOKEN_MASK.length).toBeLessThan(TOKEN.length);
    }
  });
});
