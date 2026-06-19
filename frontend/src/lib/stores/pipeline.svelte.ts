import { liatir } from '$lib/api';
import { dataFiles } from './dataFiles.svelte';
import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
import type { PipelineStepState } from '$lib/types/pipeline';

function createPipelineStore() {
  let steps = $state<PipelineStepState[]>([]);
  let running = $state(false);

  function addStep(stepId: string) {
    const entry = PIPELINE_REGISTRY[stepId];
    if (!entry) return;
    steps.push({
      id: crypto.randomUUID(),
      stepId,
      inputs: {},
      status: 'pending',
      logs: [],
      outputFiles: [],
      error: null,
    });
  }

  function removeStep(index: number) {
    steps.splice(index, 1);
  }

  function setInput(stepIndex: number, key: string, value: string) {
    steps[stepIndex].inputs = { ...steps[stepIndex].inputs, [key]: value };
  }

  function moveStep(index: number, direction: 'up' | 'down' | 'first' | 'last') {
    if (running) return;
    const n = steps.length;
    if (index < 0 || index >= n) return;
    const arr = [...steps];
    const [item] = arr.splice(index, 1);
    if (direction === 'up')         arr.splice(Math.max(0, index - 1), 0, item);
    else if (direction === 'down')  arr.splice(Math.min(n - 1, index + 1), 0, item);
    else if (direction === 'first') arr.unshift(item);
    else                            arr.push(item);
    steps = arr;
  }

  function resetStatuses() {
    for (const s of steps) {
      s.status = 'pending';
      s.logs = [];
      s.outputFiles = [];
      s.error = null;
    }
  }

  async function run() {
    if (running || steps.length === 0) return;
    const api = liatir();
    if (!api) return;

    const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    const outputDir = `${data}/tool-outputs`;

    running = true;
    resetStatuses();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const entry = PIPELINE_REGISTRY[step.stepId];
      if (!entry) { step.status = 'error'; step.error = `Unknown step: ${step.stepId}`; break; }

      step.status = 'running';

      try {
        const result = await entry.run(
          step.inputs,
          outputDir,
          (line) => { step.logs.push(line); }
        );

        step.outputFiles = result.outputFiles;
        step.status = 'done';

        for (const f of result.outputFiles) {
          await dataFiles.add(f.path).catch(() => {});
        }
      } catch (e) {
        step.status = 'error';
        step.error = String(e);
        step.logs.push(`✗ ${String(e)}`);
        break;
      }
    }

    running = false;
  }

  function clear() {
    steps = [];
    running = false;
  }

  return {
    get steps() { return steps; },
    get running() { return running; },
    addStep,
    removeStep,
    setInput,
    moveStep,
    run,
    clear,
  };
}

export const pipelineStore = createPipelineStore();
