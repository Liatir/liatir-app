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
      href: '/tools/qc/fastqc',
      status: 'available',
      tags: ['FASTQ', 'QC', 'WASM'],
      category: 'Quality Control',
    },
    {
      id: 'samtools',
      label: 'Samtools flagstat',
      description: 'Alignment statistics for BAM/SAM/CRAM: total reads, mapped %, duplicates, properly paired.',
      href: '/tools/alignment/samtools',
      status: 'available',
      tags: ['BAM', 'SAM', 'Native'],
      category: 'Alignment',
    },
    {
      id: 'samtools-faidx',
      label: 'Samtools faidx',
      description: 'Index a FASTA file and extract subsequences by chromosome and coordinate range.',
      href: '/tools/alignment/samtools-faidx',
      status: 'available',
      tags: ['FASTA', 'Index', 'Native'],
      category: 'Alignment',
    },
    {
      id: 'bwa',
      label: 'BWA-MEM',
      description: 'Map short reads to a reference genome. Outputs SAM format.',
      href: '/tools/alignment/bwa',
      status: 'available',
      tags: ['FASTQ', 'SAM', 'Alignment', 'Native'],
      category: 'Alignment',
    },
    {
      id: 'minimap2',
      label: 'Minimap2',
      description: 'Versatile alignment for long and short reads (ONT, PacBio, Illumina).',
      href: '/tools/alignment/minimap2',
      status: 'available',
      tags: ['Long reads', 'SAM', 'Native'],
      category: 'Alignment',
    },
    {
      id: 'fastp',
      label: 'fastp',
      description: 'Ultra-fast FASTQ quality trimming, adapter removal, and QC reporting.',
      href: '/tools/qc/fastp',
      status: 'available',
      tags: ['FASTQ', 'QC', 'Native'],
      category: 'Quality Control',
    },
    {
      id: 'seqkit',
      label: 'seqkit stats',
      description: 'Sequence statistics for FASTA and FASTQ: count, total length, min/max/avg, N50, GC content, Q30.',
      href: '/tools/qc/seqkit',
      status: 'available',
      tags: ['FASTA', 'FASTQ', 'Native'],
      category: 'Quality Control',
    },
    {
      id: 'bcftools',
      label: 'BCFtools stats',
      description: 'Variant statistics for VCF/BCF: SNP/indel counts, Ts/Tv ratio, per-sample metrics.',
      href: '/tools/variants/bcftools',
      status: 'available',
      tags: ['VCF', 'BCF', 'Native'],
      category: 'Variant Calling',
    },
    {
      id: 'bcftools-filter',
      label: 'BCFtools filter',
      description: 'Filter variants by quality, depth, or any INFO/FORMAT field. Outputs a compressed VCF.',
      href: '/tools/variants/bcftools-filter',
      status: 'available',
      tags: ['VCF', 'BCF', 'Native'],
      category: 'Variant Calling',
    },
    {
      id: 'snpeff',
      label: 'SnpEff',
      description: 'Annotate variants with functional effects: missense, stop gained, splice site, frameshift and more.',
      href: '/tools/variants/snpeff',
      status: 'available',
      tags: ['VCF', 'Annotation', 'Java'],
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
                <p class="text-sm font-semibold text-zinc-900">{tool.label}</p>
                {#if tool.status === 'soon'}
                  <Badge variant="neutral">Coming soon</Badge>
                {:else}
                  <Badge variant="available">Ready</Badge>
                {/if}
              </div>
              <p class="text-xs text-zinc-500 leading-relaxed mb-3">{tool.description}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each tool.tags as tag}
                  <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
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
            <span class="ml-2 text-zinc-400 normal-case font-normal">
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
          <p class="text-center text-xs text-zinc-400 mt-1">
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
                <p class="text-sm font-semibold font-mono text-zinc-800">{mod}</p>
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
