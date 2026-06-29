<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Button from '$lib/components/ui/Button.svelte';
  import VisualizationShell from '$lib/components/viewers/VisualizationShell.svelte';
  import { liatir } from '$lib/api';
  import { THREEDMOL_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { readViewerRuntimeScript } from '$lib/viewers/runtime-loader';
  import type { StructureViewerSection } from '$lib/types/tool-output';

  let { section }: { section: StructureViewerSection } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let runtimeWarning = $state<string | null>(null);
  let frameUrl = $state('');
  let fallbackContent = $state('');
  let frameEl: HTMLIFrameElement | null = $state(null);

  const viewerId = crypto.randomUUID();

  function normalizeFormat(format: StructureViewerSection['format']): string {
    if (format === 'mmcif') return 'cif';
    return format;
  }

  function styleFor(sectionStyle?: StructureViewerSection['style'], colorScheme?: StructureViewerSection['colorScheme']) {
    const style = sectionStyle ?? 'cartoon';
    const color = colorScheme === 'element' ? 'Jmol' : 'spectrum';
    if (style === 'stick') return { stick: { colorscheme: color } };
    if (style === 'line') return { line: { colorscheme: color } };
    if (style === 'sphere') return { sphere: { colorscheme: color } };
    return { cartoon: { color: colorScheme === 'chain' ? 'spectrum' : color } };
  }

  function escapeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function escapeInlineScript(source: string): string {
    return source.replace(/<\/script/gi, '<\\/script');
  }

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

  function atomColor(element: string): string {
    const normalized = element.toUpperCase();
    if (normalized === 'N') return '#2563eb';
    if (normalized === 'O') return '#dc2626';
    if (normalized === 'S') return '#ca8a04';
    if (normalized === 'P') return '#9333ea';
    if (normalized === 'H') return '#a1a1aa';
    return '#52525b';
  }

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

  function createFrameUrl(html: string): string {
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function captureStructureScreenshot() {
    if (!frameEl?.contentWindow) throw new Error('Structure viewer is not ready.');

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onCaptureMessage);
        reject(new Error('Structure screenshot timed out.'));
      }, 3000);

      function onCaptureMessage(event: MessageEvent) {
        const data = event.data as {
          type?: string;
          viewerId?: string;
          dataUrl?: string;
          message?: string;
        } | null;
        if (!data || data.viewerId !== viewerId) return;
        if (data.type !== 'liatir-structure-viewer-screenshot-result') return;

        window.clearTimeout(timeout);
        window.removeEventListener('message', onCaptureMessage);
        if (data.dataUrl) {
          downloadDataUrl(data.dataUrl, `${section.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'structure'}.png`);
          resolve();
        } else {
          reject(new Error(data.message ?? 'Structure screenshot failed.'));
        }
      }

      window.addEventListener('message', onCaptureMessage);
      frameEl?.contentWindow?.postMessage({ type: 'liatir-structure-viewer-screenshot', viewerId }, '*');
    });
  }

  function runtimeFailureMessage(message: string): string {
    if (message.includes("Proxy handler's 'get' result")) {
      return 'The embedded 3D runtime is not compatible with this webview context.';
    }
    return message;
  }

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
        window.addEventListener('message', function (event) {
          const request = event.data || {};
          if (request.type !== 'liatir-structure-viewer-screenshot' || request.viewerId !== payload.viewerId) return;
          try {
            viewer.render();
            const dataUrl = typeof viewer.pngURI === 'function' ? viewer.pngURI() : '';
            if (!dataUrl) throw new Error('3Dmol.js did not return an image.');
            window.parent.postMessage({ type: 'liatir-structure-viewer-screenshot-result', viewerId: payload.viewerId, dataUrl }, '*');
          } catch (error) {
            const text = error && error.message ? error.message : String(error || 'Structure screenshot failed.');
            window.parent.postMessage({ type: 'liatir-structure-viewer-screenshot-result', viewerId: payload.viewerId, message: text }, '*');
          }
        });
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
      if (data.type === 'liatir-structure-viewer-error') {
        runtimeWarning = runtimeFailureMessage(data.message ?? 'Structure viewer failed.');
        frameUrl = '';
      }
    }

    async function render() {
      try {
        loading = true;
        error = null;
        runtimeWarning = null;
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
  oncapture={frameUrl ? captureStructureScreenshot : undefined}
>
  <div class="relative h-full overflow-hidden bg-white">
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
        Loading structure...
      </div>
    {:else if error}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-xs text-red-600">
        <p>{error}</p>
        {#if error.includes('not installed')}
          <Button size="sm" variant="secondary" onclick={() => goto('/deps')}>
            Open Dependencies
          </Button>
        {/if}
      </div>
    {:else if frameUrl}
      <iframe
        bind:this={frameEl}
        title={section.label}
        src={frameUrl}
        sandbox="allow-scripts"
        class="absolute inset-0 h-full w-full border-0"
      ></iframe>
    {:else if fallbackAtoms.length > 0}
      <div class="absolute inset-0">
        <svg viewBox="0 0 100 100" class="h-full w-full bg-white">
          {#each fallbackAtoms as atom}
            {@const point = atomPoint(atom)}
            <circle
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
          <div class="absolute bottom-3 left-3 right-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            3Dmol.js runtime failed, showing lightweight PDB preview. {runtimeWarning}
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
