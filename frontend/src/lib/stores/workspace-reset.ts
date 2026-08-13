/**
 * Wires every workspace-scoped store into the workspace store's reset.
 *
 * This file exists to break a dependency cycle. Switching workspace has to clear all the
 * workspace-scoped stores, but the workspace store cannot import them — most of them already import
 * *it*. So instead of depending on them, it exposes a hook, and this module (which depends on
 * everything and is depended on by nothing) injects the implementation.
 *
 * The practical consequence: **a new workspace-scoped store must be registered here**, or its data
 * will leak across a workspace switch — one workspace showing another's contents.
 */
import { setResetFn, setDemoInitFn, setActivateFn, workspaceStore } from './workspace.svelte';
import { apiConnections } from './apiConnections.svelte';
import { pipelineStore } from './pipeline.svelte';
import { savedScripts } from './savedScripts.svelte';
import { dataFiles } from './dataFiles.svelte';
import { analysisRuns } from './analysisRuns.svelte';
import { liaPluginsStore } from './lia-plugins.svelte';
import { executionRuns } from './executionRuns.svelte';
import { externalWorkflowsStore } from './externalWorkflows.svelte';
import { reconcileExecutionResults } from '$lib/execution/finalization';

setResetFn((scope) => {
  // 'runs' is a partial reset: clear what a run produced (results, run state, output files) while
  // leaving the user's own work — their pipelines, scripts, API connections — untouched.
  if (scope === 'runs') {
    executionRuns.reset();
    analysisRuns.reset();
    pipelineStore.resetRuntime();
    dataFiles.clearResults();
    return;
  }

  // Full reset, on a workspace switch: every workspace-scoped store is cleared, so nothing from the
  // previous workspace can be observed in the next one.
  apiConnections.reset();
  executionRuns.reset();
  pipelineStore.reset();
  savedScripts.reset();
  dataFiles.reset();
  analysisRuns.reset();
  liaPluginsStore.reset();
  externalWorkflowsStore.reset();
});

// Same injection pattern: a brand-new workspace is seeded with demo files, but the workspace store
// must not depend on the data-files store to do it.
setDemoInitFn(() => dataFiles.initDemoFiles());

// A workspace that was not active at app startup can still contain a run left
// by an earlier process. Reconcile it as part of activation, before its pages
// observe Results or start new work.
setActivateFn(async () => {
  if (!workspaceStore.activeId) return;
  await executionRuns.init();
  await reconcileExecutionResults();
});
