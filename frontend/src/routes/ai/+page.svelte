<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Badge, { type BadgeVariants } from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { liatir } from '$lib/api';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { LiatirAIModelRecord, LiatirAIModelRuntimeKind } from '@liatir/core';

  let loading = $state(true);
  let showRegister = $state(false);
  let registering = $state(false);
  let modelName = $state('');
  let modelPath = $state('');
  let runtimeKind = $state<Exclude<LiatirAIModelRuntimeKind, 'mock'>>('llama-cpp');

  onMount(async () => {
    await aiModelsStore.init();
    loading = false;
  });

  const models = $derived(aiModelsStore.models);
  const defaultModel = $derived(aiModelsStore.defaultModel);
  const installedCount = $derived(models.filter((model) => model.status === 'installed').length);
  const runnableCount = $derived(aiModelsStore.runnableModels.length);

  function statusVariant(status: LiatirAIModelRecord['status']): BadgeVariants {
    if (status === 'installed') return 'done';
    if (status === 'available') return 'available';
    if (status === 'missing') return 'missing';
    return 'failed';
  }

  function hardwareLabel(model: LiatirAIModelRecord): string {
    const parts: string[] = [];
    if (model.hardware?.recommendedRamGb != null) parts.push(`${model.hardware.recommendedRamGb} GB RAM`);
    if (model.hardware?.recommendedVramGb != null) parts.push(`${model.hardware.recommendedVramGb} GB VRAM`);
    if (model.hardware?.gpu === false) parts.push('CPU');
    if (model.hardware?.gpu === true) parts.push('GPU');
    return parts.join(' / ') || 'Unspecified';
  }

  function runtimeLabel(model: LiatirAIModelRecord): string {
    return `${model.runtime.name}${model.runtime.version ? ` ${model.runtime.version}` : ''}`;
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function inferRuntime(path: string): Exclude<LiatirAIModelRuntimeKind, 'mock'> {
    const lower = path.toLowerCase();
    if (lower.endsWith('.gguf')) return 'llama-cpp';
    if (lower.endsWith('.onnx')) return 'onnx';
    return 'custom';
  }

  function inferName(path: string): string {
    return basename(path).replace(/\.(gguf|onnx|safetensors|bin)$/i, '').replace(/[_-]+/g, ' ').trim();
  }

  async function browseModelFile() {
    const api = liatir();
    if (!api) return;
    const result = await api.desktop.files.open({
      multi: false,
      allowed: ['gguf', 'onnx', 'safetensors', 'bin'],
    });
    const path = result.paths[0];
    if (!path) return;
    modelPath = path;
    runtimeKind = inferRuntime(path);
    if (!modelName.trim()) modelName = inferName(path);
  }

  function closeRegister() {
    showRegister = false;
    registering = false;
    modelName = '';
    modelPath = '';
    runtimeKind = 'llama-cpp';
  }

  async function registerModel() {
    const name = modelName.trim();
    const path = modelPath.trim();
    if (!name || !path) {
      toast.warn('Model name and file path are required');
      return;
    }
    registering = true;
    try {
      await aiModelsStore.registerLocalModel({
        name,
        path,
        runtimeKind,
        description: `Local model file: ${basename(path)}`,
      });
      toast.success('Local AI Model registered');
      closeRegister();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to register AI Model');
    } finally {
      registering = false;
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="AI Models" description="Local model registry for pipeline AI Tools">
    {#snippet actions()}
      <Button size="sm" variant="primary" onclick={() => showRegister = true}>
        <Icon icon="lucide:plus" width="14" height="14" />
        Register model
      </Button>
      <Button size="sm" variant="secondary" onclick={() => goto('/pipeline')}>
        <Icon icon="lucide:workflow" width="14" height="14" />
        Pipeline
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6 space-y-5">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Default model</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800 truncate">{defaultModel?.name ?? 'None'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Installed</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{installedCount} model{installedCount === 1 ? '' : 's'}</p>
      </div>
      <div class="border border-border bg-white rounded-lg px-4 py-3">
        <p class="text-[10px] font-semibold uppercase text-zinc-400">Runnable</p>
        <p class="mt-1 text-sm font-semibold text-zinc-800">{runnableCount} model{runnableCount === 1 ? '' : 's'}</p>
      </div>
    </div>

    <div class="border border-border bg-white rounded-lg overflow-hidden">
      <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_150px] gap-3 px-4 py-2.5 border-b border-border bg-surface text-[10px] font-semibold uppercase text-zinc-400 max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_150px]">
        <span>Model</span>
        <span class="max-xl:hidden">Runtime</span>
        <span class="max-xl:hidden">Hardware</span>
        <span>License</span>
        <span class="text-right">Default</span>
      </div>

      {#if loading}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">Loading AI Models...</div>
      {:else if models.length === 0}
        <div class="px-4 py-8 text-center text-sm text-zinc-400">No AI Models registered.</div>
      {:else}
        {#each models as model (model.id)}
          <div class="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(130px,0.8fr)_150px] gap-3 px-4 py-3 border-b border-border/70 last:border-b-0 items-center max-xl:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_150px]">
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <p class="text-sm font-semibold text-zinc-800 truncate">{model.name}</p>
                <Badge variant={statusVariant(model.status)} size="xs">{model.status}</Badge>
                {#if model.localOnly}
                  <Badge variant="brand" size="xs" hideDot>local</Badge>
                {/if}
              </div>
              <p class="mt-1 text-xs text-zinc-500 line-clamp-2">{model.description}</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                {#each model.capabilities as capability}
                  <span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{capability}</span>
                {/each}
              </div>
            </div>

            <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
              <p class="truncate">{runtimeLabel(model)}</p>
              <p class="text-[10px] text-zinc-400 truncate">{model.localPath ?? model.runtime.kind}</p>
            </div>

            <div class="text-xs text-zinc-600 min-w-0 max-xl:hidden">
              <p class="truncate">{hardwareLabel(model)}</p>
              {#if model.hardware?.notes}
                <p class="text-[10px] text-zinc-400 truncate">{model.hardware.notes}</p>
              {/if}
            </div>

            <div class="text-xs text-zinc-600 min-w-0">
              <p class="truncate">{model.license?.name ?? 'Unspecified'}</p>
              {#if model.license?.verifiedAt}
                <p class="text-[10px] text-zinc-400">Verified {model.license.verifiedAt}</p>
              {:else}
                <p class="text-[10px] text-zinc-400">Verification required</p>
              {/if}
            </div>

            <div class="flex justify-end gap-1.5">
              {#if model.isDefault}
                <Badge variant="done" size="xs">default</Badge>
              {:else}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={model.enabled === false || model.status === 'missing' || model.status === 'error'}
                  onclick={() => aiModelsStore.setDefault(model.id)}
                >
                  Set
                </Button>
              {/if}
              {#if model.source === 'local-file'}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => aiModelsStore.removeLocalModel(model.id)}
                >
                  Remove
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="border border-border bg-white rounded-lg px-4 py-3 flex items-start gap-3">
      <div class="h-8 w-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
        <Icon icon="mingcute:ai-line" width="17" height="17" />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-zinc-800">AI Tools</p>
        <p class="mt-1 text-xs text-zinc-500">
          The pipeline catalog includes a mock AI Tool that uses the selected AI Model and emits response and provenance values.
        </p>
      </div>
    </div>
  </div>
</div>

{#if showRegister}
  <div class="fixed inset-0 z-40 bg-black/30" role="presentation" onclick={closeRegister}></div>
  <div class="fixed z-50 left-1/2 top-1/2 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-white shadow-2xl overflow-hidden">
    <div class="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <div>
        <p class="text-sm font-semibold text-zinc-800">Register local AI Model</p>
        <p class="text-xs text-zinc-500 mt-0.5">Add an existing local model file without downloading anything.</p>
      </div>
      <button class="text-zinc-400 hover:text-zinc-700" aria-label="Close" onclick={closeRegister}>
        <Icon icon="lucide:x" width="16" height="16" />
      </button>
    </div>

    <div class="p-4 space-y-3">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-zinc-600" for="model-name">Name</label>
        <input
          id="model-name"
          bind:value={modelName}
          class="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          placeholder="Local GGUF model"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-xs font-medium text-zinc-600" for="model-path">Model file</label>
        <div class="flex gap-2">
          <input
            id="model-path"
            bind:value={modelPath}
            class="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="/path/to/model.gguf"
          />
          <Button size="sm" variant="secondary" onclick={browseModelFile}>
            Browse
          </Button>
        </div>
      </div>

      <div class="space-y-1.5">
        <span class="text-xs font-medium text-zinc-600">Runtime</span>
        <Select
          value={runtimeKind}
          class="w-full"
          options={[
            { value: 'llama-cpp', label: 'llama.cpp / GGUF' },
            { value: 'onnx', label: 'ONNX Runtime' },
            { value: 'custom', label: 'Custom local runtime' },
          ]}
          onchange={(value) => runtimeKind = value as Exclude<LiatirAIModelRuntimeKind, 'mock'>}
        />
      </div>

      <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        License, hardware requirements, and install instructions are marked unverified until checked against official model sources.
      </div>
    </div>

    <div class="flex justify-end gap-2 border-t border-border bg-surface px-4 py-3">
      <Button size="sm" variant="ghost" onclick={closeRegister}>Cancel</Button>
      <Button size="sm" variant="primary" loading={registering} onclick={registerModel}>Register</Button>
    </div>
  </div>
{/if}
