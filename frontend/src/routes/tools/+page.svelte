<!--
	The Tools catalogue: the native bioinformatics tools Liatir ships with.

	The list is declared here as data rather than as markup, so a tool is added by appending an entry — the page
	itself does not change. `status: 'soon'` is what lets a planned tool be *shown* while remaining unclickable:
	the user can see what is coming instead of wondering whether it exists.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { toast } from '$lib/stores/toast.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  interface BuiltinTool {
    id: string;
    label: string;
    description: string;
    /** Absent while a tool is still `soon`: an announced tool has no page to link to yet. */
    href?: string;
    /** `soon` renders the card but disables it — announced, not yet available. */
    status: 'available' | 'soon';
    /** Searchable keywords: a user looks for "FASTQ" or "QC", rarely for a tool's name. */
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
      id: 'viewer-structure-3d',
      label: '3D Structure Viewer',
      description: 'Inspect PDB, mmCIF, SDF, MOL2, and XYZ structure files with an optional local 3Dmol.js runtime.',
      href: '/tools/visualization/structure',
      status: 'available',
      tags: ['PDB', 'mmCIF', '3Dmol.js'],
      category: 'Visualization',
    },
    {
      id: 'viewer-genome-track',
      label: 'Genome Track Viewer',
      description: 'Preview GFF, BED, VCF, and BAM genomic tracks, with optional JBrowse 2 rendering when installed.',
      href: '/tools/visualization/genome',
      status: 'available',
      tags: ['GFF', 'BED', 'VCF', 'JBrowse 2'],
      category: 'Visualization',
    },
    {
      id: 'viewer-single-cell',
      label: 'Single-cell Viewer',
      description: 'Inspect AnnData embeddings, bounded preview CSVs, and single-cell label summaries.',
      href: '/tools/visualization/single-cell',
      status: 'available',
      tags: ['h5ad', 'CSV', 'Vitessce'],
      category: 'Visualization',
    },
    {
      id: 'nextflow',
      label: 'Nextflow',
      description: 'Save and run Nextflow workflows directly or reuse the same definition in a Liatir pipeline.',
      href: '/tools/external-workflows',
      status: 'available',
      tags: ['Nextflow', 'DSL2', 'Local-first'],
      category: 'External Workflows',
    },
    {
      id: 'snakemake',
      label: 'Snakemake',
      description: 'Execute Snakemake workflows from your workspace.',
      status: 'soon',
      tags: ['Workflow', 'Python'],
      category: 'External Workflows',
    },
  ];

  const categories = [...new Set(builtins.map((t) => t.category))];
  let query = $state('');
  let selectedCategory = $state('All');

  const filteredTools = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return builtins.filter(tool => {
      const matchesCategory = selectedCategory === 'All' || tool.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;
      const searchable = [
        tool.label,
        tool.description,
        tool.category,
        ...tool.tags,
      ].join(' ').toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  });

  const filteredCategories = $derived(
    categories.filter(category => filteredTools.some(tool => tool.category === category))
  );

  const openToolPage = (tool: BuiltinTool) => {
    if(!tool || tool?.status != 'available' || !tool?.href) return;
    if(workspaceStore.active && workspaceStore.activeId) {
      goto(tool.href);
    } else {
      const params = new URLSearchParams();
      params.set('fromRoute', ((tool.href.trim())||""));
      toast.info("Select a workspace first");
      goto(`/workspaces?${params.toString()}`);
    }
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Tools" description="Built-in local bioinformatics tools" />
<PageContent>
  <div class="flex-1 overflow-y-auto p-6 space-y-6">
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Icon icon="lucide:search" width="14" height="14" class="shrink-0 text-text-subtle" />
        <input
          bind:value={query}
          placeholder="Search tools…"
          class="flex-1 bg-transparent text-sm text-text placeholder:text-text-subtle outline-none"
        />
        {#if query}
          <button
            type="button"
            onclick={() => query = ''}
            class="text-text-subtle hover:text-text-secondary transition-colors"
            aria-label="Clear tool search"
          >
            <Icon icon="lucide:x" width="13" height="13" />
          </button>
        {/if}
      </div>

      <div class="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onclick={() => selectedCategory = 'All'}
          class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
            {selectedCategory === 'All'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-surface text-text-muted hover:border-border-2 hover:text-text-secondary'}"
        >
          All
        </button>
        {#each categories as category}
          <button
            type="button"
            onclick={() => selectedCategory = category}
            class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
              {selectedCategory === category
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-muted hover:border-border-2 hover:text-text-secondary'}"
          >
            {category}
          </button>
        {/each}
      </div>
    </div>

    {#if filteredTools.length === 0}
      <div class="py-16 text-center">
        <p class="text-sm font-medium text-text-secondary">No tools found</p>
      </div>
    {:else}
      {#each filteredCategories as category}
        <div>
          <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">{category}</h2>
          <div class="grid grid-cols-2 gap-3">
            {#each filteredTools.filter((t) => t.category === category) as tool}
              <Card
                hoverable={tool?.status === 'available'}
                class="p-4 {tool.status === 'soon' ? 'opacity-50' : ''}"
                onclick={()=>openToolPage(tool)}
              >
                <div class="flex items-start justify-between gap-2 mb-2">
                  <p class="text-sm font-semibold text-text">{tool.label}</p>
                  {#if tool.status === 'soon'}
                    <Badge variant="neutral">Coming soon</Badge>
                  {:else}
                    <Badge variant="available">Ready</Badge>
                  {/if}
                </div>
                <p class="text-xs text-text-muted leading-relaxed mb-3">{tool.description}</p>
                <div class="flex flex-wrap gap-1.5">
                  {#each tool.tags as tag}
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-text-secondary border border-border">
                      {tag}
                    </span>
                  {/each}
                </div>
              </Card>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
  </PageContent>
</div>
