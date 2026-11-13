<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import type { LiatirQuentaPresentation } from '@liatir/core';
  import { liatir } from '$lib/api';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import ResultPickerDialog from '$lib/components/quenta/ResultPickerDialog.svelte';
  import PresentationStages from '$lib/components/quenta/PresentationStages.svelte';
  import QuentaModeSwitch from '$lib/components/quenta/QuentaModeSwitch.svelte';
  import QuentaPresentation from '$lib/components/quenta/QuentaPresentation.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { presentationThreads, type PresentationTurn } from '$lib/stores/presentation-threads.svelte';
  import { quentaStore } from '$lib/stores/quenta.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  const PRESENTATION_TOOL = 'quenta-presentation';
  const EXAMPLES = [
    'Explain how molecular docking works, simply, with a diagram',
    'Introduce single-cell RNA sequencing to a new lab member',
  ];

  let loaded = $state(false);
  let threadId = $state<string | null>(null);
  let draft = $state('');
  let pickerOpen = $state(false);
  let sending = $state(false);
  /** The version shown on the stage; follows the newest one unless the user picks another. */
  let stageResultId = $state<string | null>(null);
  let stagePresentation = $state<LiatirQuentaPresentation | null>(null);
  let transcript = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLTextAreaElement | null>(null);
  let downloading = $state(false);

  const thread = $derived(threadId ? presentationThreads.byId(threadId) : undefined);
  const turns = $derived(thread?.turns ?? []);
  const runningTurn = $derived(turns.find((turn) => turn.status === 'running'));
  const versions = $derived(turns.filter((turn) => turn.status === 'done' && turn.resultId));
  const latestVersion = $derived(versions.at(-1)?.resultId ?? null);
  const results = $derived(analysisRuns.runs.filter((run) => run.status === 'done' && run.tool !== PRESENTATION_TOOL));
  const chosen = $derived((thread?.resultIds ?? []).map((id) => results.find((run) => run.id === id)).filter((run) => run !== undefined));
  const hasModel = $derived(!!quentaStore.config.model);
  const canSend = $derived(hasModel && !sending && !runningTurn && (draft.trim().length > 0 || chosen.length > 0));
  const threadOptions = $derived(presentationThreads.threads.map((item) => ({ value: item.id, label: item.title })));

  onMount(async () => {
    try {
      await Promise.all([analysisRuns.init(), executionRuns.init(), quentaStore.init(), presentationThreads.init()]);
      threadId = presentationThreads.threads[0]?.id ?? null;
      loaded = true;
    } catch (error) {
      toast.error(String(error));
    }
  });

  // "Open in Stage" on a Result opens a new conversation with that Result attached, once per
  // link. Not reactive on purpose: `page.url` keeps the query after `replaceState`, and a new Result
  // arriving must not open the conversation a second time.
  let handledLink = '';
  $effect(() => {
    const link = page.url.search;
    const requested = page.url.searchParams.getAll('result');
    if (!loaded || !requested.length || link === handledLink) return;
    handledLink = link;
    untrack(() => {
      const valid = requested.filter((id) => results.some((run) => run.id === id));
      replaceState('/quenta/presentations', page.state);
      void presentationThreads.create(valid).then((id) => { threadId = id; void tick().then(() => input?.focus()); });
    });
  });

  // A new version goes on the stage as soon as it is saved; switching conversation shows its newest.
  $effect(() => { stageResultId = latestVersion; });

  // Load the version on the stage; a late read for another version must not replace it.
  $effect(() => {
    const id = stageResultId;
    let current = true;
    stagePresentation = null;
    if (id) {
      void analysisRuns.loadOutput(id).then((output) => {
        const section = output?.sections[0];
        if (current && section?.type === 'html-presentation') stagePresentation = section.presentation;
      });
    }
    return () => { current = false; };
  });

  // Keep the newest message in view as the conversation grows.
  $effect(() => {
    void turns.length;
    void (runningTurn && presentationThreads.progress(runningTurn.id));
    void tick().then(() => transcript?.scrollTo({ top: transcript.scrollHeight }));
  });

  function resultLabel(id: string): string {
    return results.find((run) => run.id === id)?.label ?? 'A Result no longer available';
  }

  async function newThread() {
    threadId = await presentationThreads.create();
    draft = '';
    await tick();
    input?.focus();
  }

  async function removeThread() {
    if (!thread) return;
    const ok = await confirm({ title: 'Delete conversation', message: `Delete "${thread.title}"? Its saved pages stay in Results.`, confirmLabel: 'Delete' });
    if (!ok) return;
    await presentationThreads.remove(thread.id);
    threadId = presentationThreads.threads[0]?.id ?? null;
  }

  async function chooseResults(ids: string[]) {
    pickerOpen = false;
    if (!threadId) threadId = await presentationThreads.create(ids);
    else await presentationThreads.setResults(threadId, ids);
  }

  async function send(request = draft) {
    if (!hasModel || sending || runningTurn) return;
    if (!request.trim() && !chosen.length) return;
    sending = true;
    try {
      if (!threadId) threadId = await presentationThreads.create();
      const id = threadId;
      draft = '';
      // The turn settles on its own; this page may be left or reopened while it runs.
      void presentationThreads.send(id, request, { ...quentaStore.config }).catch((error) => toast.error(String(error)));
      await tick();
    } finally {
      sending = false;
    }
  }

  async function retry(turn: PresentationTurn) {
    if (!threadId) return;
    await presentationThreads.setResults(threadId, turn.resultIds);
    await send(turn.request);
  }

  /** Saves the page on the Stage as one HTML file that opens offline in any browser. */
  async function download() {
    const api = liatir();
    if (!stagePresentation || !api || downloading) return;
    downloading = true;
    try {
      const name = stagePresentation.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'stage-page';
      const destination = await api.desktop.files.save(`${name}.html`);
      if (!destination) return;
      const { presentationToHtml } = await import('$lib/utils/export-result');
      await api.invoke('lia_write_file_path', { path: destination, content: await presentationToHtml(stagePresentation) });
      toast.success('Page saved as HTML.');
    } catch (error) {
      toast.error(`The page could not be saved: ${String(error)}`);
    } finally {
      downloading = false;
    }
  }

  function onComposerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }
