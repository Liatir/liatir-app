<!--
	A form label with an optional "i" explaining the field.

	The `targetId` branch is not cosmetic: with an id it renders a real `<label for=…>`, which is what
	makes clicking the label focus its input and lets a screen reader announce the two together. Without
	one it degrades to a `<span>`, because a `<label>` pointing at nothing is worse than no label element
	at all.
-->
<script lang="ts">
  import InfoPopup from './InfoPopup.svelte';

  interface Props {
    text: string;
    info?: string;
    /** The id of the input this labels. Omit only when there is no single input to point at. */
    targetId?: string;
  }

  let { text, info, targetId }: Props = $props();
</script>

{#if targetId}
  <label for={targetId} class="mb-1.5 flex items-center gap-1 text-xs text-text-muted">
    <span>{text}</span>
    {#if info}
      <InfoPopup text={info} />
    {/if}
  </label>
{:else}
  <span class="mb-1.5 flex items-center gap-1 text-xs text-text-muted">
    <span>{text}</span>
    {#if info}
      <InfoPopup text={info} />
    {/if}
  </span>
{/if}
