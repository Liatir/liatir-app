<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { liatir } from '$lib/api';
  import { JBROWSE_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { getViewerRuntimeScriptUrl, localFileSrc } from '$lib/viewers/runtime-loader';
  import type { GenomeViewerSection } from '$lib/types/tool-output';

  let { section }: { section: GenomeViewerSection } = $props();

  interface Feature {
    track: string;
    label: string;
    refName: string;
    start: number;
    end: number;
    kind: string;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let jbrowseError = $state<string | null>(null);
  let jbrowseSrcdoc = $state('');
  let features = $state<Feature[]>([]);
  const viewerId = crypto.randomUUID();

  const refName = $derived(section.assembly.refName ?? '');
  const visibleStart = $derived(section.assembly.start ?? inferStart(features));
  const visibleEnd = $derived(section.assembly.end ?? inferEnd(features, visibleStart));
  const span = $derived(Math.max(1, visibleEnd - visibleStart));
  const tracks = $derived(section.tracks.map(track => ({
    ...track,
    features: features.filter(feature => feature.track === track.name),
  })));

  function inferStart(items: Feature[]): number {
    const starts = items.map(item => item.start).filter(Number.isFinite);
    return starts.length ? Math.max(0, Math.min(...starts) - 50) : 0;
  }

  function inferEnd(items: Feature[], start: number): number {
    const ends = items.map(item => item.end).filter(Number.isFinite);
    return ends.length ? Math.max(start + 1, Math.max(...ends) + 50) : start + 1000;
  }

  function parseAttributes(raw: string): string {
    const fields = raw.split(';').map(part => part.trim());
    for (const key of ['Name=', 'ID=', 'gene_name=']) {
      const found = fields.find(part => part.startsWith(key));
      if (found) return found.slice(key.length);
    }
    return '';
  }

  function parseTrackText(trackName: string, kind: string, text: string): Feature[] {
    const parsed: Feature[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const cols = trimmed.split('\t');

      if (kind === 'bed' && cols.length >= 3) {
        const start = Number(cols[1]);
        const end = Number(cols[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        parsed.push({
          track: trackName,
          label: cols[3] || `${cols[0]}:${start}-${end}`,
          refName: cols[0],
          start,
          end,
          kind: 'BED',
        });
      } else if (kind === 'gff' && cols.length >= 9) {
        const start = Number(cols[3]);
        const end = Number(cols[4]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        parsed.push({
          track: trackName,
          label: parseAttributes(cols[8]) || cols[2] || `${cols[0]}:${start}-${end}`,
          refName: cols[0],
          start,
          end,
          kind: cols[2] || 'GFF',
        });
      } else if (kind === 'vcf' && cols.length >= 5) {
        const pos = Number(cols[1]);
        if (!Number.isFinite(pos)) continue;
        parsed.push({
          track: trackName,
          label: cols[2] && cols[2] !== '.' ? cols[2] : `${cols[3]}>${cols[4]}`,
          refName: cols[0],
          start: pos,
          end: pos + Math.max(1, cols[3]?.length ?? 1),
          kind: 'VCF',
        });
      }
    }
    return parsed
      .filter(item => !refName || item.refName === refName)
      .slice(0, 400);
  }

  function featureStyle(feature: Feature): string {
    const left = Math.max(0, Math.min(100, ((feature.start - visibleStart) / span) * 100));
    const width = Math.max(0.7, Math.min(100 - left, ((feature.end - feature.start) / span) * 100));
    return `left: ${left}%; width: ${width}%`;
  }

  function escapeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function fileUri(path?: string, url?: string): string {
    if (url) return url;
    return path ? localFileSrc(path) : '';
  }

  function buildTrackAdapter(track: GenomeViewerSection['tracks'][number]) {
    const uri = fileUri(track.path, track.url);
    if (!uri) throw new Error(`Track "${track.name}" has no readable file path or URL.`);
    if (track.kind === 'gff') return { type: 'Gff3Adapter', uri };
    if (track.kind === 'bed') return { type: 'BedAdapter', uri };
    if (track.kind === 'vcf') {
      const indexUri = fileUri(track.indexPath, track.indexUrl);
      return indexUri
        ? { type: 'VcfTabixAdapter', uri, index: { location: { uri: indexUri }, indexType: indexUri.endsWith('.csi') ? 'CSI' : 'TBI' } }
        : { type: 'VcfAdapter', uri };
    }
    if (track.kind === 'bam') {
      const indexUri = fileUri(track.indexPath, track.indexUrl);
      if (!indexUri) throw new Error(`BAM track "${track.name}" requires a BAI or CSI index for full JBrowse rendering.`);
      return { type: 'BamAdapter', uri, index: { location: { uri: indexUri }, indexType: indexUri.endsWith('.csi') ? 'CSI' : 'BAI' } };
    }
    throw new Error(`Track "${track.name}" uses an unsupported full-browser format: ${track.kind}.`);
  }

  function buildJBrowseConfig() {
    const assemblyName = section.assembly.name || 'local assembly';
    const fastaUri = fileUri(section.assembly.fastaPath, section.assembly.fastaUrl);
    const assembly: Record<string, unknown> = { name: assemblyName };
    if (fastaUri) {
      assembly.sequence = {
        type: 'ReferenceSequenceTrack',
        trackId: `${assemblyName}-reference`,
        adapter: { type: 'UnindexedFastaAdapter', uri: fastaUri },
      };
    }

    const trackConfigs = section.tracks
      .filter(track => track.kind !== 'unknown')
      .map((track, index) => ({
        type: track.kind === 'bam' ? 'AlignmentsTrack' : track.kind === 'vcf' ? 'VariantTrack' : 'FeatureTrack',
        trackId: `liatir-track-${index}`,
        name: track.name,
        assemblyNames: [assemblyName],
        adapter: buildTrackAdapter(track),
      }));

    if (trackConfigs.length === 0) {
      throw new Error('No supported tracks are available for full JBrowse rendering.');
    }

    const loc = section.assembly.refName
      ? section.assembly.start != null && section.assembly.end != null
        ? `${section.assembly.refName}:${Math.max(1, Math.round(section.assembly.start))}..${Math.max(1, Math.round(section.assembly.end))}`
        : section.assembly.refName
      : undefined;

    return {
      assembly,
      tracks: trackConfigs,
      ...(loc ? { location: loc } : {}),
    };
  }

  function createJBrowseFrame(scriptUrl: string, config: unknown): string {
    const payload = escapeScriptJson({ viewerId, config });
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body, #jbrowse { height: 100%; width: 100%; margin: 0; overflow: hidden; background: #fff; }
    #message {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #71717a;
      font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      box-sizing: border-box;
    }
    #message.error { color: #dc2626; }
  </style>
</head>
<body>
  <div id="jbrowse"></div>
  <div id="message">Loading JBrowse 2...</div>
  <script id="liatir-jbrowse-payload" type="application/json">${payload}<\/script>
  <script src="${scriptUrl}"><\/script>
  <script>
    (function () {
      const message = document.getElementById('message');
      let payload = { viewerId: '${viewerId}' };
      function fail(error) {
        const text = error && error.message ? error.message : String(error || 'JBrowse viewer failed.');
        message.textContent = text;
        message.className = 'error';
        window.parent.postMessage({ type: 'liatir-jbrowse-viewer-error', viewerId: payload.viewerId, message: text }, '*');
      }
      try {
        payload = JSON.parse(document.getElementById('liatir-jbrowse-payload').textContent || '{}');
        const lib = window.JBrowseReactLinearGenomeView;
        if (!lib || !lib.React || !lib.createRoot || !lib.createViewState || !lib.JBrowseLinearGenomeView) {
          throw new Error('JBrowse 2 did not expose the embedded linear genome view runtime.');
        }
        const state = new lib.createViewState(payload.config);
        const root = lib.createRoot(document.getElementById('jbrowse'));
        root.render(lib.React.createElement(lib.JBrowseLinearGenomeView, { viewState: state }));
        message.remove();
        window.parent.postMessage({ type: 'liatir-jbrowse-viewer-ready', viewerId: payload.viewerId }, '*');
      } catch (error) {
        fail(error);
      }
    })();
  <\/script>
</body>
</html>`;
  }

  async function initJBrowseFrame() {
    try {
      jbrowseError = null;
      const { url } = await getViewerRuntimeScriptUrl(JBROWSE_RUNTIME_ID);
      const config = buildJBrowseConfig();
      jbrowseSrcdoc = createJBrowseFrame(url, config);
    } catch (err) {
      jbrowseSrcdoc = '';
      jbrowseError = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; viewerId?: string; message?: string } | null;
      if (!data || data.viewerId !== viewerId) return;
      if (data.type === 'liatir-jbrowse-viewer-error') {
        jbrowseError = data.message ?? 'JBrowse viewer failed.';
      }
    }
    window.addEventListener('message', onMessage);

    async function loadTracks() {
      const api = liatir();
      if (!api) {
        loading = false;
        error = 'Liatir API not available.';
        return;
      }

      try {
        const next: Feature[] = [];
        for (const track of section.tracks) {
          if (!track.path || !['bed', 'gff', 'vcf'].includes(track.kind)) continue;
          const text = await api.invoke('lia_read_file_text', { path: track.path }) as string;
          next.push(...parseTrackText(track.name, track.kind, text));
        }
        features = next;
        await initJBrowseFrame();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    }

    void loadTracks();
    return () => window.removeEventListener('message', onMessage);
  });
</script>

<Card class="p-4">
  <div class="mb-3 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-xs font-medium text-zinc-500">{section.label}</p>
      {#if section.description}
        <p class="mt-1 text-[11px] text-zinc-400">{section.description}</p>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if section.tracks[0]?.path}
        <Button
          size="sm"
          variant="ghost"
          onclick={() => goto(`/tools/visualization/genome?track=${encodeURIComponent(section.tracks[0].path!)}${section.assembly.fastaPath ? `&reference=${encodeURIComponent(section.assembly.fastaPath)}` : ''}`)}
        >
          Open page
        </Button>
      {/if}
      <span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
        {section.assembly.name}
      </span>
    </div>
  </div>

  {#if jbrowseSrcdoc}
    <div class="mb-3 overflow-hidden rounded-lg border border-border bg-white" style={`height: ${section.height ?? 420}px`}>
      <iframe title={section.label} srcdoc={jbrowseSrcdoc} class="h-full w-full border-0"></iframe>
    </div>
  {:else if jbrowseError && !loading && !error}
    <div class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      {#if jbrowseError.includes('not installed')}
        Full JBrowse 2 rendering requires the optional JBrowse 2 runtime.
        <Button size="sm" variant="secondary" class="ml-2" onclick={() => goto('/deps')}>
          Open Dependencies
        </Button>
      {:else}
        {jbrowseError}
      {/if}
    </div>
  {/if}

  <div class="rounded-lg border border-border bg-white" style={`min-height: ${section.height ?? 320}px`}>
    <div class="border-b border-border bg-zinc-50 px-3 py-2">
      <div class="flex items-center justify-between gap-3 text-[10px] font-mono text-zinc-500">
        <span>{refName || 'region'}:{Math.round(visibleStart).toLocaleString()}</span>
        <span>{Math.round(visibleEnd).toLocaleString()}</span>
      </div>
      <div class="mt-1 h-1 rounded-full bg-zinc-200"></div>
    </div>

    {#if loading}
      <div class="px-4 py-10 text-center text-xs text-zinc-400">Loading genome tracks...</div>
    {:else if error}
      <div class="px-4 py-10 text-center text-xs text-red-600">{error}</div>
    {:else if tracks.length === 0}
      <div class="px-4 py-10 text-center text-xs text-zinc-400">No tracks configured.</div>
    {:else}
      <div class="divide-y divide-border/70">
        {#each tracks as track}
          <div class="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-3 py-3">
            <div class="min-w-0">
              <p class="truncate text-xs font-medium text-zinc-700">{track.name}</p>
              <p class="mt-0.5 text-[10px] uppercase text-zinc-400">{track.kind}</p>
            </div>
            <div class="relative h-12 rounded border border-zinc-100 bg-zinc-50">
              {#if track.features.length === 0}
                <div class="absolute inset-0 flex items-center px-3 text-[10px] text-zinc-400">
                  No text preview for this track.
                </div>
              {:else}
                {#each track.features as feature}
                  <div
                    class="absolute top-3 h-5 rounded bg-brand/70"
                    style={featureStyle(feature)}
                    title={`${feature.label} ${feature.refName}:${feature.start}-${feature.end}`}
                  ></div>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Card>
