<!--
	Genome track viewer, powered by JBrowse 2.

	Same two-tier design as the structure viewer: JBrowse runs inside a sandboxed iframe (built from a blob
	URL, with the library inlined as text), and if it cannot run, the component parses the tracks itself and
	draws a simple positional strip.

	The fallback is genuinely useful rather than a placeholder, because it plots the features at their real
	coordinates — a user can still see where their variants or genes lie, and how they line up across
	tracks. It is only available for the *text* formats (BED/GFF/VCF), which is what
	`canPreviewAllTracksLocally` tests: a BAM is binary and indexed, and there is no honest way to render it
	without the real runtime.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Button from '$lib/components/ui/Button.svelte';
  import VisualizationShell from '$lib/components/viewers/VisualizationShell.svelte';
  import { liatir } from '$lib/api';
  import { JBROWSE_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { localFileSrc, readViewerRuntimeScript } from '$lib/viewers/runtime-loader';
  import { isViewerProxyCompatibilityError, viewerRuntimeFailureMessage } from '$lib/viewers/runtime-errors';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { settingsStore } from '$lib/stores/settings.svelte';
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
  let jbrowseFrameUrl = $state('');
  let features = $state<Feature[]>([]);
  const viewerId = crypto.randomUUID();

  const refName = $derived(section.assembly.refName ?? '');
  // When the tool did not state a window, one is inferred from the features themselves — so the fallback
  // opens framed on the data rather than on an arbitrary stretch of empty genome.
  const visibleStart = $derived(section.assembly.start ?? inferStart(features));
  const visibleEnd = $derived(section.assembly.end ?? inferEnd(features, visibleStart));
  // Guards against a zero-width window, which would make the feature positioning divide by zero.
  const span = $derived(Math.max(1, visibleEnd - visibleStart));
  // The fallback can only render text formats it can parse itself. A BAM (binary, indexed) or a remote URL
  // has no honest local rendering, so in that case there is no fallback and JBrowse is required.
  const canPreviewAllTracksLocally = $derived(
    section.tracks.length > 0 &&
      section.tracks.every(track => Boolean(track.path) && ['bed', 'gff', 'vcf'].includes(track.kind))
  );
  const tracks = $derived(section.tracks.map(track => ({
    ...track,
    features: features.filter(feature => feature.track === track.name),
  })));

  // The window spans the features with a 50 bp margin, so nothing sits flush against the edge. With no
  // features at all, a nominal 0..1000 window is used rather than a degenerate empty one.
  function inferStart(items: Feature[]): number {
    const starts = items.map(item => item.start).filter(Number.isFinite);
    return starts.length ? Math.max(0, Math.min(...starts) - 50) : 0;
  }

  function inferEnd(items: Feature[], start: number): number {
    const ends = items.map(item => item.end).filter(Number.isFinite);
    return ends.length ? Math.max(start + 1, Math.max(...ends) + 50) : start + 1000;
  }

  /**
   * Extracts a display name from a GFF attributes column (`ID=x;Name=y;...`).
   *
   * The keys are tried in order of usefulness to a human: `Name` is what a biologist recognises, `ID` is a
   * fallback identifier, `gene_name` covers the GTF-style annotations that use it instead.
   */
  function parseAttributes(raw: string): string {
    const fields = raw.split(';').map(part => part.trim());
    for (const key of ['Name=', 'ID=', 'gene_name=']) {
      const found = fields.find(part => part.startsWith(key));
      if (found) return found.slice(key.length);
    }
    return '';
  }

  /**
   * Minimal parser for the three text track formats, used only by the fallback.
   *
   * All three are tab-delimited with `#` comment lines, but their columns differ, hence the per-format
   * branches. The column indices are from each format's specification:
   *   - BED: chrom / start / end / name
   *   - GFF: seqid / … / type / start / end / … / attributes
   *   - VCF: chrom / pos / id / ref / alt
   *
   * A VCF gives a single position rather than a range, so the feature's end is derived from the length of
   * the REF allele — which is what makes a deletion render as the span it actually covers rather than as a
   * point.
   */
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
      // Keep only the requested chromosome, when one was named — a whole-genome file would otherwise plot
      // features from every contig on top of each other.
      .filter(item => !refName || item.refName === refName)
      // Hard cap: an annotation file can hold millions of features, and this fallback renders one DOM
      // element per feature. 400 is the point past which the strip stops being readable anyway.
      .slice(0, 400);
  }

  /**
   * Positions a feature on the strip as a percentage of the visible window.
   *
   * `Math.max(0.7, …)` gives a minimum width: a single-base variant would otherwise compute to a width of
   * effectively zero and be invisible — which for a variant track is exactly the thing you need to see.
   * The `Math.min(100 - left, …)` keeps a feature that runs past the window from overflowing the strip.
   */
  function featureStyle(feature: Feature): string {
    const left = Math.max(0, Math.min(100, ((feature.start - visibleStart) / span) * 100));
    const width = Math.max(0.7, Math.min(100 - left, ((feature.end - feature.start) / span) * 100));
    return `left: ${left}%; width: ${width}%`;
  }

  // Escaping for the values embedded into the iframe's HTML. A `<` in the JSON, or a `</script` inside the
  // inlined library, would close the surrounding <script> tag early and let the rest be parsed as markup —
  // and the track data here comes from a user's own files.
  function escapeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function escapeInlineScript(source: string): string {
    return source.replace(/<\/script/gi, '<\\/script');
  }

  /** A remote URL is used as-is; a local path must go through Tauri's asset protocol to be fetchable. */
  function fileUri(path?: string, url?: string): string {
    if (url) return url;
    return path ? localFileSrc(path) : '';
  }

  /**
   * Builds the JBrowse adapter for a track — its declaration of how to read the file.
   *
   * The VCF branch is the one with substance: given an index, the *tabix* adapter is used, which lets
   * JBrowse seek into the region on screen instead of loading the whole file. Without an index it falls
   * back to reading the file whole, which is fine for a small VCF and hopeless for a large one. The index
   * type is inferred from the extension, since CSI and TBI are not interchangeable.
   */
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
      // JBrowse themes itself through MUI; `mode` is its own dark-mode switch
      // (supported since JBrowse 2.4), so the browser chrome follows the app
      // instead of being restyled from the outside.
      configuration: { theme: { mode: settingsStore.resolvedTheme } },
      ...(loc ? { location: loc } : {}),
    };
  }

  function createJBrowseFrame(scriptSource: string, config: unknown): string {
    const payload = escapeScriptJson({ viewerId, config });
    // The frame is a separate blob document, so it cannot inherit the app's CSS
    // variables: the host chrome around JBrowse takes literal colours matching
    // the theme JBrowse itself was configured with.
    const dark = settingsStore.resolvedTheme === 'dark';
    const frameBg = dark ? '#1c1c20' : '#fff';
    const messageColor = dark ? '#a1a1aa' : '#71717a';
    const errorColor = dark ? '#f87171' : '#dc2626';
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body, #jbrowse { height: 100%; width: 100%; margin: 0; overflow: hidden; background: ${frameBg}; }
    #message {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: ${messageColor};
      font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      box-sizing: border-box;
    }
    #message.error { color: ${errorColor}; }
  </style>
