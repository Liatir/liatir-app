<script lang="ts">
  interface Props {
    size?: number;
    class?: string;
  }
  let { size = 20, class: cls = '' }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  class="animate-spin text-brand-muted {cls}"
>
  <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
  <path
    class="opacity-80"
    fill="currentColor"
    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  />
</svg>
