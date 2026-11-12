<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { python } from '@codemirror/lang-python';
  import { Compartment, EditorState } from '@codemirror/state';
  import { javascript } from '@codemirror/lang-javascript';
  import { keymap } from '@codemirror/view';
  import { indentWithTab } from '@codemirror/commands';
  import { type Extension } from '@codemirror/state';
  import { liatirTheme, reconfigureTheme, liatirCompletions, liatirHover } from '$lib/liatir-editor';
  import { settingsStore } from '$lib/stores/settings.svelte';

  interface Props {
    value: string;
    language?: 'javascript' | 'python';
    readonly?: boolean;
    onchange?: (v: string) => void;
    onrun?: () => void;
    class?: string;
  }

  let { value, onchange, onrun, language = 'javascript', readonly = false, class: cls = '' }: Props = $props();

  const editability = new Compartment();
  let container: HTMLDivElement;
  let view: EditorView | null = null;

  onMount(() => {
    view = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        language === 'python' ? python() : javascript({ typescript: true }),
        editability.of([EditorView.editable.of(!readonly), EditorState.readOnly.of(readonly)]),
        liatirTheme(settingsStore.resolvedTheme),
        ...(language === 'python' ? [] : [liatirCompletions, liatirHover]),
        keymap.of([
          indentWithTab,
          { key: 'Mod-Enter', run: () => { onrun?.(); return true; } },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onchange?.(update.state.doc.toString());
          }
        }),
        EditorView.contentAttributes.of({ 'data-selectable': '' }),
      ] as Extension[],
      parent: container,
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  $effect(() => {
    if (view) view.dispatch({ effects: editability.reconfigure([EditorView.editable.of(!readonly), EditorState.readOnly.of(readonly)]) });
  });

  // Sync external value changes into the editor (e.g. loading a saved script)
  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  });

  // Swap the editor theme in place, keeping undo history and cursor intact.
  $effect(() => {
    const theme = settingsStore.resolvedTheme;
    if (view) reconfigureTheme(view, theme);
  });
</script>

<div
  bind:this={container}
  class="h-full overflow-hidden rounded-xl border border-border focus-within:border-brand transition-colors {cls}"
></div>
