<script lang="ts">
  import '$lib/stores/workspace-reset';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';

  let { children } = $props();
</script>

<div class="h-screen flex flex-col" style="background-color: var(--color-bg);">
  {@render children()}
</div>

<ConfirmDialog />
<Toast />
