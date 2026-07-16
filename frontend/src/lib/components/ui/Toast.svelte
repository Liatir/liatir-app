<!--
	The toast stack. Mounted once in the root layout; everything else just calls `toast.success(...)`.
-->
<script lang="ts">
  import { toast } from '$lib/stores/toast.svelte';
  import Icon from '@iconify/svelte';
</script>

<!--
	`pointer-events-none` on the container with `pointer-events-auto` on each toast: the gaps between
	toasts stay click-through, so a stack of notifications in the corner never blocks the UI underneath.
	`flex-col-reverse` puts the newest toast nearest the bottom edge, where the eye is already looking.
-->
<div class="fixed bottom-5 right-5 z-[200] flex flex-col-reverse gap-2 pointer-events-none">
  {#each toast.items as t (t.id)}
    <div class="pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg text-sm font-medium min-w-52 max-w-sm
      {t.kind === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
        (t.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' :
        (t.kind === 'error'   ? 'bg-red-50 border-red-200 text-red-800' :
                              'bg-surface border-border text-text-secondary'))}"
      data-testid="toast-item"
    >
      <Icon
        icon={t.kind === 'success' ? 'lucide:check-circle' : ((t.kind === 'error' || t.kind === 'warn') ? 'lucide:alert-circle' : 'lucide:info')}
        width="14" height="14"
        class="{t.kind === 'success' ? 'text-emerald-500' : (t.kind === 'warn' ? 'text-amber-500' : (t.kind === 'error' ? 'text-red-500' : 'text-brand'))} shrink-0 mt-0.5"
      />
      <!--
        The short message is shown; the full, unabridged text (a whole Python traceback, say) is the
        tooltip. That is the pay-off of the compaction in the toast store — nothing is lost, it is just
        not all on screen.
      -->
      <span class="flex-1 min-w-0 line-clamp-3 break-words" title={t.detail ?? t.message}>{t.message}</span>
      <button onclick={() => toast.remove(t.id)} class="opacity-50 hover:opacity-100 shrink-0 mt-0.5">
        <Icon icon="lucide:x" width="12" height="12" />
      </button>
    </div>
  {/each}
</div>
