<script lang="ts">
  import '../app.css';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import InstallBanner from '$lib/components/ui/InstallBanner.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    jobsStore.refresh();
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
