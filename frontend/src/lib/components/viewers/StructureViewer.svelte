<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { liatir } from '$lib/api';
  import { THREEDMOL_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { getViewerRuntimeScriptUrl } from '$lib/viewers/runtime-loader';
  import type { StructureViewerSection } from '$lib/types/tool-output';

  let { section }: { section: StructureViewerSection } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let iframeSrcdoc = $state('');

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

  function validateStructureContent(content: string, format: StructureViewerSection['format']) {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Structure file is empty.');
    if (format === 'pdb' && !/(^|\n)(ATOM  |HETATM|MODEL |HEADER|COMPND|TITLE )/.test(trimmed)) {
      throw new Error('The selected file does not look like a PDB structure.');
    }
  }

  function createStructureFrame(scriptUrl: string, content: string): string {
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
  <script src="${scriptUrl}"><\/script>
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

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; viewerId?: string; message?: string } | null;
      if (!data || data.viewerId !== viewerId) return;
      if (data.type === 'liatir-structure-viewer-error') {
        error = data.message ?? 'Structure viewer failed.';
      }
    }

    async function render() {
      try {
        loading = true;
        error = null;
        const content = await loadStructureContent();
        validateStructureContent(content, section.format);
        const { url } = await getViewerRuntimeScriptUrl(THREEDMOL_RUNTIME_ID);
        if (disposed) return;
        iframeSrcdoc = createStructureFrame(url, content);
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
      window.removeEventListener('message', onMessage);
    };
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
      {#if section.path}
        <Button
          size="sm"
          variant="ghost"
          onclick={() => goto(`/tools/visualization/structure?file=${encodeURIComponent(section.path!)}`)}
        >
          Open page
        </Button>
      {/if}
      <span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500">
        {section.format}
      </span>
    </div>
  </div>

  <div
    class="relative overflow-hidden rounded-lg border border-border bg-white"
    style={`height: ${section.height ?? 420}px`}
  >
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
    {:else if iframeSrcdoc}
      <iframe
        title={section.label}
        srcdoc={iframeSrcdoc}
        class="absolute inset-0 h-full w-full border-0"
      ></iframe>
    {/if}
  </div>
</Card>
