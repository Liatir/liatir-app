import { setResetFn, setDemoInitFn } from './workspace.svelte';
import { apiConnections } from './apiConnections.svelte';
import { pipelineStore } from './pipeline.svelte';
import { savedScripts } from './savedScripts.svelte';
import { dataFiles } from './dataFiles.svelte';
import { analysisRuns } from './analysisRuns.svelte';
import { liaPluginsStore } from './lia-plugins.svelte';

setResetFn(() => {
  apiConnections.reset();
  pipelineStore.reset();
  savedScripts.reset();
  dataFiles.reset();
  analysisRuns.reset();
  liaPluginsStore.reset();
});

setDemoInitFn(() => dataFiles.initDemoFiles());
