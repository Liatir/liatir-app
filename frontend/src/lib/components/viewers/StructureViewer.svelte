<!--
	3D molecular structure viewer, powered by 3Dmol.js.

	Two design decisions dominate this file.

	**It runs inside an iframe, not in the page.** The 3Dmol.js source is read as *text* and inlined
	into a self-contained HTML document served from a blob URL. That sandboxes a large third-party
	library away from the app: it cannot reach Liatir's DOM, its stores, or the Tauri bridge. The price
	is that everything it needs — the library, the structure, the display options — must be serialised
	into that document, which is what the escaping helpers below exist for, and errors have to come back
	across the boundary via postMessage.

	**There is a real fallback.** If 3Dmol.js cannot run in this webview, the component parses the PDB
	itself and draws a flat SVG projection of the atoms. It is not a pretty picture, but it is an honest
	one: the coordinates are the file's own, so the user sees their actual structure rather than an
	error where their result should be.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Button from '$lib/components/ui/Button.svelte';
  import VisualizationShell from '$lib/components/viewers/VisualizationShell.svelte';
  import { liatir } from '$lib/api';
  import { THREEDMOL_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { readViewerRuntimeScript } from '$lib/viewers/runtime-loader';
  import { isViewerProxyCompatibilityError, viewerRuntimeFailureMessage } from '$lib/viewers/runtime-errors';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import type { StructureViewerSection } from '$lib/types/tool-output';

  let { section }: { section: StructureViewerSection } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let runtimeWarning = $state<string | null>(null);
  let frameUrl = $state('');
  let fallbackContent = $state('');
  /** The iframe reported that 3Dmol actually drew the structure, not merely that the frame exists. */
  let ready = $state(false);

  // Identifies *this* viewer instance, so a postMessage from one iframe is not acted on by another
  // structure viewer rendered on the same page.
  const viewerId = crypto.randomUUID();

  /** 3Dmol calls the mmCIF format `cif`; Liatir distinguishes them. Translated at the boundary. */
  function normalizeFormat(format: StructureViewerSection['format']): string {
    if (format === 'mmcif') return 'cif';
    return format;
  }

  /**
   * Maps Liatir's style/colour options onto 3Dmol's own style object.
   *
   * `Jmol` is 3Dmol's standard element-colour palette (carbon grey, oxygen red, …) — the colouring a
   * chemist expects. `spectrum` colours along the chain instead, which is what makes secondary
   * structure legible in a cartoon view.
   */
  function styleFor(sectionStyle?: StructureViewerSection['style'], colorScheme?: StructureViewerSection['colorScheme']) {
    const style = sectionStyle ?? 'cartoon';
    const color = colorScheme === 'element' ? 'Jmol' : 'spectrum';
    if (style === 'stick') return { stick: { colorscheme: color } };
    if (style === 'line') return { line: { colorscheme: color } };
    if (style === 'sphere') return { sphere: { colorscheme: color } };
    return { cartoon: { color: colorScheme === 'chain' ? 'spectrum' : color } };
  }

  /**
   * Escaping for the two things embedded into the iframe's HTML — and both are load-bearing.
   *
   * The structure content is a *user's file*, so it is untrusted input being written into a document.
   * `<` is escaped in the JSON payload, and `</script` is broken up in the inlined library, because
   * either sequence appearing verbatim would terminate the surrounding `<script>` tag early and let
   * whatever follows be parsed as markup.
   */
  function escapeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function escapeInlineScript(source: string): string {
    return source.replace(/<\/script/gi, '<\\/script');
  }

  /**
   * Rejects a file that is not a structure, before handing it to the viewer.
   *
   * Without this, feeding (say) a FASTA to the structure viewer produces an empty canvas and no
   * explanation. The PDB check looks for the record types every real PDB file begins lines with — a
   * cheap test that catches the mistake and names it.
   */
  function validateStructureContent(content: string, format: StructureViewerSection['format']) {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Structure file is empty.');
    if (format === 'pdb' && !/(^|\n)(ATOM  |HETATM|MODEL |HEADER|COMPND|TITLE )/.test(trimmed)) {
      throw new Error('The selected file does not look like a PDB structure.');
    }
  }

  interface PdbAtom {
    serial: number;
    name: string;
    residue: string;
    chain: string;
    x: number;
    y: number;
    z: number;
    element: string;
  }

  /**
   * Minimal PDB parser, for the fallback renderer only.
   *
   * PDB is a **fixed-column** format, not a delimited one — the meaning of a field is its byte range,
   * and splitting on whitespace would be wrong (a name can be padded, a field can be blank). Hence the
   * `slice` offsets, which are taken straight from the PDB specification.
   *
   * Only ATOM and HETATM lines carry coordinates; everything else in the file is ignored. Atoms whose
   * coordinates do not parse are dropped rather than plotted at NaN.
   */
  function parsePdbAtoms(content: string): PdbAtom[] {
    return content.split(/\r?\n/)
      .filter(line => line.startsWith('ATOM') || line.startsWith('HETATM'))
      .map((line) => ({
        serial: Number(line.slice(6, 11).trim()) || 0,
        name: line.slice(12, 16).trim(),
        residue: line.slice(17, 20).trim(),
        chain: line.slice(21, 22).trim(),
        x: Number(line.slice(30, 38).trim()),
        y: Number(line.slice(38, 46).trim()),
        z: Number(line.slice(46, 54).trim()),
        // The element column is optional in older files; fall back to inferring it from the atom name.
        element: line.slice(76, 78).trim() || line.slice(12, 14).trim(),
      }))
      .filter(atom => Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z));
  }

  const fallbackAtoms = $derived(parsePdbAtoms(fallbackContent));
  const fallbackBounds = $derived.by(() => {
    if (fallbackAtoms.length === 0) return null;
    const xs = fallbackAtoms.map(atom => atom.x);
    const ys = fallbackAtoms.map(atom => atom.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });

  /**
   * CPK-style element colours for the fallback: nitrogen blue, oxygen red, sulfur yellow, phosphorus
   * purple, hydrogen grey, everything else (carbon and the rest) dark grey. These are the conventional
   * colours, so the fallback still reads as chemistry rather than as an arbitrary dot plot.
   */
  function atomColor(element: string): string {
    const normalized = element.toUpperCase();
    if (normalized === 'N') return '#2563eb';
    if (normalized === 'O') return '#dc2626';
    if (normalized === 'S') return '#ca8a04';
    if (normalized === 'P') return '#9333ea';
    if (normalized === 'H') return '#a1a1aa';
    return '#52525b';
  }

  /**
   * Projects an atom onto the 2D fallback canvas: drop the Z axis, then scale X/Y into a 0-100 box.
   *
   * A flat orthographic projection, not a rendering — it conveys the molecule's shape and extent
   * without any 3D machinery. `Math.max(1, …)` guards against a zero span (a single atom, or a planar
   * molecule) producing a division by zero.
   */
  function atomPoint(atom: PdbAtom): { x: number; y: number } {
    if (!fallbackBounds) return { x: 50, y: 50 };
    const pad = 10;
    const width = Math.max(1, fallbackBounds.maxX - fallbackBounds.minX);
    const height = Math.max(1, fallbackBounds.maxY - fallbackBounds.minY);
    return {
      x: pad + ((atom.x - fallbackBounds.minX) / width) * (100 - pad * 2),
      y: pad + ((atom.y - fallbackBounds.minY) / height) * (100 - pad * 2),
    };
  }

  /** The iframe is fed from a blob URL, so its document has an opaque origin and no access to ours. */
  function createFrameUrl(html: string): string {
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }

  /**
   * Surfaces a runtime failure — but stays quiet when the fallback has already rendered something.
   *
   * If 3Dmol hit the known webview incompatibility *and* the SVG fallback drew real atoms, the user is
   * looking at their structure. Warning them about an internal failure they cannot act on, and whose
   * consequence they cannot see, would be noise.
   */
  function setRuntimeWarning(message: string) {
    if (fallbackAtoms.length > 0 && isViewerProxyCompatibilityError(message)) {
      runtimeWarning = null;
      return;
    }
    runtimeWarning = viewerRuntimeFailureMessage(message, '3Dmol.js');
  }

  /**
   * Which of the viewer's states is on screen, as one readable value.
   *
   * `runtime-loading` and `runtime-ready` are deliberately separate: the iframe exists as soon as the
   * document is built, but only its ready message proves 3Dmol drew the structure inside it. Across
   * the sandbox boundary that message is the single piece of evidence available.
   */
  const viewerState = $derived(
    loading ? 'loading'
      : error ? 'error'
        : frameUrl ? (ready ? 'runtime-ready' : 'runtime-loading')
          : fallbackAtoms.length > 0 ? 'fallback'
            : 'empty',
  );

  /**
   * Builds the sandboxed document: the payload as JSON, the 3Dmol library inlined, and a bootstrap
   * script that renders it. Failures inside the iframe are reported back to this component by
   * postMessage — an exception thrown in there cannot otherwise be observed out here.
   */
  function createStructureFrame(scriptSource: string, content: string): string {
    const payload = escapeScriptJson({
      viewerId,
      content,
      format: normalizeFormat(section.format),
      style: styleFor(section.style, section.colorScheme),
    });
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body, #viewer { height: 100%; margin: 0; overflow: hidden; background: #fff; }
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
  <div id="viewer"></div>
  <div id="message">Loading structure...</div>
  <script id="liatir-structure-payload" type="application/json">${payload}<\/script>
  <script>${escapeInlineScript(scriptSource)}<\/script>
  <script>
    (function () {
      const message = document.getElementById('message');
      let payload = { viewerId: '${viewerId}' };
      function fail(error) {
        const text = error && error.message ? error.message : String(error || 'Structure viewer failed.');
        message.textContent = text;
        message.className = 'error';
        window.parent.postMessage({ type: 'liatir-structure-viewer-error', viewerId: payload.viewerId, message: text }, '*');
      }
      try {
        payload = JSON.parse(document.getElementById('liatir-structure-payload').textContent || '{}');
        const threeDmol = window.$3Dmol;
        if (!threeDmol || typeof threeDmol.createViewer !== 'function') {
          throw new Error('3Dmol.js did not expose a viewer runtime.');
        }
        const root = document.getElementById('viewer');
        const viewer = threeDmol.createViewer(root, { backgroundColor: 'white' });
        viewer.addModel(payload.content, payload.format);
        viewer.setStyle({}, payload.style);
        viewer.zoomTo();
        viewer.render();
        window.addEventListener('resize', function () {
          try {
            viewer.resize();
            viewer.render();
          } catch (_) {}
        });
        message.remove();
        window.parent.postMessage({ type: 'liatir-structure-viewer-ready', viewerId: payload.viewerId }, '*');
      } catch (error) {
        fail(error);
      }
    })();
  <\/script>
</body>
</html>`;
  }

  async function loadStructureContent(): Promise<string> {
    if (section.content) return section.content;
    if (!section.path) throw new Error('No structure content or file path was provided.');
    const api = liatir();
    if (!api) throw new Error('Liatir API not available.');
    return await api.invoke('lia_read_file_text', { path: section.path }) as string;
  }

  onMount(() => {
    let disposed = false;
    let objectUrl = '';

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; viewerId?: string; message?: string } | null;
      if (!data || data.viewerId !== viewerId) return;
      if (data.type === 'liatir-structure-viewer-ready') {
        ready = true;
        return;
      }
      if (data.type === 'liatir-structure-viewer-error') {
        setRuntimeWarning(data.message ?? 'Structure viewer failed.');
        frameUrl = '';
        ready = false;
      }
    }

    async function render() {
      try {
        loading = true;
        error = null;
        runtimeWarning = null;
        ready = false;
        const content = await loadStructureContent();
        fallbackContent = content;
        validateStructureContent(content, section.format);
        const { source } = await readViewerRuntimeScript(THREEDMOL_RUNTIME_ID);
        if (disposed) return;
        objectUrl = createFrameUrl(createStructureFrame(source, content));
        frameUrl = objectUrl;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    }

    window.addEventListener('message', onMessage);
    void render();

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.removeEventListener('message', onMessage);
    };
  });
</script>

<VisualizationShell
  title={section.label}
  description={section.description}
  badge={section.format}
  height={section.height ?? 420}
  openHref={section.path ? `/tools/visualization/structure?file=${encodeURIComponent(section.path)}` : undefined}
>
  <div class="relative h-full overflow-hidden bg-white" data-testid="structure-viewer" data-state={viewerState}>
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
        Loading structure...
      </div>
    {:else if error}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-xs text-red-600">
        <p data-testid="structure-viewer-error">{sanitizeLocalPathsForDisplay(error, 2)}</p>
        {#if error.includes('not installed')}
          <Button size="sm" variant="secondary" onclick={() => goto('/deps')}>
            Open Dependencies
          </Button>
        {/if}
      </div>
    {:else if frameUrl}
      <iframe
        title={section.label}
        src={frameUrl}
        sandbox="allow-scripts"
        class="absolute inset-0 h-full w-full border-0"
        data-testid="structure-viewer-frame"
      ></iframe>
    {:else if fallbackAtoms.length > 0}
      <div class="absolute inset-0">
        <svg viewBox="0 0 100 100" class="h-full w-full bg-white" data-testid="structure-fallback">
          {#each fallbackAtoms as atom}
            {@const point = atomPoint(atom)}
            <circle
              data-testid="structure-fallback-atom"
              cx={point.x}
              cy={point.y}
              r={atom.name === 'CA' ? 1.7 : 1.15}
              fill={atomColor(atom.element)}
              opacity={atom.name === 'CA' ? 0.95 : 0.72}
            >
              <title>{atom.name} {atom.residue}{atom.chain ? ` chain ${atom.chain}` : ''} · {atom.x.toFixed(2)}, {atom.y.toFixed(2)}, {atom.z.toFixed(2)}</title>
            </circle>
          {/each}
        </svg>
        {#if runtimeWarning}
          <div
            class="absolute bottom-3 left-3 right-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            data-testid="structure-viewer-runtime-warning"
          >
            3Dmol.js runtime failed, showing lightweight PDB preview. {sanitizeLocalPathsForDisplay(runtimeWarning, 2)}
          </div>
        {/if}
      </div>
    {/if}

    {#if !loading && !error}
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.16]"
        style="background-image: linear-gradient(to right, #d4d4d8 1px, transparent 1px), linear-gradient(to bottom, #d4d4d8 1px, transparent 1px); background-size: 42px 42px;"
      ></div>
      <div class="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-zinc-200 bg-white/85 px-2 py-1.5 shadow-sm backdrop-blur">
        <svg width="54" height="42" viewBox="0 0 54 42" aria-hidden="true">
          <line x1="12" y1="30" x2="42" y2="30" stroke="#ef4444" stroke-width="2" stroke-linecap="round" />
          <line x1="12" y1="30" x2="12" y2="8" stroke="#22c55e" stroke-width="2" stroke-linecap="round" />
          <line x1="12" y1="30" x2="31" y2="14" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" />
          <text x="45" y="33" font-size="8" fill="#ef4444" font-family="monospace">X</text>
          <text x="8" y="8" font-size="8" fill="#22c55e" font-family="monospace">Y</text>
          <text x="33" y="14" font-size="8" fill="#3b82f6" font-family="monospace">Z</text>
        </svg>
      </div>
    {/if}
  </div>
</VisualizationShell>
