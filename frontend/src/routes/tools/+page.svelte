<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';

  interface Tool {
    id: string;
    label: string;
    description: string;
    href: string;
    status: 'available' | 'soon';
    tags: string[];
  }

  const categories: { label: string; tools: Tool[] }[] = [
    {
      label: 'Quality Control',
      tools: [
        {
          id: 'fastqc',
          label: 'FastQC',
          description: 'Per-base quality scores, GC content, adapter detection for FASTQ files.',
          href: '/tools/qc',
          status: 'available',
          tags: ['FASTQ', 'QC', 'WASM'],
        },
      ],
    },
    {
      label: 'Alignment',
      tools: [
        {
          id: 'bwa',
          label: 'BWA-MEM2',
          description: 'Map short reads to a reference genome using BWA-MEM algorithm.',
          href: '/tools/align/bwa',
          status: 'soon',
          tags: ['FASTQ', 'BAM', 'Alignment'],
        },
        {
          id: 'minimap2',
          label: 'Minimap2',
          description: 'Versatile sequence alignment for long reads (PacBio, Oxford Nanopore).',
          href: '/tools/align/minimap2',
          status: 'soon',
          tags: ['Long reads', 'BAM'],
        },
      ],
    },
    {
      label: 'Variant Calling',
      tools: [
        {
          id: 'bcftools',
          label: 'BCFtools',
          description: 'Call and manipulate VCF/BCF files.',
          href: '/tools/variants/bcftools',
          status: 'soon',
          tags: ['VCF', 'BCF'],
        },
      ],
    },
    {
      label: 'Pipelines',
      tools: [
        {
          id: 'nextflow',
          label: 'Nextflow',
          description: 'Run Nextflow pipelines using your system-installed Nextflow.',
          href: '/tools/pipelines/nextflow',
          status: 'soon',
          tags: ['Pipeline', 'DSL2'],
        },
        {
          id: 'snakemake',
          label: 'Snakemake',
          description: 'Execute Snakemake workflows from your workspace.',
          href: '/tools/pipelines/snakemake',
          status: 'soon',
          tags: ['Pipeline', 'Python'],
        },
      ],
    },
  ];
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Tools" description="Bioinformatics analysis modules" />

  <div class="flex-1 overflow-y-auto p-6 space-y-8">
    {#each categories as category}
      <div>
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
          {category.label}
        </h2>
        <div class="grid grid-cols-2 gap-3">
          {#each category.tools as tool}
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
  </div>
</div>
