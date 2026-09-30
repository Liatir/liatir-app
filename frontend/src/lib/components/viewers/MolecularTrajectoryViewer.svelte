<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import StructureViewer from './StructureViewer.svelte';
  import { liatir } from '$lib/api';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { THREEDMOL_RUNTIME_ID } from '$lib/viewers/runtime-registry';
  import { readViewerRuntimeScript } from '$lib/viewers/runtime-loader';
  import { sandboxDocument } from '$lib/viewers/sandbox-frame';
  import type { MolecularTrajectoryViewerSection, StructureViewerSection } from '$lib/types/tool-output';
  import type { ParsedDcdTrajectory } from '$lib/viewers/dcd';

  let { section }: { section: MolecularTrajectoryViewerSection } = $props();
  let loading = $state(false);
  let error = $state<string | null>(null);
  let runtimeWarning = $state<string | null>(null);
  let topology = $state('');
  let trajectory = $state<ParsedDcdTrajectory | null>(null);
  let currentFrame = $state(0);
  let playing = $state(false);
  let viewerReady = $state(false);
  let frameHtml = $state('');
  let frameContent = $state('');
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameAsPdb: ((topology: string, coordinates: Float32Array) => string) | null = null;

  const viewerId = crypto.randomUUID();
  // The native read is explicitly user-triggered and bounded. Base64 and the webview each make a
  // copy, so a lower cap is safer than accepting an arbitrary simulation output into UI memory.
  const MAX_TRAJECTORY_BYTES = 134_217_728;
  const MAX_TOPOLOGY_BYTES = 33_554_432;
  const displayedSourceFrame = $derived(trajectory?.sampledFrameIndexes[currentFrame] ?? 0);

  function decodeBase64(dataBase64: string): Uint8Array {
    const binary = atob(dataBase64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function escapeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function escapeInlineScript(source: string): string {
    return source.replace(/<\/script/gi, '<\\/script');
  }

  function styleFor() {
    const style = section.style ?? 'cartoon';
    const color = section.colorScheme === 'element' ? 'Jmol' : 'spectrum';
    if (style === 'stick') return { stick: { colorscheme: color } };
    if (style === 'line') return { line: { colorscheme: color } };
    if (style === 'sphere') return { sphere: { colorscheme: color } };
    return { cartoon: { color: section.colorScheme === 'chain' ? 'spectrum' : color } };
  }

  /** One sandboxed 3Dmol instance owns every sampled frame; playback only sends frame indexes. */
  function createTrajectoryFrame(scriptSource: string, content: string): string {
    const payload = escapeScriptJson({ viewerId, content, style: styleFor() });
    return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
html,body,#viewer{height:100%;margin:0;overflow:hidden;background:#fff}
#message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;color:#71717a;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;box-sizing:border-box}
#message.error{color:#dc2626}
</style></head><body><div id="viewer"></div><div id="message">Loading trajectory...</div>
<script id="liatir-trajectory-payload" type="application/json">${payload}<\/script>
<script>${escapeInlineScript(scriptSource)}<\/script>
<script>(function(){
  const message=document.getElementById('message');
  let payload={viewerId:${JSON.stringify(viewerId)}};
  function send(type,extra){window.parent.postMessage(Object.assign({type,viewerId:payload.viewerId},extra||{}),'*')}
  function fail(error){const text=error&&error.message?error.message:String(error||'Trajectory viewer failed.');message.textContent=text;message.className='error';send('liatir-trajectory-viewer-error',{message:text})}
  try{
    payload=JSON.parse(document.getElementById('liatir-trajectory-payload').textContent||'{}');
    const threeDmol=window.$3Dmol;
    if(!threeDmol||typeof threeDmol.createViewer!=='function')throw new Error('3Dmol.js did not expose a viewer runtime.');
    const viewer=threeDmol.createViewer(document.getElementById('viewer'),{backgroundColor:'white'});
    if(typeof viewer.addModelsAsFrames!=='function'||typeof viewer.setFrame!=='function')throw new Error('This 3Dmol.js runtime does not support trajectory frames.');
    viewer.addModelsAsFrames(payload.content,'pdb');viewer.setStyle({},payload.style);viewer.zoomTo();
    Promise.resolve(viewer.setFrame(0)).then(function(){viewer.render();message.remove();send('liatir-trajectory-viewer-ready')}).catch(fail);
    window.addEventListener('message',function(event){const data=event.data||{};if(data.type!=='liatir-trajectory-set-frame'||data.viewerId!==payload.viewerId)return;Promise.resolve(viewer.setFrame(data.frame)).then(function(){viewer.render()}).catch(fail)});
    window.addEventListener('resize',function(){try{viewer.resize();viewer.render()}catch(_){}});
  }catch(error){fail(error)}
})();<\/script></body></html>`;
  }

  function replaceFrame(html: string) {
    frameHtml = html;
    viewerReady = false;
  }

  function stopRuntime(message: string) {
    stop();
    runtimeWarning = message;
    frameHtml = '';
  }

  function sendFrame(index: number) {
    const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-trajectory-viewer="${viewerId}"]`);
    iframe?.contentWindow?.postMessage({ type: 'liatir-trajectory-set-frame', viewerId, frame: index }, '*');
  }

  function showFrame(index: number) {
    if (!trajectory || !frameAsPdb) return;
    const bounded = Math.max(0, Math.min(trajectory.frames.length - 1, index));
    currentFrame = bounded;
    frameContent = frameAsPdb(topology, trajectory.frames[bounded]);
    if (viewerReady) sendFrame(bounded);
  }

  async function load() {
    const api = liatir();
    if (!api) return;
    loading = true;
    error = null;
    runtimeWarning = null;
    try {
      const [topologyFile, trajectoryFile] = await Promise.all([
        api.desktop.files.readBase64(section.structurePath, MAX_TOPOLOGY_BYTES),
        api.desktop.files.readBase64(section.trajectoryPath, MAX_TRAJECTORY_BYTES),
      ]);
      topology = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(topologyFile.dataBase64));
      const bytes = decodeBase64(trajectoryFile.dataBase64);
      const parser = await import('$lib/viewers/dcd');
      frameAsPdb = parser.dcdFrameAsPdb;
      trajectory = parser.parseDcdTrajectory(bytes.buffer, {
        requestedStride: section.frameStride,
        maxFrames: 250,
        maxAtomInstances: 500_000,
      });
      if (section.frameCount !== undefined && section.frameCount !== trajectory.sourceFrameCount) {
        throw new Error(`The Result declares ${section.frameCount} frames, but the DCD contains ${trajectory.sourceFrameCount}.`);
      }
      showFrame(0);
      try {
        const [{ source }, multiModel] = await Promise.all([
          readViewerRuntimeScript(THREEDMOL_RUNTIME_ID),
          Promise.resolve(parser.dcdTrajectoryAsMultiModelPdb(topology, trajectory.frames)),
        ]);
        replaceFrame(createTrajectoryFrame(source, multiModel));
      } catch (cause) {
        runtimeWarning = cause instanceof Error ? cause.message : String(cause);
      }
    } catch (cause) {
      trajectory = null;
      frameContent = '';
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function stop() {
    playing = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function togglePlay() {
    if (!trajectory || trajectory.frames.length < 2 || !viewerReady) return;
    if (playing) { stop(); return; }
    playing = true;
    timer = setInterval(() => {
      if (!trajectory) return stop();
      showFrame((currentFrame + 1) % trajectory.frames.length);
    }, 180);
  }

  onMount(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; viewerId?: string; message?: string } | null;
      if (!data || data.viewerId !== viewerId) return;
      if (data.type === 'liatir-trajectory-viewer-ready') {
        viewerReady = true;
        sendFrame(currentFrame);
      } else if (data.type === 'liatir-trajectory-viewer-error') {
        stopRuntime(data.message ?? 'Trajectory viewer failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  onDestroy(stop);

  const fallbackSection = $derived<StructureViewerSection>({
    type: 'structure-viewer',
    label: section.label,
    description: section.description,
    content: frameContent,
    format: 'pdb',
    style: section.style,
    colorScheme: section.colorScheme,
    height: section.height ?? 420,
  });
</script>

{#if !trajectory}
  <Card class="p-4">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-text">{section.label}</p>
        <p class="mt-1 text-xs text-text-muted">{section.description ?? 'DCD molecular trajectory linked to its starting structure.'}</p>
        <p class="mt-1 text-[10px] text-text-subtle">The trajectory stays on disk until you choose Load trajectory.</p>
        {#if error}<p class="mt-2 text-xs text-red-500">{sanitizeLocalPathsForDisplay(error, 2)}</p>{/if}
      </div>
      <Button variant="primary" loading={loading} onclick={load}>Load trajectory</Button>
    </div>
  </Card>
{:else}
  <div class="space-y-2">
    {#if frameHtml}
      <div style={`height: ${section.height ?? 420}px`}>
        <Card class="relative h-full overflow-hidden p-0">
          {#key frameHtml}
            <iframe
              title={section.label}
              use:sandboxDocument={{ html: frameHtml, onStalled: () => stopRuntime('The 3D viewer did not start.') }}
              sandbox="allow-scripts"
              data-trajectory-viewer={viewerId}
              class="absolute inset-0 h-full w-full border-0"
            ></iframe>
          {/key}
        </Card>
      </div>
    {:else}
      {#key currentFrame}<StructureViewer section={fallbackSection} />{/key}
    {/if}
    <Card class="p-3">
      <div class="flex items-center gap-3">
        <Button size="sm" variant="secondary" disabled={!viewerReady} onclick={togglePlay}>{playing ? 'Pause' : 'Play'}</Button>
        <input
          class="min-w-0 flex-1 accent-brand"
          type="range"
          min="0"
          max={Math.max(0, trajectory.frames.length - 1)}
          value={currentFrame}
          aria-label="Trajectory frame"
          oninput={(event) => { stop(); showFrame(Number(event.currentTarget.value)); }}
        />
        <p class="min-w-fit text-xs text-text-muted">Frame {displayedSourceFrame + 1} / {trajectory.sourceFrameCount}</p>
      </div>
      {#if runtimeWarning}
        <p class="mt-2 text-[10px] text-amber-600">3D playback unavailable; use the slider for a static preview. {sanitizeLocalPathsForDisplay(runtimeWarning, 2)}</p>
      {:else if trajectory.frames.length < trajectory.sourceFrameCount}
        <p class="mt-2 text-[10px] text-text-subtle">Showing {trajectory.frames.length} evenly sampled frames to keep memory bounded.</p>
      {/if}
    </Card>
  </div>
{/if}
