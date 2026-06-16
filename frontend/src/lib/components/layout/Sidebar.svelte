<script lang="ts">
  import { page } from '$app/stores';
  import { jobsStore } from '$lib/stores/jobs.svelte';

  interface NavItem {
    href: string;
    label: string;
    match?: string; // prefix match if different from href
  }

  const nav: NavItem[] = [
    { href: '/', label: 'Dashboard' },
    { href: '/tools', label: 'Tools', match: '/tools' },
    { href: '/jobs', label: 'Jobs', match: '/jobs' },
    { href: '/deps', label: 'Dependencies', match: '/deps' },
    { href: '/code', label: 'Code', match: '/code' },
  ];

  function isActive(item: NavItem): boolean {
    const path = $page.url.pathname;
    if (item.href === '/') return path === '/';
    return path.startsWith(item.match ?? item.href);
  }
</script>

<aside class="flex h-screen w-[220px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
  <!-- Logo -->
  <div class="flex h-14 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
    <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shrink-0 p-1.5">
      <img src="/logo/png/logo-white.png" alt="Offlab" class="h-full w-full object-contain" />
    </div>
    <span class="text-md font-semibold tracking-tight text-zinc-900">Offlab</span>
    <span class="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand/10 text-brand-soft border border-brand/20">
      dev
    </span>
  </div>

  <!-- Navigation -->
  <nav class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
    {#each nav as item}
      {@const active = isActive(item)}
      <a
        href={item.href}
        class="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-100
          {active
            ? 'bg-brand/10 text-brand font-medium'
            : 'text-zinc-500 hover:bg-[var(--color-surface-2)] hover:text-zinc-800'}"
      >
        <!-- icons -->
        {#if item.href === '/'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        {:else if item.match === '/tools'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M16.24 7.76a6 6 0 0 1 0 8.49M4.93 4.93a10 10 0 0 0 0 14.14M7.76 7.76a6 6 0 0 0 0 8.49" />
          </svg>
        {:else if item.match === '/jobs'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        {:else if item.match === '/code'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        {:else if item.match === '/deps'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        {/if}

        <span class="flex-1">{item.label}</span>

        <!-- running jobs badge on Jobs item -->
        {#if item.match === '/jobs' && jobsStore.runningCount > 0}
          <span class="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-600">
            {jobsStore.runningCount}
          </span>
        {/if}
      </a>
    {/each}
  </nav>

  <!-- Settings -->
  <div class="border-t border-[var(--color-border)] px-2 py-3">
    <a
      href="/settings"
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500
        hover:bg-[var(--color-surface-2)] hover:text-zinc-800 transition-colors duration-100
        {$page.url.pathname === '/settings' ? 'bg-brand/10 text-brand font-medium' : ''}"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      Settings
    </a>
  </div>
</aside>
