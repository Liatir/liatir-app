<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import ApiProviderCard from '$lib/components/api/ApiProviderCard.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  let newlyAddedId = $state<string | null>(null);

  onMount(() => { apiConnections.init(); });

  async function addProvider() {
    const col = await apiConnections.addCollection('New API');
    newlyAddedId = col.id;
    toast.success('API created');
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="API Connector"
    description="Define reusable external API calls with typed outputs to use in pipelines"
    info="Each API call you initialize exposes its parameters as pipeline node inputs and its return values as typed outputs."
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={addProvider}>
        <Icon icon="lucide:plus" width="13" height="13" />
        Add API
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    {#if apiConnections.collections.length === 0}
      <div class="max-w-md mx-auto mt-16">
        <EmptyState
          title="No APIs yet"
          description="Add an API provider, define its calls and authentication, then initialize each call to capture its typed response — ready to plug into your pipelines."
        >
          {#snippet icon()}
            <Icon icon="lucide:plug-zap" width="28" height="28" class="text-zinc-300" />
          {/snippet}
          {#snippet action()}
            <Button variant="primary" size="sm" onclick={addProvider}>
              <Icon icon="lucide:plus" width="13" height="13" />
              Add your first API
            </Button>
          {/snippet}
        </EmptyState>
      </div>
    {:else}
      <div class="max-w-4xl mx-auto space-y-4">
        {#each apiConnections.collections as provider (provider.id)}
          <ApiProviderCard {provider} startOpen={provider.id === newlyAddedId || apiConnections.collections.length === 1} />
        {/each}
      </div>
    {/if}
  </div>
</div>
