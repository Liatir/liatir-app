<script lang="ts">
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import KeyValueTable from '$lib/components/ui/KeyValueTable.svelte';
  import ApiParamTable from './ApiParamTable.svelte';
  import ApiAuthEditor from './ApiAuthEditor.svelte';
  import ApiCallCard from './ApiCallCard.svelte';
  import {
    apiConnections,
    syncDiscoveredParameters,
    syncDiscoveredSharedParameters,
    urlAndHeaderTemplateParameterKeys,
  } from '$lib/stores/apiConnections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import type { ApiCollection, ApiRequest, ApiParam, ApiKeyValue, ApiAuth } from '$lib/types/api-connection';

  interface Props {
    provider: ApiCollection;
    startOpen?: boolean;
  }

  let { provider, startOpen = true }: Props = $props();

  function initialOpenState() {
    return startOpen;
  }

  let open = $state(initialOpenState());
  let showSettings = $state(false);
  let newlyAddedId = $state<string | null>(null);

  const calls = $derived(apiConnections.requestsInCollection(provider.id));
  const sharedHeaderParameterKeys = $derived(new Set(urlAndHeaderTemplateParameterKeys({
    url: '',
    headers: provider.sharedHeaders,
  })));
  const sharedHeaderParameters = $derived(provider.sharedParams.filter((parameter) => sharedHeaderParameterKeys.has(parameter.key)));
  const sharedValues = $derived(provider.sharedParams.filter((parameter) => !sharedHeaderParameterKeys.has(parameter.key)));

  function setProvider(patch: Partial<ApiCollection>) {
    apiConnections.updateCollection({ ...provider, ...patch });
  }

  function setProviderParameters(nextProvider: ApiCollection) {
    apiConnections.updateCollection(nextProvider);
    for (const call of calls) {
      const synchronized = syncDiscoveredParameters(call, nextProvider);
      if (synchronized !== call) apiConnections.updateRequest(synchronized);
    }
  }

  function commitSharedHeaders(sharedHeaders: ApiKeyValue[]) {
    setProviderParameters(syncDiscoveredSharedParameters({ ...provider, sharedHeaders }));
  }

  function setSharedParameterGroup(current: ApiParam[], next: ApiParam[]) {
    const currentRows = new Set(current);
    const sharedParams = [...provider.sharedParams.filter((parameter) => !currentRows.has(parameter)), ...next];
    setProviderParameters({ ...provider, sharedParams });
  }

  async function addCall() {
    const req = await apiConnections.addRequest(provider.id);
    newlyAddedId = req.id;
    open = true;
    toast.success('Call added');
  }

  async function del() {
    const ok = await confirm({ title: 'Delete API', message: `Delete "${provider.name}" and all its calls?`, confirmLabel: 'Delete' });
    if (ok) { await apiConnections.deleteCollection(provider.id); toast.info('API deleted'); }
  }

  function updateCall(req: ApiRequest) { apiConnections.updateRequest(req); }
  function deleteCall(id: string) { apiConnections.deleteRequest(id); toast.info('Call deleted'); }
</script>

<div class="rounded-xl border border-border bg-surface/40 overflow-visible">
  <!-- Provider header -->
  <div class="flex items-center gap-2 px-3 py-2.5 bg-surface border-b border-border {open ? 'rounded-t-xl' : 'rounded-xl'}">
    <button type="button" onclick={() => open = !open} aria-label="Toggle"
      class="text-text-subtle hover:text-text-secondary shrink-0">
      <Icon icon="lucide:chevron-right" width="14" height="14" class="transition-transform {open ? 'rotate-90' : ''}" />
    </button>
    <Icon icon="lucide:plug" width="14" height="14" class="text-brand shrink-0" />
    <input type="text" value={provider.name} placeholder="API name"
      oninput={(e) => setProvider({ name: (e.target as HTMLInputElement).value })}
      class="flex-1 min-w-0 text-sm font-semibold text-text bg-transparent outline-none border-b border-transparent focus:border-brand/40 pb-0.5" />
    <button type="button" onclick={() => showSettings = !showSettings}
      class="text-[11px] flex items-center gap-1 px-2 py-1 rounded hover:bg-surface {showSettings ? 'text-brand' : 'text-text-subtle hover:text-text-secondary'}">
      <Icon icon="lucide:settings-2" width="12" height="12" /> Settings
    </button>
    <Button variant="secondary" size="sm" onclick={addCall}>
      <Icon icon="lucide:plus" width="11" height="11" /> API call
    </Button>
    <button type="button" onclick={del} aria-label="Delete API"
      class="text-text-faint hover:text-red-400 transition-colors shrink-0">
      <Icon icon="lucide:trash-2" width="14" height="14" />
    </button>
  </div>

  {#if open}
    <!-- Provider settings: auth + shared headers/params -->
    {#if showSettings}
      <div class="px-4 py-3 bg-surface border-b border-border space-y-3">
        <ApiAuthEditor auth={provider.auth} onchange={(auth: ApiAuth) => setProvider({ auth })} />
        <div>
          <span class="text-[11px] font-medium text-text-muted">Shared headers</span>
          <KeyValueTable rows={provider.sharedHeaders} keyPlaceholder="Header" valuePlaceholder="Value"
            onchange={(sharedHeaders: ApiKeyValue[]) => setProvider({ sharedHeaders })}
            oncommit={commitSharedHeaders} />
        </div>
        {#if sharedHeaderParameters.length}
          <div>
            <span class="text-[11px] font-medium text-text-muted">Shared header parameters</span>
            <ApiParamTable rows={sharedHeaderParameters} allowAdd={false}
              onchange={(sharedParams: ApiParam[]) => setSharedParameterGroup(sharedHeaderParameters, sharedParams)} />
          </div>
        {/if}
        <div>
          <span class="text-[11px] font-medium text-text-muted">Shared values</span>
          <p class="text-[10px] text-text-subtle">Used only when a call contains a matching URL, header, JSON or raw placeholder.</p>
          <ApiParamTable rows={sharedValues}
            addLabel="Add shared value"
            onchange={(sharedParams: ApiParam[]) => setSharedParameterGroup(sharedValues, sharedParams)} />
        </div>
      </div>
    {/if}

    <!-- Calls -->
    <div class="p-3 space-y-2">
      {#each calls as call (call.id)}
        <ApiCallCard
          request={call}
          {provider}
          startOpen={call.id === newlyAddedId}
          onchange={updateCall}
          ondelete={() => deleteCall(call.id)} />
      {/each}
      {#if calls.length === 0}
        <button type="button" onclick={addCall}
          class="w-full rounded-lg border border-dashed border-border py-4 text-xs text-text-subtle hover:border-brand/40 hover:text-brand transition-colors">
          + Add the first API call
        </button>
      {/if}
    </div>
  {/if}
</div>
