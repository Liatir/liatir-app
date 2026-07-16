<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import { NodeResizeControl, ResizeControlVariant, useSvelteFlow } from '@xyflow/svelte';
  import type { Node, NodeProps } from '@xyflow/svelte';
  import type { ResizeParams } from '@xyflow/svelte';
  import type { NoteNodeData, NoteColor } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { openLinkInBrowser } from '$lib/utils';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  const DEFAULT_WIDTH = 260;
  const MIN_WIDTH = 160;
  const DEFAULT_COLOR: NoteColor = 'none'; // transparent by default — just floating text

  // Static class strings per color so Tailwind's JIT can see them at build time.
  interface NoteColorStyle {
    /** Card border + background (+ hover affordance for the borderless variant). */
    card: string;
    /** Extra elevation — dropped entirely for the borderless variant. */
    shadow: string;
    deleteBtn: string;
    placeholder: string;
    swatch: string;
  }

  const NOTE_COLORS: Record<NoteColor, NoteColorStyle> = {
    amber: {
      card: 'border border-amber-200 bg-amber-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-amber-500 hover:bg-amber-100 hover:text-red-500',
      placeholder: 'text-amber-700/45',
      swatch: 'bg-amber-200',
    },
    sky: {
      card: 'border border-sky-200 bg-sky-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-sky-500 hover:bg-sky-100 hover:text-red-500',
      placeholder: 'text-sky-700/45',
      swatch: 'bg-sky-200',
    },
    emerald: {
      card: 'border border-emerald-200 bg-emerald-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-emerald-500 hover:bg-emerald-100 hover:text-red-500',
      placeholder: 'text-emerald-700/45',
      swatch: 'bg-emerald-200',
    },
    rose: {
      card: 'border border-rose-200 bg-rose-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-rose-500 hover:bg-rose-100 hover:text-red-500',
      placeholder: 'text-rose-700/45',
      swatch: 'bg-rose-200',
    },
    violet: {
      card: 'border border-violet-200 bg-violet-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-violet-500 hover:bg-violet-100 hover:text-red-500',
      placeholder: 'text-violet-700/45',
      swatch: 'bg-violet-200',
    },
    slate: {
      card: 'border border-slate-200 bg-slate-50',
      shadow: 'shadow-sm',
      deleteBtn: 'text-slate-400 hover:bg-slate-100 hover:text-red-500',
      placeholder: 'text-slate-500/50',
      swatch: 'bg-slate-300',
    },
    // No background AND no border — just floating text. A faint outline appears on
    // hover so the note stays discoverable/selectable.
    none: {
      card: 'border border-transparent bg-transparent group-hover:border-border/70',
      shadow: '',
      deleteBtn: 'text-text-subtle hover:bg-surface-2 hover:text-red-500',
      placeholder: 'text-text-subtle',
      swatch: 'bg-transparent ring-1 ring-inset ring-border-2',
    },
  };

  const COLOR_ORDER: NoteColor[] = ['amber', 'sky', 'emerald', 'rose', 'violet', 'slate', 'none'];

  const FONTS: { label: string; family: string }[] = [
    { label: 'Sans', family: 'ui-sans-serif, system-ui, sans-serif' },
    { label: 'Serif', family: 'ui-serif, Georgia, Cambria, serif' },
    { label: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    { label: 'Handwriting', family: '"Comic Sans MS", "Bradley Hand", "Segoe Print", cursive' },
  ];

  const SIZES: { label: string; value: string }[] = [
    { label: 'S', value: '2' },
    { label: 'M', value: '3' },
    { label: 'L', value: '5' },
    { label: 'XL', value: '6' },
  ];

  // Matches http(s):// URLs and bare www. hosts inside note text for auto-linking.
  const URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

  let { id, data, selected }: NodeProps<Node<NoteNodeData>> = $props();

  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  // Only the width is fixed/resizable — the height auto-fits the content (see below).
  // `liveWidth` reflects the in-progress drag so the resize feels immediate; it is
  // cleared once the final value has been persisted into `data.width`.
  let liveWidth = $state<number | null>(null);
  const width = $derived(liveWidth ?? (typeof data.width === 'number' ? data.width : DEFAULT_WIDTH));
  const color = $derived<NoteColor>((data.color as NoteColor) ?? DEFAULT_COLOR);
  const style = $derived(NOTE_COLORS[color] ?? NOTE_COLORS[DEFAULT_COLOR]);
  // The whole pipeline is locked while a run is in progress — notes become read-only.
  const readOnly = $derived(pipelineStore.running);
  // Placeholder shows only when the note has no visible text.
  const isEmpty = $derived(
    (data.text ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length === 0
  );

  let editorEl = $state<HTMLDivElement | null>(null);
  let openMenu = $state<'font' | 'size' | 'color' | null>(null);
  // Notes drag from their body by default; a double-click switches into edit mode
  // (adds `nodrag` so text can be selected/typed) and blur switches back.
  let editing = $state(false);
  // Tracks the last HTML we wrote/read so external changes (undo/redo) re-sync the
  // DOM without clobbering the caret while the user is typing.
  let lastLoaded = '';

  function setEditorContent(el: HTMLDivElement, value: string) {
    if (/[<>]/.test(value)) el.innerHTML = value;
    else el.textContent = value;
  }

  // Keep the contenteditable DOM in sync with data.text, but never while focused.
  $effect(() => {
    const el = editorEl;
    const incoming = data.text ?? '';
    if (!el || el === document.activeElement) return;
    if (incoming === lastLoaded) return;
    setEditorContent(el, incoming);
    lastLoaded = incoming;
  });

  async function persist(html: string) {
    lastLoaded = html;
    updateNodeData(id, { text: html });
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }

  function saveFromEditor() {
    if (editorEl) void persist(editorEl.innerHTML);
  }

  async function updateNoteData(patch: Partial<NoteNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }

  function handleResize(_event: unknown, params: ResizeParams) {
    liveWidth = Math.round(params.width);
  }

  function handleResizeEnd(_event: unknown, params: ResizeParams) {
    liveWidth = null;
    void updateNoteData({ width: Math.round(params.width) });
  }

  async function enterEdit(event: MouseEvent) {
    if (readOnly) return;
    event.stopPropagation();
    if (!editing) {
      editing = true;
      await tick();
    }
    const el = editorEl;
    if (!el) return;
    el.focus();
    // Drop the caret at the end of the note.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  // ── Rich-text formatting (execCommand keeps this dependency-free for an inline note) ──
  async function applyFormat(command: string, value?: string) {
    if (readOnly) return;
    if (!editing) {
      editing = true;
      await tick();
    }
    const el = editorEl;
    if (!el) return;
    el.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    saveFromEditor();
  }

  function pickColor(next: NoteColor) {
    openMenu = null;
    if (next !== color) void updateNoteData({ color: next });
  }

  function pickFont(family: string) {
    openMenu = null;
    applyFormat('fontName', family);
  }

  function pickSize(value: string) {
    openMenu = null;
    applyFormat('fontSize', value);
  }

  // ── Links: auto-linkify on blur, open externally on click ────────────────────
  function buildLinkedFragment(text: string): DocumentFragment {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of text.matchAll(URL_RE)) {
      const url = match[0];
      const start = match.index ?? 0;
      if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      const anchor = document.createElement('a');
      anchor.href = url.startsWith('www.') ? `https://${url}` : url;
      anchor.textContent = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'text-brand underline decoration-brand/40 underline-offset-2 cursor-pointer';
      frag.appendChild(anchor);
      lastIndex = start + url.length;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    return frag;
  }

  function linkify(root: HTMLElement) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      const text = node as Text;
      URL_RE.lastIndex = 0;
      if (!text.parentElement?.closest('a') && URL_RE.test(text.nodeValue ?? '')) targets.push(text);
      node = walker.nextNode();
    }
    for (const text of targets) {
      text.parentNode?.replaceChild(buildLinkedFragment(text.nodeValue ?? ''), text);
    }
  }

  function handleBlur() {
    editing = false;
    if (!editorEl || readOnly) return;
    linkify(editorEl);
    saveFromEditor();
  }

  function handleEditorClick(event: MouseEvent) {
    // While editing, let clicks place the caret (so link text stays editable).
    if (editing) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (anchor?.getAttribute('href')) {
      event.preventDefault();
      void openLinkInBrowser(anchor.getAttribute('href') ?? '');
    }
  }

  function handleEditorKeydown(event: KeyboardEvent) {
    // Keep Delete/Backspace inside the editor — they must not delete the node.
    if (event.key === 'Backspace' || event.key === 'Delete') event.stopPropagation();
  }
</script>

<!-- Width-only handles (left/right). Height is content-driven, so no vertical/corner
     controls — dragging the sides just changes where the text wraps. `handle` variant
     shows a grabbable dot centered on each side (works at any height, no edge line). -->
{#if selected && !readOnly}
  <NodeResizeControl
    variant={ResizeControlVariant.Handle}
    position="left"
    resizeDirection="horizontal"
    minWidth={MIN_WIDTH}
    color="var(--color-brand)"
    style="width:11px;height:11px;border-radius:9999px;border-width:2px;box-shadow:0 1px 3px rgb(0 0 0 / 0.25);"
    onResize={handleResize}
    onResizeEnd={handleResizeEnd}
  />
  <NodeResizeControl
    variant={ResizeControlVariant.Handle}
    position="right"
    resizeDirection="horizontal"
    minWidth={MIN_WIDTH}
    color="var(--color-brand)"
    style="width:11px;height:11px;border-radius:9999px;border-width:2px;box-shadow:0 1px 3px rgb(0 0 0 / 0.25);"
    onResize={handleResize}
    onResizeEnd={handleResizeEnd}
  />
{/if}

<div class="group relative" style="width: {width}px;" onmouseleave={() => (openMenu = null)} role="presentation">
  {#if !readOnly}
    <!-- Toolbar/drag-handle: revealed on hover. The padding-bottom bridges the gap to
         the card so the hover state survives while reaching for it. -->
    <div
      class="absolute -top-9 left-0 z-20 pb-2 opacity-0 transition-opacity duration-150 pointer-events-none
             group-hover:opacity-100 group-hover:pointer-events-auto"
    >
      <div class="nodrag nopan flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg">
        <button type="button" title="Bold" aria-label="Bold"
          onmousedown={(e) => e.preventDefault()} onclick={() => applyFormat('bold')}
          class="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-2">
          <Icon icon="lucide:bold" width="13" height="13" />
        </button>
        <button type="button" title="Italic" aria-label="Italic"
          onmousedown={(e) => e.preventDefault()} onclick={() => applyFormat('italic')}
          class="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-2">
          <Icon icon="lucide:italic" width="13" height="13" />
        </button>
        <button type="button" title="Underline" aria-label="Underline"
          onmousedown={(e) => e.preventDefault()} onclick={() => applyFormat('underline')}
          class="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-2">
          <Icon icon="lucide:underline" width="13" height="13" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border"></div>

        <!-- Font family -->
        <div class="relative">
          <button type="button" title="Font" aria-label="Font"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (openMenu = openMenu === 'font' ? null : 'font')}
            class="nodrag nopan flex h-6 items-center gap-0.5 rounded px-1.5 text-text-secondary hover:bg-surface-2">
            <Icon icon="lucide:type" width="13" height="13" />
            <Icon icon="lucide:chevron-down" width="10" height="10" />
          </button>
          {#if openMenu === 'font'}
            <div class="nodrag nopan absolute left-0 top-full z-30 mt-1 w-36 rounded-lg border border-border bg-surface py-1 shadow-xl">
              {#each FONTS as font}
                <button type="button"
                  onmousedown={(e) => e.preventDefault()} onclick={() => pickFont(font.family)}
                  class="block w-full px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-2"
                  style="font-family: {font.family};">
                  {font.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Font size -->
        <div class="relative">
          <button type="button" title="Text size" aria-label="Text size"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (openMenu = openMenu === 'size' ? null : 'size')}
            class="nodrag nopan flex h-6 items-center gap-0.5 rounded px-1.5 text-text-secondary hover:bg-surface-2">
            <Icon icon="lucide:case-sensitive" width="15" height="15" />
            <Icon icon="lucide:chevron-down" width="10" height="10" />
          </button>
          {#if openMenu === 'size'}
            <div class="nodrag nopan absolute left-0 top-full z-30 mt-1 flex gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-xl">
              {#each SIZES as size}
                <button type="button"
                  onmousedown={(e) => e.preventDefault()} onclick={() => pickSize(size.value)}
                  class="flex h-7 w-7 items-center justify-center rounded text-xs font-medium text-text-secondary hover:bg-surface-2">
                  {size.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="mx-0.5 h-4 w-px bg-border"></div>

        <!-- Color / no-background -->
        <div class="relative">
          <button type="button" title="Color" aria-label="Note color"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (openMenu = openMenu === 'color' ? null : 'color')}
            class="nodrag nopan flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-2">
            <Icon icon="lucide:palette" width="13" height="13" />
          </button>
          {#if openMenu === 'color'}
            <div class="nodrag nopan absolute right-0 top-full z-30 mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-surface p-1.5 shadow-xl">
              {#each COLOR_ORDER as swatchColor}
                <button type="button"
                  title={swatchColor === 'none' ? 'No background' : swatchColor}
                  aria-label={swatchColor === 'none' ? 'No background' : swatchColor}
                  onmousedown={(e) => e.preventDefault()} onclick={() => pickColor(swatchColor)}
                  class="flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110 {NOTE_COLORS[swatchColor].swatch}
                         {color === swatchColor ? 'ring-2 ring-brand ring-offset-1' : ''}">
                  {#if swatchColor === 'none'}
                    <Icon icon="lucide:ban" width="12" height="12" class="text-text-subtle" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <NodeDeleteButton {id} class={style.deleteBtn} />
      </div>
    </div>
  {/if}

  <!-- No fixed height: the card grows with the editor so the note is exactly as tall
       as its content (min = one placeholder line). Width is fixed → text wraps. -->
  <div class="relative w-full overflow-hidden rounded-lg {style.card} {style.shadow}">
    {#if isEmpty && !readOnly}
      <span class="pointer-events-none absolute left-3 top-2 text-sm leading-5 {style.placeholder}">Write a note…</span>
    {/if}
    <div
      bind:this={editorEl}
      contenteditable={editing && !readOnly}
      role="textbox"
      tabindex="0"
      aria-multiline="true"
      aria-label="Note text"
      title={editing || readOnly ? undefined : 'Double-click to edit · drag to move'}
      oninput={saveFromEditor}
      onblur={handleBlur}
      onclick={handleEditorClick}
      ondblclick={enterEdit}
      onkeydown={handleEditorKeydown}
      class="min-h-9 w-full whitespace-pre-wrap wrap-break-word px-3 py-2 text-sm leading-5 text-text outline-none
             {editing ? 'nodrag nopan cursor-text' : readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}"
    ></div>
  </div>
</div>
