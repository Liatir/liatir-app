<script lang="ts">
  import { onMount } from 'svelte';
  import { createWorkspaceStore } from '@scalar/workspace-store/client';
  import type { WorkspacePlugin } from '@scalar/workspace-store/workspace-plugin';
  import { createApiClientModal } from '@scalar/api-client/v2/features/modal';
  import '@scalar/api-client/style.css';
  import { liatir } from '$lib/api';

  const SAVE_FILE = 'scalar-workspace.json';
  let containerEl: HTMLElement | null = $state(null);

  // Starter document — must have at least one path/method so Scalar renders
  // the full UI instead of the "No document selected" fallback.
  const STARTER_DOC = {
    openapi: '3.1.0',
    info: { title: 'My API', version: '1.0.0' },
    paths: {
      '/example': {
        get: {
          summary: 'Example request',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };

  onMount(() => {
    if (!containerEl) return;
    const api = liatir();
    if (!api) return;

    let exportFn: (() => unknown) | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (!exportFn) return;
        try {
          const snapshot = exportFn();
          await api.desktop.fs.data.writeText(
            SAVE_FILE,
            JSON.stringify(snapshot, null, 2),
            { createDirs: true }
          );
        } catch {}
      }, 800);
    };

    const plugin: WorkspacePlugin = {
      hooks: { onWorkspaceStateChanges: scheduleSave },
    };

    const store = createWorkspaceStore({ plugins: [plugin] });
    exportFn = () => store.exportWorkspace();

    let modal: ReturnType<typeof createApiClientModal> | null = null;

    const hasNavigablePaths = () => {
      const docs = store.workspace?.documents ?? {};
      return Object.values(docs).some(
        (doc: unknown) =>
          doc &&
          typeof doc === 'object' &&
          Object.keys((doc as Record<string, unknown>).paths ?? {}).length > 0
      );
    };

    const initialize = async () => {
      try {
        if (await api.desktop.fs.data.exists(SAVE_FILE)) {
          const raw = await api.desktop.fs.data.readText(SAVE_FILE);
          store.loadWorkspace(JSON.parse(raw));
        }
      } catch {}

      // If no document with paths exists (first run or corrupted save), seed starter doc
      if (!hasNavigablePaths()) {
        await store.addDocument({ name: 'default', document: STARTER_DOC }).catch(() => {});
      }

      if (!containerEl) return;
      modal = createApiClientModal({ el: containerEl, workspaceStore: store });
      modal.open();
    };

    initialize();

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (exportFn) {
        try {
          const snapshot = exportFn();
          api.desktop.fs.data
            .writeText(SAVE_FILE, JSON.stringify(snapshot, null, 2), { createDirs: true })
            .catch(() => {});
        } catch {}
      }
      modal?.app?.unmount();
    };
  });
</script>

<!--
  transform: translate(0, 0) promotes this element to a CSS containing block —
  Scalar's position:fixed children become fixed relative to this element
  instead of the full viewport, keeping Scalar within the content area.
-->
<div
  bind:this={containerEl}
  class="w-full h-full"
  style="transform: translate(0, 0)"
></div>

<style>
  /*
   * Scalar is designed as a floating modal. We embed it full-page, so we strip
   * the modal chrome: dark backdrop, rounded border, max-width, centering margin.
   * The × close button is a ::before pseudo-element on .scalar-app-exit — hiding
   * the parent element removes it along with the backdrop.
   */

  /* Hide the dark overlay backdrop and the × close pseudo-element */
  :global(.scalar-app-exit) {
    display: none !important;
  }

  /* Make the dialog panel fill our container instead of floating */
  :global(.scalar .scalar-app-layout) {
    height: 100% !important;
    max-width: none !important;
    border-radius: 0 !important;
    border: none !important;
    margin: 0 !important;
  }

  /* Remove the centering flex layout from the container */
  :global(.scalar-container) {
    display: block !important;
    height: 100% !important;
  }
</style>