</script>

<div class="flex h-full flex-col">
  <PageHeader
    title="Quenta Stage"
    description="Ask in the chat; Quenta builds the page on the Stage"
    info="Describe the page you want, the way you would ask a colleague. Quenta builds it as one interactive page, with charts, tables, diagrams and quizzes, and shows it on the Stage next to the chat. Ask for changes in the next message and it makes a new version. Add Results to build the page on their real data, or just describe any topic. Each version is saved in Results and can be downloaded as an HTML file; the page runs inside Liatir without internet or access to your files and app commands."
  >
    {#snippet actions()}
      <QuentaModeSwitch active="presentations" />
    {/snippet}
  </PageHeader>

  <div class="flex min-h-0 flex-1">
    <!-- Conversation -->
    <section class="flex w-[27rem] shrink-0 flex-col border-r border-border bg-surface" data-testid="presentation-chat">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        {#if threadOptions.length}
          <div class="min-w-0 flex-1">
            <Select value={threadId ?? ''} options={threadOptions} placeholder="Choose a conversation" onchange={(id) => threadId = id} />
          </div>
          {#if thread}
            <button type="button" aria-label="Delete this conversation" class="rounded-lg p-1.5 text-text-faint transition-colors hover:text-red-500" onclick={removeThread}>
              <Icon icon="lucide:trash-2" width="15" height="15" />
            </button>
          {/if}
        {:else}
          <p class="flex-1 text-xs text-text-muted">No conversations yet</p>
        {/if}
        <Button variant="secondary" size="sm" testId="presentation-new" onclick={newThread}>
          <Icon icon="lucide:plus" width="13" height="13" /> New
        </Button>
      </div>

      <div bind:this={transcript} class="flex-1 space-y-5 overflow-y-auto p-4" data-testid="presentation-transcript">
        {#if !turns.length}
          <div class="space-y-3 pt-6 text-center">
            <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Icon icon="lucide:monitor-play" width="20" height="20" />
            </div>
            <p class="text-sm font-medium text-text">What should the page be about?</p>
            <p class="text-xs leading-relaxed text-text-muted">
              Write it in your own words. Add Results to use your real data, or just describe any topic. You can ask for changes afterwards.
            </p>
            <div class="flex flex-col items-center gap-1.5 pt-1">
              {#each EXAMPLES as example}
                <button type="button" class="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-text-secondary transition-colors hover:border-brand hover:text-brand"
                  onclick={() => { draft = example; input?.focus(); }}>{example}</button>
              {/each}
            </div>
          </div>
        {/if}

        {#each turns as turn, index (turn.id)}
          <div class="flex justify-end" data-testid="presentation-user-turn">
            <div class="max-w-[85%] space-y-1.5 rounded-2xl rounded-br-md bg-brand/10 px-3.5 py-2.5 text-sm text-text">
              <p class="whitespace-pre-wrap">{turn.request || 'Present the chosen Results.'}</p>
              {#if turn.resultIds.length}
                <p class="flex flex-wrap gap-1 text-[11px] text-text-muted">
                  <Icon icon="lucide:paperclip" width="11" height="11" class="mt-0.5" />
                  {turn.resultIds.map(resultLabel).join(' · ')}
                </p>
              {/if}
            </div>
          </div>

          <div class="flex gap-2.5" data-testid="presentation-quenta-turn" data-status={turn.status}>
            <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Icon icon="lucide:sparkles" width="14" height="14" />
            </div>
            <div class="min-w-0 flex-1 pt-1 text-sm">
              {#if turn.status === 'running'}
                <PresentationStages
                  progress={presentationThreads.progress(turn.id) ?? { stage: 'reading' }}
                  startedAt={turn.sentAt}
                  withResults={turn.resultIds.length > 0}
                />
              {:else if turn.status === 'done' && turn.resultId}
                {@const version = versions.findIndex((item) => item.id === turn.id) + 1}
                <p class="text-text">
                  {index === 0 ? 'Here it is' : 'Done'}: <span class="font-medium">{turn.title ?? 'Stage page'}</span>
                  <span class="text-text-subtle">· version {version}</span>
                </p>
                <div class="mt-2 flex flex-wrap gap-2">
                  {#if stageResultId === turn.resultId}
                    <span class="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand"><Icon icon="lucide:monitor-play" width="12" height="12" /> On the stage</span>
                  {:else}
                    <Button variant="secondary" size="sm" onclick={() => stageResultId = turn.resultId ?? null}>Show on stage</Button>
                  {/if}
                  <Button variant="ghost" size="sm" onclick={() => goto(`/results?run=${turn.resultId}`)}>Open in Results</Button>
                </div>
              {:else if turn.status === 'cancelled'}
                <p class="text-text-muted">Stopped. Send a message to try again.</p>
              {:else}
                <p class="text-red-500">{turn.error ?? 'The page could not be created.'}</p>
                <Button class="mt-2" variant="secondary" size="sm" disabled={!!runningTurn} onclick={() => retry(turn)}>Try again</Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Composer -->
      <div class="space-y-2 border-t border-border p-3">
        {#if loaded && !hasModel}
          <div class="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Quenta needs a local model first.
            <a href="/quenta" class="font-medium underline">Choose one in Chat</a>
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-1.5">
          {#each chosen as result (result.id)}
            <span class="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/30 bg-brand/8 py-0.5 pl-2.5 pr-1 text-[11px] text-text" data-testid="presentation-selected" data-result-id={result.id}>
              <span class="truncate">{result.label}</span>
              <button type="button" aria-label="Remove {result.label}" class="rounded-full p-0.5 text-text-subtle hover:text-text"
                onclick={() => threadId && presentationThreads.setResults(threadId, (thread?.resultIds ?? []).filter((id) => id !== result.id))}>
                <Icon icon="lucide:x" width="11" height="11" />
              </button>
            </span>
          {/each}
          <button type="button" data-testid="presentation-results-open" disabled={!!runningTurn}
            class="inline-flex items-center gap-1 rounded-full border border-dashed border-border-2 px-2.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            onclick={() => pickerOpen = true}>
            <Icon icon="lucide:paperclip" width="11" height="11" /> {chosen.length ? 'Change Results' : 'Add Results (optional)'}
          </button>
        </div>
        <div class="flex items-end gap-2 rounded-xl border border-border bg-surface-2 p-2 focus-within:border-brand">
          <textarea
            bind:this={input}
            bind:value={draft}
            rows="2"
            data-testid="presentation-input"
            class="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 text-sm text-text outline-none placeholder:text-text-subtle"
            placeholder={versions.length ? 'Ask for changes, e.g. make the chart larger' : 'Describe the page you want…'}
            onkeydown={onComposerKey}
          ></textarea>
          {#if runningTurn}
            <Button variant="secondary" size="sm" testId="presentation-stop" disabled={!runningTurn.runId}
              onclick={() => runningTurn?.runId && executionRuns.cancel(runningTurn.runId)}>Stop</Button>
          {:else}
            <Button variant="primary" size="sm" testId="presentation-send" disabled={!canSend} onclick={() => send()}>
              <Icon icon="lucide:send" width="13" height="13" /> Send
            </Button>
          {/if}
        </div>
        <p class="text-[10px] text-text-subtle">Enter sends · Shift+Enter adds a line · AI-generated: check figures against the original Results</p>
      </div>
    </section>

    <!-- Stage -->
    <section class="flex min-w-0 flex-1 flex-col bg-bg" data-testid="presentation-stage">
      <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div class="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-subtle">
          <Icon icon="lucide:monitor-play" width="14" height="14" /> Stage
          {#if stagePresentation}
            <span class="truncate normal-case tracking-normal text-text">· {stagePresentation.title}</span>
          {/if}
        </div>
        {#if stageResultId}
          <div class="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" testId="presentation-download" disabled={!stagePresentation || downloading} onclick={download}>
              <Icon icon="lucide:download" width="13" height="13" /> Download HTML
            </Button>
            <Button variant="ghost" size="sm" onclick={() => goto(`/results?run=${stageResultId}`)}>Open in Results</Button>
          </div>
        {/if}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        {#if stagePresentation}
          {#key stagePresentation.id}
            <QuentaPresentation presentation={stagePresentation} fill />
          {/key}
        {:else}
          <div class="flex h-full flex-col items-center justify-center gap-2 text-center text-text-muted">
            <Icon icon="lucide:monitor-play" width="32" height="32" class="text-text-faint" />
            <p class="text-sm">{runningTurn ? 'Quenta is building your page…' : 'Your page will appear here.'}</p>
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>

<ResultPickerDialog
  open={pickerOpen}
  {results}
  selected={thread?.resultIds ?? []}
  onclose={() => pickerOpen = false}
  onconfirm={chooseResults}
/>
