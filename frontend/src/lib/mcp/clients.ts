/**
 * Ready-to-paste configuration for the MCP clients that can reach Liatir.
 *
 * Every client here runs on the same computer as Liatir, and that is the whole list there can be:
 * the server binds to 127.0.0.1, so an assistant hosted on someone else's servers has no route to
 * it at all. That is a deliberate boundary rather than a missing integration, and the panel says so
 * instead of leaving the user to discover it by failing.
 *
 * Each recipe is data, not markup, so a client that changes its configuration format is a one-line
 * correction here and nowhere else.
 */

/** The name Liatir gives itself in a client's configuration. */
export const LIATIR_MCP_SERVER_NAME = 'liatir';

export interface McpClientRecipe {
  id: string;
  label: string;
  /** Where the snippet goes, named the way the client itself names it. */
  destination: string;
  /** What the user must already have for this to work, in plain words. `null` when nothing. */
  requires: string | null;
  language: 'shell' | 'json' | 'text';
  build(endpoint: string, token: string): string;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const MCP_CLIENT_RECIPES: McpClientRecipe[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    destination: 'Run this once in a terminal.',
    requires: null,
    language: 'shell',
    build: (endpoint, token) =>
      `claude mcp add --transport http ${LIATIR_MCP_SERVER_NAME} ${endpoint} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    destination: 'Settings → Developer → Edit Config, in claude_desktop_config.json',
    requires: 'Node.js. Claude Desktop cannot speak to a local web address by itself, so a small bridge does it.',
    language: 'json',
    build: (endpoint, token) => json({
      mcpServers: {
        [LIATIR_MCP_SERVER_NAME]: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            endpoint,
            '--transport',
            'http-only',
            // The header value lives in `env` because Claude Desktop on Windows mangles a space
            // inside an argument, which would silently corrupt the token.
            '--header',
            'Authorization:${LIATIR_MCP_TOKEN}',
          ],
          env: { LIATIR_MCP_TOKEN: `Bearer ${token}` },
        },
      },
    }),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    destination: 'Settings → MCP, or ~/.cursor/mcp.json',
    requires: null,
    language: 'json',
    build: (endpoint, token) => json({
      mcpServers: {
        [LIATIR_MCP_SERVER_NAME]: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    // VS Code is the odd one out twice over: the key is `servers`, not `mcpServers`, and without
    // `type` it treats the address as a program to launch.
    destination: '.vscode/mcp.json in your project',
    requires: null,
    language: 'json',
    build: (endpoint, token) => json({
      servers: {
        [LIATIR_MCP_SERVER_NAME]: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
  },
  {
    id: 'other',
    label: 'Another client',
    destination: 'Whatever the client calls its server settings.',
    requires: null,
    language: 'text',
    build: (endpoint, token) =>
      `Transport: Streamable HTTP\nURL: ${endpoint}\nHeader: Authorization: Bearer ${token}`,
  },
];

/**
 * A stand-in for the token, so a snippet can be read on screen without showing the secret.
 *
 * The user never needs to read the token — they need to paste it — so the panel copies the real
 * value while displaying this one. The length is fixed rather than derived from the token, because
 * a mask that reveals the secret's length is a mask that leaks.
 */
export const MCP_TOKEN_MASK = '•'.repeat(16);
