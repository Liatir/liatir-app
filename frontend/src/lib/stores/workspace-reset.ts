import { setResetFn, setDemoInitFn } from './workspace.svelte';
import { apiConnections } from './apiConnections.svelte';
import { pipelineStore } from './pipeline.svelte';
import { savedScripts } from './savedScripts.svelte';
import { dataFiles } from './dataFiles.svelte';
import { analysisRuns } from './analysisRuns.svelte';
import { modulesStore } from './modules.svelte';

setResetFn(() => {
  apiConnections.reset();
  pipelineStore.reset();
  savedScripts.reset();
  dataFiles.reset();
  analysisRuns.reset();
  modulesStore.reset();
});

setDemoInitFn(() => dataFiles.initDemoFiles());
