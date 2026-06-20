<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import OptionPicker from '$lib/components/ui/OptionPicker.svelte';
  import KeyValueTable from '$lib/components/ui/KeyValueTable.svelte';
  import { apiConnections, sendApiRequest } from '$lib/stores/apiConnections.svelte';
  import type { ApiConnection, ApiResponse, HttpMethod, BodyType, AuthType } from '$lib/types/api-connection';
  import { DEFAULT_CONNECTION } from '$lib/types/api-connection';

  // ── State ────────────────────────────────────────────────────────────────────
  let selectedId = $state<string | null>(null);
  let draft = $state<ApiConnection | null>(null);
  let response = $state<ApiResponse | null>(null);
  let sending = $state(false);
  let activeTab = $state<'params' | 'headers' | 'body' | 'auth'>('params');
  let activeResponseTab = $state<'body' | 'headers'>('body');
  let dirty = $state(false);

  const selected = $derived(selectedId ? apiConnections.byId(selectedId) : null);

  onMount(() => { apiConnections.init(); });

  // ── Draft management ─────────────────────────────────────────────────────────
  function newRequest() {
    const now = Date.now();
    draft = {
      ...DEFAULT_CONNECTION,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    selectedId = null;
    response = null;
    dirty = true;
  }

  function selectConnection(id: string) {
    if (dirty && draft) saveOrDiscard();
    selectedId = id;
    draft = { ...(apiConnections.byId(id)!) };
    response = null;
    dirty = false;
  }

  function saveOrDiscard() {
    dirty = false;
  }

  function patch(update: Partial<ApiConnection>) {
    if (!draft) return;
    draft = { ...draft, ...update };
    dirty = true;
  }

  async function saveRequest() {
    if (!draft) return;
    if (apiConnections.byId(draft.id)) {
      await apiConnections.update(draft);
    } else {
      await apiConnections.add(draft);
      selectedId = draft.id;
    }
    dirty = false;
  }

  async function deleteRequest(id: string) {
    await apiConnections.remove(id);
    if (selectedId === id) {
      selectedId = null;
      draft = null;
    }
  }

  async function send() {
    if (!draft?.url) return;
    sending = true;
    response = null;
    try {
      response = await sendApiRequest(draft);
    } catch (e) {
      response = { status: 0, statusText: String(e), headers: {}, body: '', durationMs: 0 };
    } finally {
      sending = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function statusClass(status: number): string {
    if (status >= 200 && status < 300) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (status >= 300 && status < 400) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (status >= 400 && status < 500) return 'text-amber-600 bg-amber-50 border-amber-200';
    if (status >= 500) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-zinc-600 bg-zinc-50 border-zinc-200';
  }

  function tryPrettyJson(raw: string): string {
    try { return JSON.stringify(JSON.parse(raw), null, 2); }
    catch { return raw; }
  }

  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
  const methodColor: Record<HttpMethod, string> = {
    GET: 'text-emerald-600', POST: 'text-blue-600', PUT: 'text-amber-600',
    PATCH: 'text-purple-600', DELETE: 'text-red-600', HEAD: 'text-zinc-500',
  };

  const methodGroups = [{ items: methods.map(m => ({ value: m, label: m })) }];
</script>

<div class="flex h-full overflow-hidden">

  <!-- Sidebar: saved requests -->
  <div class="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-zinc-600">Requests</span>
      <button
        onclick={newRequest}
        class="flex items-center gap-1 text-[11px] text-brand hover:text-brand/80 font-medium transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New
      </button>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if apiConnections.list.length === 0 && !dirty}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
          No requests yet.<br/>Click New to create one.
        </p>
      {:else}
        <!-- Draft (unsaved) -->
        {#if dirty && draft && !apiConnections.byId(draft.id)}
          <div class="group relative flex items-center px-3 py-2.5 bg-brand/8 border-l-2 border-brand">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-semibold {methodColor[draft.method]}">{draft.method}</span>
                <span class="text-xs text-zinc-600 truncate font-medium">{draft.name}</span>
              </div>
            </div>
            <span class="text-[9px] text-zinc-400 shrink-0">unsaved</span>
          </div>
        {/if}

        {#each apiConnections.list as conn (conn.id)}
          <div
            class="group relative flex items-center transition-colors
              {selectedId === conn.id ? 'bg-brand/8' : 'hover:bg-surface-2'}"
          >
            <button
              onclick={() => selectConnection(conn.id)}
              class="flex-1 text-left px-3 py-2.5 min-w-0"
            >
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-semibold shrink-0 {methodColor[conn.method]}">{conn.method}</span>
                <span class="text-xs truncate {selectedId === conn.id ? 'text-brand font-medium' : 'text-zinc-700'}">
                  {conn.name}
                </span>
              </div>
              {#if conn.url}
                <p class="text-[10px] text-zinc-400 truncate mt-0.5 pl-0">{conn.url}</p>
              {/if}
            </button>
            <button
              onclick={() => deleteRequest(conn.id)}
              class="opacity-0 group-hover:opacity-100 p-1.5 mr-1.5 shrink-0 text-zinc-400 hover:text-red-500 transition-all rounded"
              aria-label="Delete"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Main: request builder -->
  <div class="flex-1 flex flex-col overflow-hidden min-w-0">

    {#if !draft}
      <!-- Empty state -->
      <div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium text-zinc-700">No request selected</p>
          <p class="text-xs text-zinc-400 mt-1">Select a saved request or create a new one.</p>
        </div>
        <button onclick={newRequest} class="text-sm text-brand font-medium hover:underline">New Request →</button>
      </div>

    {:else}
      <PageHeader title={draft.name || 'New Request'} description="">
        {#snippet actions()}
          <div class="flex items-center gap-2">
            {#if dirty}
              <Button variant="ghost" size="sm" onclick={saveRequest}>Save</Button>
            {/if}
            <Button
              variant="primary"
              size="sm"
              loading={sending}
              disabled={!draft.url || sending}
              onclick={send}
            >
              Send
            </Button>
          </div>
        {/snippet}
      </PageHeader>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">

        <!-- Request name + method + URL -->
        <Card class="p-4 space-y-3">
          <input
            type="text"
            value={draft.name}
            oninput={(e) => patch({ name: (e.target as HTMLInputElement).value })}
            placeholder="Request name"
            class="w-full text-sm font-medium bg-transparent border-b border-transparent focus:border-zinc-200
                   text-zinc-800 placeholder:text-zinc-400 outline-none pb-1 transition-colors"
          />

          <div class="flex items-center gap-2">
            <!-- Method picker -->
            <div class="w-28 shrink-0">
              <OptionPicker
                value={draft.method}
                groups={methodGroups}
                placeholder="Method"
                onchange={(v) => patch({ method: v as HttpMethod })}
              />
            </div>

            <!-- URL input -->
            <input
              type="url"
              value={draft.url}
              oninput={(e) => patch({ url: (e.target as HTMLInputElement).value })}
              placeholder="https://api.example.com/endpoint"
              class="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm font-mono
                     text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand/30"
            />
          </div>
        </Card>

        <!-- Tabs: Params / Headers / Body / Auth -->
        <Card class="overflow-hidden">
          <div class="flex border-b border-border">
            {#each (['params', 'headers', 'body', 'auth'] as const) as tab}
              <button
                onclick={() => activeTab = tab}
                class="px-4 py-2.5 text-xs font-medium transition-colors capitalize
                  {activeTab === tab
                    ? 'text-brand border-b-2 border-brand -mb-px bg-white'
                    : 'text-zinc-500 hover:text-zinc-700'}"
              >
                {tab}
                {#if tab === 'params' && draft.params.filter(p => p.enabled && p.key).length > 0}
                  <span class="ml-1 text-[10px] bg-zinc-100 text-zinc-500 rounded px-1">
                    {draft.params.filter(p => p.enabled && p.key).length}
                  </span>
                {:else if tab === 'headers' && draft.headers.filter(h => h.enabled && h.key).length > 0}
                  <span class="ml-1 text-[10px] bg-zinc-100 text-zinc-500 rounded px-1">
                    {draft.headers.filter(h => h.enabled && h.key).length}
                  </span>
                {/if}
              </button>
            {/each}
          </div>

          <div class="p-4">
            {#if activeTab === 'params'}
              <KeyValueTable
                rows={draft.params}
                keyPlaceholder="Parameter"
                valuePlaceholder="Value"
                onchange={(rows) => patch({ params: rows })}
              />
            {:else if activeTab === 'headers'}
              <KeyValueTable
                rows={draft.headers}
                keyPlaceholder="Header"
                valuePlaceholder="Value"
                onchange={(rows) => patch({ headers: rows })}
              />
            {:else if activeTab === 'body'}
              <div class="space-y-3">
                <div class="flex gap-2">
                  {#each (['none', 'json', 'raw', 'form-data'] as BodyType[]) as bt}
                    <button
                      onclick={() => patch({ body: { ...draft!.body, type: bt } })}
                      class="px-2.5 py-1 rounded text-xs font-medium transition-colors
                        {draft.body.type === bt
                          ? 'bg-brand text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
                    >
                      {bt}
                    </button>
                  {/each}
                </div>
                {#if draft.body.type !== 'none'}
                  <textarea
                    value={draft.body.content}
                    oninput={(e) => patch({ body: { ...draft!.body, content: (e.target as HTMLTextAreaElement).value } })}
                    placeholder={draft.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Body content'}
                    rows={8}
                    class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs font-mono
                           text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand/30 resize-y"
                  ></textarea>
                {/if}
              </div>
            {:else if activeTab === 'auth'}
              <div class="space-y-3">
                <div class="flex gap-2">
                  {#each (['none', 'bearer', 'basic'] as AuthType[]) as at}
                    <button
                      onclick={() => patch({ auth: { ...draft!.auth, type: at } })}
                      class="px-2.5 py-1 rounded text-xs font-medium transition-colors
                        {draft.auth.type === at
                          ? 'bg-brand text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
                    >
                      {at}
                    </button>
                  {/each}
                </div>
                {#if draft.auth.type === 'bearer'}
                  <div>
                    <label class="text-xs text-zinc-500 mb-1 block">Token</label>
                    <input
                      type="text"
                      value={draft.auth.token ?? ''}
                      oninput={(e) => patch({ auth: { ...draft!.auth, token: (e.target as HTMLInputElement).value } })}
                      placeholder="Bearer token"
                      class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-mono
                             text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                {:else if draft.auth.type === 'basic'}
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="text-xs text-zinc-500 mb-1 block">Username</label>
                      <input
                        type="text"
                        value={draft.auth.username ?? ''}
                        oninput={(e) => patch({ auth: { ...draft!.auth, username: (e.target as HTMLInputElement).value } })}
                        class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm
                               focus:outline-none focus:ring-1 focus:ring-brand/30"
                      />
                    </div>
                    <div>
                      <label class="text-xs text-zinc-500 mb-1 block">Password</label>
                      <input
                        type="password"
                        value={draft.auth.password ?? ''}
                        oninput={(e) => patch({ auth: { ...draft!.auth, password: (e.target as HTMLInputElement).value } })}
                        class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm
                               focus:outline-none focus:ring-1 focus:ring-brand/30"
                      />
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </Card>

        <!-- Response -->
        {#if sending}
          <Card class="p-6 flex items-center justify-center gap-3">
            <svg class="animate-spin h-4 w-4 text-brand" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            <span class="text-sm text-zinc-500">Sending request…</span>
          </Card>

        {:else if response}
          <Card class="overflow-hidden">
            <!-- Response status bar -->
            <div class="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface">
              {#if response.status > 0}
                <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold {statusClass(response.status)}">
                  {response.status} {response.statusText}
                </span>
              {:else}
                <span class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                  Error
                </span>
              {/if}
              <span class="text-xs text-zinc-400">{response.durationMs}ms</span>
              <div class="ml-auto flex gap-2">
                {#each (['body', 'headers'] as const) as tab}
                  <button
                    onclick={() => activeResponseTab = tab}
                    class="text-xs font-medium transition-colors capitalize
                      {activeResponseTab === tab ? 'text-zinc-800' : 'text-zinc-400 hover:text-zinc-600'}"
                  >
                    {tab}
                  </button>
                {/each}
              </div>
            </div>

            <div class="p-0">
              {#if activeResponseTab === 'body'}
                <pre class="max-h-80 overflow-auto p-4 text-xs font-mono text-zinc-700 bg-zinc-950 text-emerald-300 leading-relaxed">{tryPrettyJson(response.body) || '(empty body)'}</pre>
              {:else}
                <div class="divide-y divide-border max-h-80 overflow-auto">
                  {#each Object.entries(response.headers) as [k, v]}
                    <div class="flex items-start gap-4 px-4 py-1.5">
                      <span class="text-xs font-mono text-zinc-500 shrink-0 w-48 truncate">{k}</span>
                      <span class="text-xs font-mono text-zinc-800 flex-1 break-all">{v}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </Card>
        {/if}

      </div>
    {/if}
  </div>
</div>
