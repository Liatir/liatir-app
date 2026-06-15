<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { pluginsStore } from '$lib/stores/plugins.svelte';

  interface BuiltinTool {
    id: string;
    label: string;
    description: string;
    href: string;
    status: 'available' | 'soon';
    tags: string[];
    category: string;
  }

  const builtins: BuiltinTool[] = [
    {
      id: 'fastqc',
      label: 'FastQC',
      description: 'Per-base quality scores, GC content, adapter detection for FASTQ files.',
      href: '/tools/qc',
      status: 'available',
      tags: ['FASTQ', 'QC', 'WASM'],
      category: 'Quality Control',
    },
    {
      id: 'bwa',
      label: 'BWA-MEM2',
      description: 'Map short reads to a reference genome.',
      href: '/tools/align/bwa',
      status: 'soon',
      tags: ['FASTQ', 'BAM', 'Alignment'],
      category: 'Alignment',
    },
    {
      id: 'minimap2',
      label: 'Minimap2',
      description: 'Versatile alignment for long reads (PacBio, Oxford Nanopore).',
      href: '/tools/align/minimap2',
      status: 'soon',
      tags: ['Long reads', 'BAM'],
      category: 'Alignment',
    },
    {
      id: 'bcftools',
      label: 'BCFtools',
      description: 'Call and manipulate VCF/BCF files.',
      href: '/tools/variants/bcftools',
      status: 'soon',
      tags: ['VCF', 'BCF'],
      category: 'Variant Calling',
    },
    {
      id: 'nextflow',
      label: 'Nextflow',
      description: 'Run Nextflow pipelines with your system-installed Nextflow.',
      href: '/tools/pipelines/nextflow',
      status: 'soon',
      tags: ['Pipeline', 'DSL2'],
      category: 'Pipelines',
    },
    {
      id: 'snakemake',
      label: 'Snakemake',
      description: 'Execute Snakemake workflows from your workspace.',
      href: '/tools/pipelines/snakemake',
      status: 'soon',
      tags: ['Pipeline', 'Python'],
      category: 'Pipelines',
    },
  ];

  // group builtins by category
  const categories = [...new Set(builtins.map((t) => t.category))];

  onMount(() => pluginsStore.refresh());
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Tools" description="Built-in modules and custom WASM plugins">
    {#snippet actions()}
      <Button variant="secondary" size="sm" onclick={() => goto('/settings')}>
        Manage plugins
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6 space-y-8">

    <!-- Built-in tools by category -->
    {#each categories as category}
      <div>
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">{category}</h2>
        <div class="grid grid-cols-2 gap-3">
          {#each builtins.filter((t) => t.category === category) as tool}
            <Card
              hoverable={tool.status === 'available'}
              class="p-4 {tool.status === 'soon' ? 'opacity-50' : ''}"
              onclick={tool.status === 'available' ? () => goto(tool.href) : undefined}
            >
              <div class="flex items-start justify-between gap-2 mb-2">
                <p class="text-sm font-semibold text-zinc-100">{tool.label}</p>
                {#if tool.status === 'soon'}
                  <Badge variant="neutral">Coming soon</Badge>
                {:else}
                  <Badge variant="available">Ready</Badge>
                {/if}
              </div>
              <p class="text-xs text-zinc-500 leading-relaxed mb-3">{tool.description}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each tool.tags as tag}
                  <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                    {tag}
                  </span>
                {/each}
              </div>
            </Card>
          {/each}
        </div>
      </div>
    {/each}

    <!-- Custom WASM plugins -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Custom Plugins
          {#if pluginsStore.modules.length > 0}
            <span class="ml-2 text-zinc-600 normal-case font-normal">
              ({pluginsStore.modules.length} loaded)
            </span>
          {/if}
        </h2>
        <Button variant="ghost" size="sm" onclick={() => pluginsStore.add()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add .wasm
        </Button>
      </div>

      {#if pluginsStore.loading}
        <div class="flex justify-center py-8"><Spinner /></div>

      {:else if pluginsStore.modules.length === 0}
        <Card class="p-6 border-dashed">
          <p class="text-center text-sm text-zinc-500">No custom plugins loaded.</p>
          <p class="text-center text-xs text-zinc-600 mt-1">
            Add any <code class="font-mono">.wasm</code> module compiled for <code class="font-mono">wasm32-wasip1</code>.
            Plugins persist across restarts.
          </p>
          <div class="flex justify-center mt-4">
            <Button variant="secondary" size="sm" onclick={() => pluginsStore.add()}>
              Browse for .wasm file
            </Button>
          </div>
        </Card>

      {:else}
        <div class="grid grid-cols-2 gap-3">
          {#each pluginsStore.modules as mod}
            <Card
              hoverable
              class="p-4"
              onclick={() => goto(`/tools/plugin/${encodeURIComponent(mod)}`)}
            >
              <div class="flex items-start justify-between gap-2 mb-2">
                <p class="text-sm font-semibold font-mono text-zinc-100">{mod}</p>
                <Badge variant="available">WASM</Badge>
              </div>
              <p class="text-xs text-zinc-500 leading-relaxed">
                Custom plugin — click to run with a custom payload.
              </p>
            </Card>
          {/each}
        </div>
      {/if}

      {#if pluginsStore.error}
        <p class="mt-2 text-xs text-red-400">{pluginsStore.error}</p>
      {/if}
    </div>

  </div>
</div>
