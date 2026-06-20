<script lang="ts">
  import '../app.css';
  import '$lib/icons';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import InstallBanner from '$lib/components/ui/InstallBanner.svelte';
  import StartupCleanupBanner from '$lib/components/ui/StartupCleanupBanner.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    jobsStore.refresh();
    pipelineStore.init();
  });
</script>

<div class="flex h-screen overflow-hidden" style="background-color: var(--color-bg);">
  <Sidebar />
  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>

<ConfirmDialog />
<InstallBanner />
<StartupCleanupBanner />
