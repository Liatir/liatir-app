<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import { validateLiatirScript, type LiatirPythonScript } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import ScriptContractEditor from '$lib/components/pipeline/ScriptContractEditor.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import CodeEditor from '$lib/components/ui/CodeEditor.svelte';
  import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
  import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS } from '$lib/components/ui/field-styles';
  import { liatir } from '$lib/api';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { pythonScripts } from '$lib/stores/python-scripts.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { runScriptDirect } from '$lib/tools/script-step';
  import { contractRows, contractSchema, type ScriptContractRow } from '$lib/tools/script-contract';

  let script = $state<LiatirPythonScript>(pythonScripts.draft());
  let packages = $state('');
  let inputRows = $state<ScriptContractRow[]>([]);
  let outputRows = $state<ScriptContractRow[]>([]);
  // Test values are keyed by input name, so they follow a field as long as its name is unchanged.
  let values = $state<Record<string, string>>({});
  let ready = $state(false);
  // The workspace a Run click started in: a run keeps its owner even if the user switches away.
  let launchingWorkspace = $state<string | null>(null);

  const isScriptRun = (kind: string, entityId: string | undefined) => kind === 'python-script' && entityId === script.id;
  const ownedRun = $derived(executionRuns.active.find((run) => isScriptRun(run.identity.runKind, run.identity.entityId)));
  const running = $derived(!!ownedRun || (launchingWorkspace !== null && launchingWorkspace === workspaceStore.activeId));
  const latest = $derived(executionRuns.records.find((run) => isScriptRun(run.identity.runKind, run.identity.entityId)));

  const namedInputs = $derived(inputRows.filter((row) => row.name.trim()));

  function load(saved: LiatirPythonScript) {
    script = JSON.parse(JSON.stringify(saved));
    packages = (script.python.requirements ?? []).join('\n');
    inputRows = contractRows(script.inputSchema);
    outputRows = contractRows(script.outputSchema);
    values = Object.fromEntries(Object.entries(script.inputSchema)
      .map(([key, field]) => [key, field.default === undefined ? '' : String(field.default)]));
  }

  onMount(async () => {
    try {
      await Promise.all([pythonScripts.init(), executionRuns.init()]);
      const saved = pythonScripts.byId(page.url.searchParams.get('script') ?? '');
      if (saved) load(saved);
      ready = true;
    } catch (error) {
      toast.error(`Could not open the script: ${String(error)}`);
    }
  });

  /** The complete definition as it will be saved: editor state, contracts and the package list. */
  function definition(): LiatirPythonScript {
    const requirements = packages.split('\n').map((line) => line.trim()).filter(Boolean);
    const { requirements: _previous, ...python } = script.python;
    const next: LiatirPythonScript = {
      ...script,
      inputSchema: contractSchema(inputRows, 'input') as LiatirPythonScript['inputSchema'],
      outputSchema: contractSchema(outputRows, 'output') as LiatirPythonScript['outputSchema'],
      python: requirements.length ? { ...python, requirements } : python,
    };
    validateLiatirScript(next);
    return next;
  }

  async function persist(): Promise<LiatirPythonScript> {
    const next = definition();
    await pythonScripts.save(next);
    script = next;
    if (page.url.searchParams.get('script') !== next.id) {
      replaceState(`/code?script=${next.id}`, page.state);
    }
    return next;
  }

  async function save() {
    try {
      await persist();
      toast.success('Script saved.');
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function run() {
    if (running) return;
    const workspace = workspaceStore.activeId;
    launchingWorkspace = workspace;
    try {
      const saved = await persist();
      const inputs = Object.fromEntries(Object.entries(values).filter(([key, value]) => key in saved.inputSchema && value !== ''));
      await runScriptDirect(saved, inputs, workspace);
      toast.success('The script finished. Its Result is saved.');
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (launchingWorkspace === workspace) launchingWorkspace = null;
    }
  }

  async function chooseFile(key: string, accept?: string[]) {
    const selection = await liatir()?.desktop.files.open({ multi: false, allowed: accept });
    if (selection?.paths[0]) values[key] = selection.paths[0];
  }

  async function exportSource() {
    const api = liatir();
    if (!api) return;
    const path = await api.desktop.files.save(`${script.name}.py`);
    if (path) await api.invoke('lia_write_file_path', { path, content: script.code });
  }
</script>

<div class="flex h-full flex-col">
  <PageHeader
    title="Python script"
    info="A script is a small Python program you write here. On the right you choose what information it receives (inputs) and what results it gives back (outputs). You can try it on this page, then use it as a step in any pipeline of this workspace."
  >
    {#snippet titleActions()}
      <Button variant="ghost" size="sm" onclick={() => goto('/scripts')}>
        <Icon icon="lucide:arrow-left" width="14" height="14" /> Scripts
      </Button>
    {/snippet}
    {#snippet actions()}
      <Button variant="ghost" size="sm" disabled={!ready} onclick={exportSource}>Export .py</Button>
      <Button variant="secondary" size="sm" disabled={!ready || running} onclick={save}>Save</Button>
      {#if running}
        <Button variant="secondary" size="sm" disabled={!ownedRun} onclick={() => ownedRun && executionRuns.cancel(ownedRun.identity.runId)}>Cancel run</Button>
      {:else}
        <Button variant="primary" size="sm" testId="script-run" disabled={!ready} onclick={run}>Save and run</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    <div class="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div class="min-w-0 space-y-4">
        <Card class="grid gap-3 p-4 sm:grid-cols-[2fr_1fr]">
          <label>
            <span class={FIELD_LABEL_CLASS}>Name</span>
            <input class={FIELD_INPUT_CLASS} bind:value={script.name} disabled={running} />
          </label>
          <label>
            <span class={FIELD_LABEL_CLASS}>Folder (optional)</span>
            <input class={FIELD_INPUT_CLASS} placeholder="e.g. Quality control" bind:value={script.folder} disabled={running} />
          </label>
        </Card>

        <Card class="overflow-hidden">
          <div class="h-[28rem]">
            <CodeEditor
              language="python"
              readonly={running}
              value={script.code}
              onchange={(code) => script.code = code}
              onrun={() => { if (!running) void run(); }}
            />
          </div>
        </Card>

        <Card class="space-y-2 p-4">
          <LabelWithInfo
            text="Python packages"
            info="Extra Python libraries your code uses, one per line, for example pandas or numpy. Liatir downloads and installs them the first time the script runs; later runs reuse them. Leave this empty if your code uses only plain Python."
          />
          <textarea
            aria-label="Python packages"
            class="{FIELD_INPUT_CLASS} h-24 font-mono text-xs"
            placeholder={'pandas\nnumpy>=1.26'}
            bind:value={packages}
            disabled={running}
          ></textarea>
        </Card>
      </div>

      <div class="min-w-0 space-y-4">
        <ScriptContractEditor rows={inputRows} disabled={running} onchange={(rows) => inputRows = rows} />
        <ScriptContractEditor rows={outputRows} output disabled={running} onchange={(rows) => outputRows = rows} />

        <Card class="space-y-3 p-4">
          <LabelWithInfo
            text="Test values"
            info="To try the script here, type a value for each input below, then press Save and run. These values are used only for this test and are not part of the script. When the script runs as a step in a pipeline, it gets its inputs from the pipeline instead."
          />
          {#each namedInputs as row (row.id)}
            {@const key = row.name.trim()}
            {@const field = row.field}
            <div>
              <span class={FIELD_LABEL_CLASS}>{field.label || key}{field.required ? '' : ' (optional)'}</span>
              {#if field.type === 'boolean'}
                <label class="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={values[key] === 'true'} disabled={running}
                    onchange={(event) => values[key] = String(event.currentTarget.checked)} />
                  Yes
                </label>
              {:else if field.type === 'file'}
                <div class="flex gap-2">
                  <input class={FIELD_INPUT_CLASS} placeholder="Choose a file" bind:value={values[key]} disabled={running} />
                  <Button variant="secondary" size="sm" disabled={running} onclick={() => chooseFile(key, field.accept)}>Choose…</Button>
                </div>
              {:else}
                <input class={FIELD_INPUT_CLASS} type={field.type === 'number' ? 'number' : 'text'} placeholder={field.type === 'number' ? 'e.g. 3' : 'Type a value to test with'} bind:value={values[key]} disabled={running} />
              {/if}
            </div>
          {:else}
            <p class="text-xs text-text-muted">Add inputs above and name them; a field to fill in for the test appears here for each one.</p>
          {/each}
        </Card>

        {#if latest}
          <Card class="space-y-3 p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-text">Latest run</p>
              <Badge variant={latest.status === 'done' ? 'done' : latest.status === 'error' ? 'failed' : latest.status === 'running' ? 'running' : 'neutral'} size="xs">{latest.status}</Badge>
            </div>
            {#if latest.logs.length}
              <pre class="max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-text-secondary">{latest.logs.map((entry) => entry.message).join('\n')}</pre>
            {/if}
            <div class="flex gap-2">
              {#if latest.resultId && latest.finalizedAt}
                <Button variant="secondary" size="sm" onclick={() => goto(`/results?run=${latest!.resultId}`)}>Open Result</Button>
              {/if}
              <Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>Jobs</Button>
            </div>
          </Card>
        {/if}
      </div>
    </div>
  </div>
</div>
