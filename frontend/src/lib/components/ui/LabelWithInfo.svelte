<script lang="ts">
  import InfoPopup from './InfoPopup.svelte';

  interface Props {
    text: string;
    info?: string;
    targetId?: string;
  }

  let { text, info, targetId }: Props = $props();
</script>

{#if targetId}
  <label for={targetId} class="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
    <span>{text}</span>
    {#if info}
      <InfoPopup text={info} />
    {/if}
  </label>
{:else}
  <span class="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
    <span>{text}</span>
    {#if info}
      <InfoPopup text={info} />
    {/if}
  </span>
{/if}
