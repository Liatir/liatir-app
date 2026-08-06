<script lang="ts">
  import Icon from '@iconify/svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import KeyValueTable from '$lib/components/ui/KeyValueTable.svelte';
  import ApiParamTable from './ApiParamTable.svelte';
  import ApiAuthEditor from './ApiAuthEditor.svelte';
  import ApiSchemaEditor from './ApiSchemaEditor.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import type { ApiRequest, ApiCollection, ApiParam, ApiKeyValue, ApiBody, HttpMethod, ApiResponse, ApiOutputSchemaField } from '$lib/types/api-connection';

  interface Props {
    request: ApiRequest;
    provider: ApiCollection;
    startOpen?: boolean;
    onchange: (req: ApiRequest) => void;
    ondelete: () => void;
  }

  let { request, provider, startOpen = false, onchange, ondelete }: Props = $props();

  function initialOpenState() {
    return startOpen;
  }

  function initialResponseState(): ApiResponse | null {
    if (!request.lastResponse) return null;
    return {
      status: request.lastResponse.status,
      statusText: request.lastResponse.statusText,
      headers: request.lastResponse.headers,
      body: request.lastResponse.body,
      durationMs: request.lastResponse.durationMs,
    };
  }

  let open = $state(initialOpenState());
  let initValues = $state<Record<string, string>>({});
  let sending = $state(false);
  let response = $state<ApiResponse | null>(initialResponseState());

  const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const METHOD_COLORS: Record<string, string> = {
    GET: 'text-emerald-600', POST: 'text-blue-600', PUT: 'text-amber-600',
    PATCH: 'text-violet-600', DELETE: 'text-red-600', HEAD: 'text-text-muted', OPTIONS: 'text-text-muted',
  };

  function set(patch: Partial<ApiRequest>) { onchange({ ...request, ...patch }); }

  // Non-private params (call + provider shared) become call-time inputs.
  const inputParams = $derived([
    ...provider.sharedParams.filter(p => !p.private && p.enabled && p.key),
    ...request.params.filter(p => !p.private && p.enabled && p.key),
  ]);

  async function initialize() {
    if (sending) return;
    sending = true;
    try {
      const { response: resp, schema } = await apiConnections.initializeCall(request, initValues);
      response = resp;
      // Bubble behaviour: the detected schema populates the editable return values.
      set({ outputSchema: schema, lastResponse: { ...resp, timestamp: Date.now() } });
      toast.success(`Initialized · HTTP ${resp.status}`);
    } catch (e) {
      toast.error(`Call failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      sending = false;
    }
  }

  async function del() {
    const ok = await confirm({ title: 'Delete call', message: `Delete "${request.name}"?`, confirmLabel: 'Delete' });
    if (ok) ondelete();
  }

  function prettyBody(s: string): string {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  }
</script>

<div class="rounded-lg border border-border bg-surface">
  <!-- Header -->
  <div class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface/60 rounded-t-lg"
       role="button" tabindex="0"
       onclick={() => open = !open}
       onkeydown={(e) => e.key === 'Enter' && (open = !open)}>
    <Icon icon="lucide:chevron-right" width="12" height="12" class="text-text-subtle shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
    <span class="text-[10px] font-bold font-mono shrink-0 w-12 {METHOD_COLORS[request.method]}">{request.method}</span>
    <span class="flex-1 text-sm text-text truncate">{request.name}</span>
    {#if request.outputSchema && Object.keys(request.outputSchema).length}
      <span class="text-[10px] text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">initialized</span>
    {/if}
    <span class="text-[10px] text-text-subtle uppercase">{request.useAs}</span>
    <button type="button" onclick={(e) => { e.stopPropagation(); del(); }} aria-label="Delete call"
      class="text-text-faint hover:text-red-400 transition-colors shrink-0">
      <Icon icon="lucide:trash-2" width="13" height="13" />
    </button>
  </div>

  {#if open}
    <div class="px-3 pb-3 pt-1 space-y-3 border-t border-border">
      <!-- Name + Use as -->
      <div class="flex items-center gap-2">
        <input type="text" value={request.name} placeholder="Call name"
          oninput={(e) => set({ name: (e.target as HTMLInputElement).value })}
          class="flex-1 text-sm font-medium text-text border-b border-transparent focus:border-brand/40 outline-none bg-transparent pb-0.5" />
        <span class="text-[11px] text-text-subtle">Use as</span>
        <Select value={request.useAs} options={[{ value: 'data', label: 'Data' }, { value: 'action', label: 'Action' }]}
          onchange={(v) => set({ useAs: v as 'data' | 'action' })} class="w-24" />
      </div>

      <!-- Method + URL -->
      <div class="flex items-center gap-1.5">
        <Select value={request.method} options={METHODS.map(m => ({ value: m, label: m }))}
          onchange={(m) => set({ method: m as HttpMethod })} class="w-24" />
        <input type="text" value={request.url} placeholder="https://api.example.com/users/[user_id]"
          oninput={(e) => set({ url: (e.target as HTMLInputElement).value })}
          class="flex-1 text-xs font-mono border border-border rounded px-2 py-1.5 bg-surface outline-none focus:border-brand/60" />
      </div>
      <p class="text-[10px] text-text-subtle -mt-1">Use <code class="bg-surface px-1 rounded">[param]</code> in the URL/headers and <code class="bg-surface px-1 rounded">&lt;param&gt;</code> in the body to insert parameter values.</p>

      <!-- Parameters -->
      <div>
        <span class="text-[11px] font-medium text-text-muted">Parameters</span>
        <ApiParamTable rows={request.params} onchange={(params: ApiParam[]) => set({ params })} />
      </div>

      <!-- Headers -->
      <div>
        <span class="text-[11px] font-medium text-text-muted">Headers</span>
        <KeyValueTable rows={request.headers} keyPlaceholder="Header" valuePlaceholder="Value"
          onchange={(headers: ApiKeyValue[]) => set({ headers })} />
      </div>

      <!-- Body -->
      <div class="space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-medium text-text-muted">Body</span>
          <Select value={request.body.type}
            options={[{ value: 'none', label: 'None' }, { value: 'json', label: 'JSON' }, { value: 'form-data', label: 'Form' }, { value: 'raw', label: 'Raw' }]}
            onchange={(t) => set({ body: { ...request.body, type: t as ApiBody['type'] } })} class="w-28" />
        </div>
        {#if request.body.type !== 'none'}
          <textarea value={request.body.content}
            placeholder={request.body.type === 'json' ? '{\n  "name": "<name>"\n}' : 'Request body…'}
            oninput={(e) => set({ body: { ...request.body, content: (e.target as HTMLTextAreaElement).value } })}
            rows={4} class="w-full text-[11px] font-mono border border-border rounded px-2 py-1.5 bg-surface outline-none focus:border-brand/60 resize-y"></textarea>
        {/if}
      </div>

      <!-- Authentication (call level, can inherit) -->
      <div class="pt-1">
        <ApiAuthEditor auth={request.auth} allowInherit onchange={(auth) => set({ auth })} />
      </div>

      <!-- Initialize call -->
      <div class="rounded-lg border border-border bg-surface/50 p-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-text-secondary">Initialize call</span>
          <Button variant="primary" size="sm" loading={sending} onclick={initialize} disabled={!request.url}>
            <Icon icon="lucide:play" width="11" height="11" />
            {request.outputSchema ? 'Reinitialize' : 'Initialize call'}
          </Button>
        </div>

        {#if inputParams.length}
          <div class="space-y-1.5">
            <span class="text-[10px] text-text-subtle">Provide values for the non-private parameters:</span>
            {#each inputParams as p (p.key)}
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-mono text-text-muted w-32 truncate">{p.key}</span>
                <input type="text" value={initValues[p.key] ?? p.value}
                  oninput={(e) => initValues = { ...initValues, [p.key]: (e.target as HTMLInputElement).value }}
                  placeholder={p.optional ? 'optional' : 'value'}
                  class="flex-1 text-xs font-mono border border-border rounded px-2 py-1 bg-surface outline-none focus:border-brand/60" />
              </div>
            {/each}
          </div>
        {/if}

        {#if response}
          <div class="flex items-center gap-2 text-[10px]">
            <span class="font-bold px-1.5 py-0.5 rounded {response.status < 300 ? 'bg-emerald-100 text-emerald-800' : response.status < 400 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">{response.status}</span>
            <span class="text-text-subtle">{response.durationMs}ms</span>
          </div>
          <details class="text-[10px]">
            <summary class="cursor-pointer text-text-subtle hover:text-text-secondary">Raw response</summary>
            <pre class="mt-1 max-h-40 overflow-auto rounded bg-zinc-900 text-zinc-100 p-2 font-mono text-[10px]">{prettyBody(response.body)}</pre>
          </details>
        {/if}
      </div>

      <!-- Return values (typed output) -->
      {#if request.outputSchema}
        <div class="space-y-1.5">
          <span class="text-[11px] font-medium text-text-muted">Return values (output type)</span>
          <ApiSchemaEditor schema={request.outputSchema}
            onchange={(schema: Record<string, ApiOutputSchemaField>) => set({ outputSchema: schema })} />
        </div>
      {/if}
    </div>
  {/if}
</div>
