<!--
	Ready-to-paste connection settings for a local MCP client.

	Before this panel the screen handed the user a URL and a token and left the rest to them, which is
	the one place in Liatir that quietly required its user to be technical. The snippet is generated
	from the live endpoint, so it is always the current one.
-->
<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import { liatir } from '$lib/api';
  import { MCP_CLIENT_RECIPES, MCP_TOKEN_MASK } from '$lib/mcp/clients';

  interface Props {
    endpoint: string;
    token: string;
    /** Follows the page's own Show/Hide control, so one choice governs the secret everywhere. */
    revealToken?: boolean;
  }

  let { endpoint, token, revealToken = false }: Props = $props();

  let selectedId = $state(MCP_CLIENT_RECIPES[0].id);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const recipe = $derived(
    MCP_CLIENT_RECIPES.find((entry) => entry.id === selectedId) ?? MCP_CLIENT_RECIPES[0],
  );
  const snippet = $derived(recipe.build(endpoint, revealToken ? token : MCP_TOKEN_MASK));

  async function copySnippet() {
    const api = liatir();
    if (!api) return;
    // Always copy the real token: the mask keeps the secret off the screen, not out of the clipboard.
    await api.desktop.clipboard.writeText(recipe.build(endpoint, token));
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied = false; }, 1800);
  }
</script>

<div class="space-y-2" data-testid="mcp-connect-panel">
  <div class="flex items-center justify-between gap-3">
    <p class="text-[11px] font-medium text-text-muted">Connect a client</p>
    <Button
      size="sm"
      variant="secondary"
      testId="mcp-connect-copy"
      onclick={() => void copySnippet()}
    >{copied ? 'Copied' : 'Copy'}</Button>
  </div>

  <div class="flex flex-wrap gap-1.5">
    {#each MCP_CLIENT_RECIPES as entry (entry.id)}
      <button
        type="button"
        data-testid={`mcp-connect-client-${entry.id}`}
        aria-pressed={selectedId === entry.id}
        onclick={() => { selectedId = entry.id; copied = false; }}
        class="rounded-lg border px-2.5 py-1 text-[11px] transition-colors
               {selectedId === entry.id
                 ? 'border-brand/40 bg-brand/10 text-text-secondary'
                 : 'border-border text-text-muted hover:bg-surface'}"
      >{entry.label}</button>
    {/each}
  </div>

  <p class="text-[11px] text-text-subtle" data-testid="mcp-connect-destination">{recipe.destination}</p>
  {#if recipe.requires}
    <p class="text-[11px] text-amber-500">Needs {recipe.requires}</p>
  {/if}

  <pre class="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono
              text-[11px] leading-relaxed text-text-secondary"
       data-testid="mcp-connect-snippet">{snippet}</pre>

  <p class="text-[11px] leading-relaxed text-text-subtle">
    Only a client on this computer can connect. An assistant that runs on someone else's servers, such as ChatGPT on the web, has no way to reach Liatir, and that is deliberate. The address also changes each time Liatir restarts, so copy this again after a restart.
  </p>
</div>
