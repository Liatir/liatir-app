<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { apiConnections, sendApiRequest } from '$lib/stores/apiConnections.svelte';
  import type { ApiRequest, ApiResponse, ApiKeyValue, HttpMethod } from '$lib/types/api-connection';

  // ── State ─────────────────────────────────────────────────────────────────
  let activeRequestId = $state<string | null>(null);
  let draft = $state<ApiRequest | null>(null);
  let response = $state<ApiResponse | null>(null);
  let sending = $state(false);
  let responseTab = $state<'body' | 'headers'>('body');
  let requestTab = $state<'params' | 'headers' | 'body' | 'auth'>('params');

  // Use string[] for explicit reactivity (reassignment, not mutation)
  let expandedIds = $state<string[]>([]);
  let editingCollectionId = $state<string | null>(null);
  let editingCollectionName = $state('');
  let newCollectionName = $state('');
  let showNewCollection = $state(false);

  const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const METHOD_COLORS: Record<HttpMethod, string> = {
    GET:     'text-emerald-600',
    POST:    'text-blue-600',
    PUT:     'text-amber-600',
    PATCH:   'text-violet-600',
    DELETE:  'text-red-600',
    HEAD:    'text-zinc-500',
    OPTIONS: 'text-zinc-500',
  };

  onMount(() => { apiConnections.init(); });

  // ── Expanded set helpers ──────────────────────────────────────────────────
  function isExpanded(id: string) { return expandedIds.includes(id); }
  function toggleExpanded(id: string) {
    expandedIds = isExpanded(id) ? expandedIds.filter(x => x !== id) : [...expandedIds, id];
  }
  function ensureExpanded(id: string) {
    if (!isExpanded(id)) expandedIds = [...expandedIds, id];
  }

  // ── Draft management ──────────────────────────────────────────────────────
  function selectRequest(id: string) {
    const req = apiConnections.requestById(id);
    if (!req) return;
    activeRequestId = id;
    draft = JSON.parse(JSON.stringify(req)) as ApiRequest;
    response = null;
    responseTab = 'body';
    requestTab = 'params';
  }

  async function saveRequest() {
    if (!draft) return;
    await apiConnections.updateRequest(draft);
  }

  async function send() {
    if (!draft || sending) return;
    await saveRequest();
    sending = true;
    response = null;
    try {
      response = await sendApiRequest(draft);
      responseTab = 'body';
    } finally {
      sending = false;
    }
  }

  // ── Collection actions ────────────────────────────────────────────────────
  async function createCollection() {
    const name = newCollectionName.trim() || 'New Collection';
    const col = await apiConnections.addCollection(name);
    ensureExpanded(col.id);
    newCollectionName = '';
    showNewCollection = false;
  }

  async function deleteCollection(id: string) {
    if (activeRequestId && apiConnections.requestById(activeRequestId)?.collectionId === id) {
      activeRequestId = null;
      draft = null;
    }
    await apiConnections.deleteCollection(id);
  }

  async function createRequest(collectionId: string) {
    ensureExpanded(collectionId); // expand immediately (before persist)
    const req = await apiConnections.addRequest(collectionId);
    selectRequest(req.id);
  }

  async function deleteRequest(id: string) {
    if (activeRequestId === id) { activeRequestId = null; draft = null; }
    await apiConnections.deleteRequest(id);
  }

  // ── Key-value helpers ─────────────────────────────────────────────────────
  function addKv(arr: ApiKeyValue[]) { arr.push({ key: '', value: '', enabled: true }); }
  function removeKv(arr: ApiKeyValue[], i: number) { arr.splice(i, 1); }

  // ── Response helpers ──────────────────────────────────────────────────────
  function formatBody(body: string): string {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  }

  function statusClass(status: number): string {
    if (status < 300) return 'bg-emerald-100 text-emerald-800';
    if (status < 400) return 'bg-amber-100 text-amber-800';
    return 'bg-red-100 text-red-800';
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="API Connector" description="Create and send HTTP requests" />

  <div class="flex flex-1 overflow-hidden">

    <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
    <div class="w-60 shrink-0 border-r border-border flex flex-col overflow-hidden bg-surface">
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Collections</span>
        <button
          onclick={() => showNewCollection = !showNewCollection}
          class="h-5 w-5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          title="New collection"
        >
          <Icon icon="lucide:plus" width="11" height="11" />
        </button>
      </div>

      {#if showNewCollection}
        <div class="px-2 py-2 border-b border-border flex gap-1.5">
          <input
            type="text"
            bind:value={newCollectionName}
            placeholder="Collection name"
            autofocus
            onkeydown={(e) => { if (e.key === 'Enter') createCollection(); if (e.key === 'Escape') showNewCollection = false; }}
            class="flex-1 text-xs border border-border rounded px-2 py-1 bg-white outline-none focus:border-brand/60"
          />
          <button onclick={createCollection} class="text-xs bg-brand text-white rounded px-2 py-1 hover:bg-brand/90">Add</button>
        </div>
      {/if}

      <div class="flex-1 overflow-y-auto">
        {#each apiConnections.collections as col (col.id)}
          {@const reqs = apiConnections.requestsInCollection(col.id)}
          {@const expanded = isExpanded(col.id)}
          {@const editing = editingCollectionId === col.id}
          <div>
            <!-- Collection header -->
            <div
              class="group flex items-center gap-1 px-2 py-1.5 hover:bg-zinc-100/70 cursor-pointer"
              role="button"
              tabindex="0"
              onclick={() => !editing && toggleExpanded(col.id)}
              onkeydown={(e) => !editing && e.key === 'Enter' && toggleExpanded(col.id)}
            >
              <Icon
                icon="lucide:chevron-right"
                width="10"
                height="10"
                class="shrink-0 transition-transform text-zinc-400 {expanded ? 'rotate-90' : ''}"
              />

              {#if editing}
                <!-- Edit mode: input takes full width, no action buttons -->
                <input
                  type="text"
                  bind:value={editingCollectionName}
                  class="flex-1 min-w-0 text-xs bg-white border border-brand/40 rounded px-1 outline-none"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { apiConnections.renameCollection(col.id, editingCollectionName); editingCollectionId = null; }
                    if (e.key === 'Escape') { editingCollectionId = null; }
                  }}
                  autofocus
                />
                <button
                  onclick={(e) => { e.stopPropagation(); apiConnections.renameCollection(col.id, editingCollectionName); editingCollectionId = null; }}
                  class="shrink-0 text-[10px] text-brand hover:text-brand/80 px-1"
                >
                  OK
                </button>
              {:else}
                <span class="flex-1 min-w-0 text-xs font-medium text-zinc-700 truncate">{col.name}</span>
                <!-- Action buttons — only shown when NOT editing -->
                <div class="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    onclick={(e) => { e.stopPropagation(); createRequest(col.id); }}
                    class="h-5 w-5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200"
                    title="Add request"
                  >
                    <Icon icon="lucide:plus" width="9" height="9" />
                  </button>
                  <button
                    onclick={(e) => { e.stopPropagation(); editingCollectionId = col.id; editingCollectionName = col.name; }}
                    class="h-5 w-5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200"
                    title="Rename"
                  >
                    <Icon icon="lucide:pencil" width="9" height="9" />
                  </button>
                  <button
                    onclick={(e) => { e.stopPropagation(); deleteCollection(col.id); }}
                    class="h-5 w-5 rounded flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-zinc-200"
                    title="Delete collection"
                  >
                    <Icon icon="lucide:trash-2" width="9" height="9" />
                  </button>
                </div>
              {/if}
            </div>

            <!-- Requests under collection -->
            {#if expanded}
              {#each reqs as req (req.id)}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => selectRequest(req.id)}
                  onkeydown={(e) => e.key === 'Enter' && selectRequest(req.id)}
                  class="w-full flex items-center gap-2 pl-6 pr-2 py-1.5 cursor-pointer hover:bg-zinc-100/70 transition-colors
                         {activeRequestId === req.id ? 'bg-brand/8 border-r-2 border-brand' : ''} group"
                >
                  <span class="text-[10px] font-bold font-mono shrink-0 w-9 {METHOD_COLORS[req.method]}">{req.method}</span>
                  <span class="flex-1 text-xs text-zinc-700 truncate">{req.name}</span>
                  <button
                    onclick={(e) => { e.stopPropagation(); deleteRequest(req.id); }}
                    class="hidden group-hover:flex h-4 w-4 items-center justify-center text-zinc-400 hover:text-red-500 shrink-0"
                    title="Delete request"
                  >
                    <Icon icon="lucide:x" width="9" height="9" />
                  </button>
                </div>
              {/each}
              {#if reqs.length === 0}
                <button
                  onclick={() => createRequest(col.id)}
                  class="w-full pl-6 py-1.5 text-left text-xs text-zinc-400 hover:text-brand hover:bg-zinc-50 italic"
                >
                  + New request
                </button>
              {/if}
            {/if}
          </div>
        {/each}

        {#if apiConnections.collections.length === 0}
          <div class="px-4 py-8 text-center">
            <p class="text-xs text-zinc-400">No collections yet.</p>
            <button onclick={() => showNewCollection = true} class="text-xs text-brand hover:underline mt-1">Create one</button>
          </div>
        {/if}
      </div>
    </div>

    <!-- ── Main panel ────────────────────────────────────────────────────── -->
    {#if draft}
      <div class="flex-1 flex flex-col overflow-hidden">

        <!-- Request name + save bar -->
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <input
            type="text"
            bind:value={draft.name}
            onblur={saveRequest}
            class="flex-1 text-sm font-medium text-zinc-800 bg-transparent outline-none border-b border-transparent focus:border-brand/40 pb-0.5 transition-colors"
            placeholder="Request name"
          />
          <button onclick={saveRequest} class="text-xs text-zinc-400 hover:text-zinc-700 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-100">
            Save
          </button>
        </div>

        <!-- URL bar -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <select
            bind:value={draft.method}
            class="text-xs font-bold font-mono border border-border rounded px-2 py-1.5 bg-white outline-none focus:border-brand/60 cursor-pointer {METHOD_COLORS[draft.method]}"
          >
            {#each METHODS as m}
              <option value={m} class={METHOD_COLORS[m]}>{m}</option>
            {/each}
          </select>
          <input
            type="text"
            bind:value={draft.url}
            placeholder="https://api.example.com/endpoint"
            class="flex-1 text-sm border border-border rounded px-3 py-1.5 bg-white outline-none focus:border-brand/60 font-mono"
          />
          <Button variant="primary" size="sm" loading={sending} onclick={send} disabled={!draft.url}>
            <Icon icon="lucide:send" width="12" height="12" />
            Send
          </Button>
        </div>

        <!-- Request tabs -->
        <div class="flex border-b border-border px-4 shrink-0 bg-surface">
          {#each ['params', 'headers', 'body', 'auth'] as tab}
            <button
              onclick={() => requestTab = tab as typeof requestTab}
              class="text-xs px-3 py-2 border-b-2 transition-colors {requestTab === tab
                ? 'border-brand text-brand font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'}"
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {#if tab === 'params' && draft.params.filter(p => p.enabled && p.key).length > 0}
                <span class="ml-1 text-[10px] bg-brand/10 text-brand rounded-full px-1.5">{draft.params.filter(p => p.enabled && p.key).length}</span>
              {:else if tab === 'headers' && draft.headers.filter(h => h.enabled && h.key).length > 0}
                <span class="ml-1 text-[10px] bg-brand/10 text-brand rounded-full px-1.5">{draft.headers.filter(h => h.enabled && h.key).length}</span>
              {/if}
            </button>
          {/each}
        </div>

        <!-- Tab content -->
        <div class="flex-1 overflow-y-auto min-h-0">

          {#if requestTab === 'params' || requestTab === 'headers'}
            {@const arr = requestTab === 'params' ? draft.params : draft.headers}
            <div class="p-4">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-zinc-400 border-b border-border">
                    <th class="w-5 pb-1.5 text-left font-normal"></th>
                    <th class="pb-1.5 text-left font-normal pl-2">Key</th>
                    <th class="pb-1.5 text-left font-normal pl-2">Value</th>
                    <th class="w-6 pb-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each arr as kv, i (i)}
                    <tr class="group">
                      <td class="py-1"><input type="checkbox" bind:checked={kv.enabled} class="accent-brand" /></td>
                      <td class="py-1 pl-2">
                        <input type="text" bind:value={kv.key} placeholder="key"
                          class="w-full border border-transparent rounded px-1.5 py-0.5 bg-transparent focus:bg-white focus:border-border outline-none font-mono" />
                      </td>
                      <td class="py-1 pl-2">
                        <input type="text" bind:value={kv.value} placeholder="value"
                          class="w-full border border-transparent rounded px-1.5 py-0.5 bg-transparent focus:bg-white focus:border-border outline-none font-mono" />
                      </td>
                      <td class="py-1">
                        <button onclick={() => removeKv(arr, i)}
                          class="hidden group-hover:flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-red-500 rounded">
                          <Icon icon="lucide:x" width="10" height="10" />
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <button onclick={() => addKv(arr)} class="mt-2 flex items-center gap-1 text-xs text-zinc-400 hover:text-brand transition-colors">
                <Icon icon="lucide:plus" width="10" height="10" />
                Add row
              </button>
            </div>

          {:else if requestTab === 'body'}
            <div class="p-4 flex flex-col gap-3">
              <div class="flex gap-3 items-center">
                <span class="text-xs text-zinc-500">Type:</span>
                {#each ['none', 'json', 'raw', 'form-data'] as bt}
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="body-type" value={bt} bind:group={draft.body.type} class="accent-brand" />
                    <span class="text-xs text-zinc-700">{bt}</span>
                  </label>
                {/each}
              </div>
              {#if draft.body.type !== 'none'}
                <textarea
                  bind:value={draft.body.content}
                  rows={12}
                  placeholder={draft.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Request body…'}
                  class="w-full border border-border rounded-lg px-3 py-2.5 text-xs font-mono bg-white outline-none focus:border-brand/60 resize-y"
                ></textarea>
              {/if}
            </div>

          {:else if requestTab === 'auth'}
            <div class="p-4 flex flex-col gap-4">
              <div class="flex gap-3 items-center flex-wrap">
                <span class="text-xs text-zinc-500">Auth type:</span>
                {#each ['none', 'bearer', 'basic', 'api-key'] as at}
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="auth-type" value={at} bind:group={draft.auth.type} class="accent-brand" />
                    <span class="text-xs text-zinc-700">{at}</span>
                  </label>
                {/each}
              </div>
              {#if draft.auth.type === 'bearer'}
                <div class="flex flex-col gap-1">
                  <label class="text-xs text-zinc-500">Token</label>
                  <input type="text" bind:value={draft.auth.token} placeholder="Bearer token"
                    class="border border-border rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-brand/60" />
                </div>
              {:else if draft.auth.type === 'basic'}
                <div class="flex gap-3">
                  <div class="flex flex-col gap-1 flex-1">
                    <label class="text-xs text-zinc-500">Username</label>
                    <input type="text" bind:value={draft.auth.username}
                      class="border border-border rounded px-3 py-1.5 text-sm outline-none focus:border-brand/60" />
                  </div>
                  <div class="flex flex-col gap-1 flex-1">
                    <label class="text-xs text-zinc-500">Password</label>
                    <input type="password" bind:value={draft.auth.password}
                      class="border border-border rounded px-3 py-1.5 text-sm outline-none focus:border-brand/60" />
                  </div>
                </div>
              {:else if draft.auth.type === 'api-key'}
                <div class="flex gap-3">
                  <div class="flex flex-col gap-1 flex-1">
                    <label class="text-xs text-zinc-500">Header name</label>
                    <input type="text" bind:value={draft.auth.apiKeyHeader} placeholder="X-API-Key"
                      class="border border-border rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-brand/60" />
                  </div>
                  <div class="flex flex-col gap-1 flex-1">
                    <label class="text-xs text-zinc-500">Value</label>
                    <input type="text" bind:value={draft.auth.apiKeyValue}
                      class="border border-border rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-brand/60" />
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- ── Response panel ──────────────────────────────────────────── -->
        {#if response || sending}
          <div class="border-t border-border flex flex-col" style="height: 40%;">
            <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface shrink-0">
              {#if response}
                <span class="text-xs font-bold px-2 py-0.5 rounded {statusClass(response.status)}">
                  {response.status} {response.statusText}
                </span>
                <span class="text-xs text-zinc-400">{response.durationMs}ms</span>
                <span class="text-xs text-zinc-400">{new Blob([response.body]).size} B</span>
                <div class="ml-auto flex">
                  {#each ['body', 'headers'] as tab}
                    <button
                      onclick={() => responseTab = tab as 'body' | 'headers'}
                      class="text-xs px-3 py-1 rounded transition-colors {responseTab === tab
                        ? 'bg-white border border-border text-zinc-800 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700'}"
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  {/each}
                </div>
              {:else}
                <span class="text-xs text-zinc-400">Sending…</span>
              {/if}
            </div>

            <div class="flex-1 overflow-auto">
              {#if response}
                {#if responseTab === 'body'}
                  <pre class="text-xs font-mono p-4 text-zinc-800 whitespace-pre-wrap break-all leading-relaxed">{formatBody(response.body)}</pre>
                {:else}
                  <table class="w-full text-xs">
                    <tbody>
                      {#each Object.entries(response.headers) as [k, v]}
                        <tr class="border-b border-border/50">
                          <td class="px-4 py-1.5 font-mono font-medium text-zinc-600 w-1/3">{k}</td>
                          <td class="px-4 py-1.5 font-mono text-zinc-800 break-all">{v}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              {/if}
            </div>
          </div>
        {/if}

      </div>
    {:else}
      <div class="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <div class="h-14 w-14 rounded-2xl bg-white border border-border shadow-sm flex items-center justify-center">
          <Icon icon="lucide:link" width="22" height="22" class="text-zinc-300" />
        </div>
        <div>
          <p class="text-sm font-medium text-zinc-600">No request selected</p>
          <p class="text-xs text-zinc-400 mt-1">Create a collection and a request to get started.</p>
        </div>
        <Button variant="secondary" size="sm" onclick={() => showNewCollection = true}>New Collection</Button>
      </div>
    {/if}

  </div>
</div>
