<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';

  onMount(() => dataFiles.init());

  const EXT_COLOR: Record<string, string> = {
    'fastq':    'bg-emerald-100 text-emerald-700 border-emerald-200',
    'fastq.gz': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'bam':      'bg-sky-100 text-sky-700 border-sky-200',
    'vcf':      'bg-violet-100 text-violet-700 border-violet-200',
    'vcf.gz':   'bg-violet-100 text-violet-700 border-violet-200',
  };

  function extClass(ext: string): string {
    return EXT_COLOR[ext] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function truncatePath(path: string, maxLen = 52): string {
    if (path.length <= maxLen) return path;
    const parts = path.split(/[\\/]/);
    if (parts.length > 3) {
      return '…/' + parts.slice(-2).join('/');
    }
    return '…' + path.slice(-(maxLen - 1));
  }

  let importing = $state(false);
  let addingSample = $state(false);

  async function importFiles() {
    importing = true;
    try { await dataFiles.importFromPicker(); } finally { importing = false; }
  }

  async function addSample() {
    addingSample = true;
    try { await dataFiles.addSampleFastq(); } finally { addingSample = false; }
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Data" description="Files available to tools">
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={addSample} loading={addingSample}>
        Add sample FASTQ
      </Button>
      <Button variant="primary" size="sm" onclick={importFiles} loading={importing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Import file
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    {#if dataFiles.files.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center gap-3">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </div>
        <p class="text-sm font-medium text-zinc-700">No files yet</p>
        <p class="text-xs text-zinc-400 max-w-xs">
          Import files to make them available to tools like FastQC.
          Files are referenced by path — they stay where they are on disk.
        </p>
        <div class="flex gap-2 mt-1">
          <Button variant="secondary" size="sm" onclick={importFiles} loading={importing}>Import file</Button>
          <Button variant="ghost" size="sm" onclick={addSample} loading={addingSample}>Add sample FASTQ</Button>
        </div>
      </div>
    {:else}
      <Card>
        <div class="divide-y divide-border">
          {#each dataFiles.files as file (file.id)}
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="h-8 w-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-zinc-800 truncate">{file.name}</p>
                <p class="text-xs text-zinc-400 truncate" title={file.path}>{truncatePath(file.path)}</p>
              </div>

              <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border {extClass(file.ext)}">
                {file.ext || '?'}
              </span>

              <span class="shrink-0 text-xs text-zinc-400">{fmtDate(file.addedAt)}</span>

              <button
                onclick={() => dataFiles.remove(file.id)}
                aria-label="Remove"
                class="shrink-0 text-zinc-300 hover:text-red-500 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          {/each}
        </div>
      </Card>
    {/if}
  </div>
</div>
