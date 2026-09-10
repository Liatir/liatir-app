# Connecting a client to Local MCP

Decided while turning the MCP server from a feature that exists into one that
gets used. Settings showed a URL and a bearer token and stopped there, which
made the most distinctive thing in the product the one place that required its
user to be technical.

## Decision

**Settings ships one Connect panel that writes the client's configuration.** The
user picks their client, reads where the snippet goes, and copies it. The
snippet is generated from the live endpoint, so it is never stale, and the token
is masked on screen while the clipboard receives it in full — the user needs to
paste the secret, not read it.

The recipes live in `frontend/src/lib/mcp/clients.ts` as data, one entry per
client, so a client that changes its configuration format is a one-line
correction in one file. Each entry states in plain words where the snippet goes
and what the user must already have. Their exact shapes were read from each
vendor's own documentation rather than recalled, and
`tests/unit/mcp-client-recipes.test.ts` pins what each client actually cares
about: VS Code's `servers` key and required `type`, Cursor's `mcpServers` with
`url` and `headers`, the Claude Code CLI form, and that a masked snippet never
carries the real token.

Two client-specific facts are worth keeping written down, because both fail
silently rather than loudly:

- **Claude Desktop cannot speak HTTP to an MCP server.** It needs the
  `mcp-remote` stdio bridge through `npx`, which means Node.js must be present.
  The panel says so rather than producing a snippet that quietly does nothing.
- **Claude Desktop on Windows mangles a space inside an argument**, so the
  `Authorization` header value goes in `env` and the argument itself stays
  space-free. Written the obvious way, the token would be corrupted in transit
  with no error anywhere.

## What was rejected

**Per-assistant plugins — a "Claude plugin", a "ChatGPT plugin".** MCP is
already the integration; a plugin per vendor would be the same three facts
re-packaged four times and separately rotted. What was actually missing was not
code but the last step of the setup.

**Anything that would let a hosted assistant connect.** ChatGPT on the web, and
every other assistant running on someone else's servers, cannot reach Liatir:
the server binds to 127.0.0.1, so there is no route to it from outside this
computer. Making it work would mean exposing a server that can start
computations and read local scientific files to the internet — the invariant
this boundary exists to hold. The panel states the limit in the product rather
than leaving a user to discover it as a failure, and it is a limit, not a gap.

## Records

- [Controlled local MCP boundary](../truth/architecture/mcp.md) — the server
  these clients connect to.
- [MCP Data access controls](./mcp-data-access-controls.md) — what a connected
  client is allowed to read.
