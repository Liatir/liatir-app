<!--
  Quenta's two modes, side by side in the same place on both pages: Chat explains things; Stage builds
  an interactive page, about selected Results or any topic. Plain links, so each mode keeps its own
  route (the Stage's route and identifiers keep their earlier name, presentations).
-->
<script lang="ts">
  import Icon from '@iconify/svelte';

  let { active }: { active: 'chat' | 'presentations' } = $props();

  const modes = [
    { id: 'chat', label: 'Chat', icon: 'lucide:messages-square', href: '/quenta' },
    { id: 'presentations', label: 'Stage', icon: 'lucide:monitor-play', href: '/quenta/presentations' },
  ] as const;
</script>

<nav aria-label="Quenta mode" class="inline-flex shrink-0 items-center rounded-lg border border-border bg-surface-2 p-0.5" data-testid="quenta-mode-switch">
  {#each modes as mode (mode.id)}
    <a
      href={mode.href}
      aria-current={active === mode.id ? 'page' : undefined}
      data-testid="quenta-mode-{mode.id}"
      class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
        {active === mode.id ? 'bg-surface text-brand shadow-sm' : 'text-text-muted hover:text-text-secondary'}"
    >
      <Icon icon={mode.icon} width="14" height="14" />
      {mode.label}
    </a>
  {/each}
</nav>
