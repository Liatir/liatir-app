<!--
	The API Connector: define external API calls once, then use them as pipeline nodes.

	The point of the feature is the typed contract. A user describes a call's parameters and its response
	schema, and Liatir turns that into a pipeline node whose inputs and outputs can be wired to other steps —
	so an external service becomes a first-class part of an analysis rather than something to be done by hand
	and pasted back in.

	This page is only the list; the substance lives in the provider cards and the schema editor.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import ApiProviderCard from '$lib/components/api/ApiProviderCard.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  /** The just-created collection, so the new card can open itself for editing rather than sit there closed. */
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
    info="Test a call to detect its outputs, then use its editable inputs and typed return values in pipelines."
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={addProvider}>
        <Icon icon="lucide:plus" width="13" height="13" />
        Add API
      </Button>
    {/snippet}
  </PageHeader>

  <PageContent>
  <div class="flex-1 overflow-y-auto py-6">
    {#if apiConnections.collections.length === 0}
      <div class="max-w-4xl mx-auto mt-16">
        <EmptyState
          title="No APIs yet"
          description="Add an API, define its calls and authentication, then test each call to detect the outputs you can connect in a pipeline."
        >
          {#snippet icon()}
            <Icon icon="lucide:plug-zap" width="28" height="28" class="text-text-faint" />
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
  </PageContent>
</div>
