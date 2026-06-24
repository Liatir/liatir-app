<script lang="ts">
  // A single value field that is EITHER a typed literal OR a reference to an
  // upstream node's output (an `@pipe:` token). The plug button lists the
  // compatible outputs of nodes wired into this node; picking one turns the
  // field into a "linked" chip. This is what lets Math / Condition / tool value
  // inputs consume previous steps' outputs without per-field handles.
  import Icon from '@iconify/svelte';
  import type { PickerItem } from '$lib/components/ui/OptionPicker.svelte';

  interface Props {
    value: string;
    /** Compatible upstream outputs (each item.value is an `@pipe:` token). */
    options: PickerItem[];
    type?: 'number' | 'text';
    placeholder?: string;
    disabled?: boolean;
    /** Tailwind focus-ring class to match the node's accent colour. */
    accentClass?: string;
    onchange: (value: string) => void;
  }

  let {
    value,
    options,
    type = 'text',
    placeholder = '',
    disabled = false,
    accentClass = 'focus:ring-brand/40',
    onchange,
  }: Props = $props();

  let open = $state(false);

  const isRef = $derived(typeof value === 'string' && value.startsWith('@pipe:'));
  const linked = $derived(options.find(o => o.value === value) ?? null);

  function pick(v: string) { onchange(v); open = false; }
</script>

<div class="relative">
  {#if isRef}
    <div class="flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/5 px-2 py-1.5">
      <Icon icon="lucide:plug-zap" width="11" height="11" class="text-brand shrink-0" />
      <span class="flex-1 min-w-0 text-[11px] font-medium text-brand truncate">
        {linked?.sublabel ? `${linked.sublabel} → ` : ''}{linked?.label ?? 'linked output'}
      </span>
      {#if !disabled}
        <button onclick={() => onchange('')} class="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors" aria-label="Unlink">
          <Icon icon="lucide:x" width="11" height="11" />
        </button>
      {/if}
    </div>
  {:else}
    <div class="flex items-center gap-1">
      <input
        {type}
        {value}
        oninput={(e) => onchange((e.target as HTMLInputElement).value)}
        {disabled}
        {placeholder}
        class="flex-1 min-w-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
               placeholder:text-zinc-300 focus:outline-none focus:ring-1 {accentClass}
               disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {#if options.length > 0 && !disabled}
        <button
          onclick={() => open = !open}
          title="Use an upstream output"
          class="shrink-0 rounded-lg border border-border px-1.5 py-1.5 text-zinc-400
                 hover:text-brand hover:border-brand/40 transition-colors"
        >
          <Icon icon="lucide:plug" width="12" height="12" />
        </button>
      {/if}
    </div>
  {/if}

  {#if open}
    <div class="fixed inset-0 z-40" role="presentation" onclick={() => open = false}></div>
    <div class="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-white shadow-xl overflow-hidden">
      <p class="px-3 pt-2 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Upstream outputs</p>
      <div class="max-h-52 overflow-y-auto pb-1">
        {#each options as o (o.value)}
          <button onclick={() => pick(o.value)} class="w-full text-left px-3 py-1.5 hover:bg-brand/5 transition-colors">
            <span class="block text-xs text-zinc-700 truncate">{o.label}</span>
            {#if o.sublabel}<span class="block text-[10px] text-zinc-400 truncate">{o.sublabel}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
