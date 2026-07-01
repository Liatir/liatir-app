<script lang="ts">
  import { autoThreadCount, MAX_MANUAL_THREADS } from '$lib/utils/execution-resources';

  let {
    value = 0,
    disabled = false,
    onchange,
  }: {
    value?: number;
    disabled?: boolean;
    onchange?: (value: number) => void;
  } = $props();

  const autoThreads = $derived(autoThreadCount());

  function onInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = Number(input.value);
    onchange?.(Number.isFinite(next) ? Math.max(0, Math.min(MAX_MANUAL_THREADS, Math.trunc(next))) : 0);
  }
</script>

<div class="space-y-1.5">
  <label for="tool-threads" class="block text-[11px] font-medium text-zinc-600">Threads</label>
  <input
    id="tool-threads"
    type="number"
    min="0"
    max={MAX_MANUAL_THREADS}
    step="1"
    value={value}
    {disabled}
    oninput={onInput}
    class="w-28 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-zinc-800 outline-none transition-colors focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
  />
  <p class="text-[10px] leading-snug text-zinc-400">0 lets Liatir choose {autoThreads} threads.</p>
</div>
