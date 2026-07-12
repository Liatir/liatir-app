<!--
	The shared Threads input for tool forms.

	`0` means "let Liatir decide", and the hint below the field spells out what that will actually be
	("0 lets Liatir choose 8 threads") — so the default is not a mystery the user has to accept on faith.
	The value is clamped as it is typed, so a stray keystroke cannot produce a nonsensical thread count.
-->
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

  /** Clamps to 0..MAX_MANUAL_THREADS and coerces anything unparseable to 0 (= auto). */
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
