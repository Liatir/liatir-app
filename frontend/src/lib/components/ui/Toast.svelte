<script lang="ts">
  import { toast } from '$lib/stores/toast.svelte';
  import Icon from '@iconify/svelte';
</script>

<div class="fixed bottom-5 right-5 z-[200] flex flex-col-reverse gap-2 pointer-events-none">
  {#each toast.items as t (t.id)}
    <div class="pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg text-sm font-medium min-w-52 max-w-xs
      {t.kind === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
        (t.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' :
        (t.kind === 'error'   ? 'bg-red-50 border-red-200 text-red-800' :
                              'bg-white border-border text-zinc-700'))}"
    >
      <Icon
        icon={t.kind === 'success' ? 'lucide:check-circle' : ((t.kind === 'error' || t.kind === 'warn') ? 'lucide:alert-circle' : 'lucide:info')}
        width="14" height="14"
        class="{t.kind === 'success' ? 'text-emerald-500' : (t.kind === 'warn' ? 'text-amber-500' : (t.kind === 'error' ? 'text-red-500' : 'text-brand'))} shrink-0"
      />
      <span class="flex-1">{t.message}</span>
      <button onclick={() => toast.remove(t.id)} class="opacity-50 hover:opacity-100 shrink-0">
        <Icon icon="lucide:x" width="12" height="12" />
      </button>
    </div>
  {/each}
</div>