</head>
<body>
  <div id="jbrowse"></div>
  <div id="message">Loading JBrowse 2...</div>
  <script id="liatir-jbrowse-payload" type="application/json">${payload}<\/script>
  <script>${escapeInlineScript(scriptSource)}<\/script>
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
        const state = lib.createViewState(payload.config);
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

  // The live blob URL. Held here (not in onMount) because the frame is rebuilt
  // on theme change, and every replaced URL must be revoked or it leaks.
  let frameObjectUrl = '';

  function setFrameUrl(url: string) {
    if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
    frameObjectUrl = url;
    jbrowseFrameUrl = url;
  }

  function createFrameUrl(html: string): string {
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }

  function setJBrowseError(message: string) {
    if (canPreviewAllTracksLocally && isViewerProxyCompatibilityError(message)) {
      jbrowseError = null;
      return;
    }
    jbrowseError = viewerRuntimeFailureMessage(message, 'JBrowse 2');
  }

  async function initJBrowseFrame() {
    try {
      jbrowseError = null;
      const { source } = await readViewerRuntimeScript(JBROWSE_RUNTIME_ID);
      const config = buildJBrowseConfig();
      setFrameUrl(createFrameUrl(createJBrowseFrame(source, config)));
    } catch (err) {
      setFrameUrl('');
      setJBrowseError(err instanceof Error ? err.message : String(err));
    }
  }

  onMount(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; viewerId?: string; message?: string } | null;
      if (!data || data.viewerId !== viewerId) return;
      if (data.type === 'liatir-jbrowse-viewer-error') {
        setJBrowseError(data.message ?? 'JBrowse viewer failed.');
        setFrameUrl('');
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
    return () => {
      if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
      window.removeEventListener('message', onMessage);
    };
  });

  /**
   * JBrowse reads its theme once, at createViewState, so a theme change means
   * rebuilding the frame. This resets the browser's navigation position — an
   * accepted cost for a rare, deliberate user action. Guarded on an existing
   * frame so it never races the initial mount load.
   */
  let lastFrameTheme = settingsStore.resolvedTheme;
  $effect(() => {
    const theme = settingsStore.resolvedTheme;
    if (theme === lastFrameTheme) return;
    lastFrameTheme = theme;
    if (!frameObjectUrl) return;
    void initJBrowseFrame();
  });
</script>

<VisualizationShell
  title={section.label}
  description={section.description}
  badge={section.assembly.name}
  height={section.height ?? 420}
  openHref={section.tracks[0]?.path ? `/tools/visualization/genome?track=${encodeURIComponent(section.tracks[0].path)}${section.assembly.fastaPath ? `&reference=${encodeURIComponent(section.assembly.fastaPath)}` : ''}` : undefined}
>
  <div class="h-full overflow-auto bg-surface">
    {#if jbrowseFrameUrl}
      <iframe
        title={section.label}
        src={jbrowseFrameUrl}
        sandbox="allow-scripts"
        class="h-full min-h-[320px] w-full border-0"
      ></iframe>
    {:else if jbrowseError && !loading && !error}
      <div class="m-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        {#if jbrowseError.includes('not installed')}
          Full JBrowse 2 rendering requires the optional JBrowse 2 runtime.
          <Button size="sm" variant="secondary" class="ml-2" onclick={() => goto('/deps')}>
            Open Dependencies
          </Button>
        {:else}
          {sanitizeLocalPathsForDisplay(jbrowseError, 2)}
        {/if}
      </div>
    {/if}

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
      <div class="px-4 py-10 text-center text-xs text-red-600">{sanitizeLocalPathsForDisplay(error, 2)}</div>
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
</VisualizationShell>
