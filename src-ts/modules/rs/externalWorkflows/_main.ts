import type { LiatirAPI } from '../../../types';
import type {
  CollectExternalWorkflowOutputsOptions,
  ExternalWorkflowCollectedOutput,
  ExternalWorkflowRunLayout,
  ExternalWorkflowRuntimeInfo,
  ExternalWorkflowsInterface,
  PrepareExternalWorkflowRunOptions,
  SpawnExternalWorkflowNextflowOptions,
} from './_types';

/** App-internal filesystem boundary for safely staged External Workflow runs. */
export function buildExternalWorkflows(
  core: { invoke: LiatirAPI['invoke'] },
): ExternalWorkflowsInterface {
  return {
    runtimeInfo: () =>
      core.invoke<ExternalWorkflowRuntimeInfo>('lia_external_workflow_runtime_info'),
    prepareRun: (options: PrepareExternalWorkflowRunOptions) =>
      core.invoke<ExternalWorkflowRunLayout>('lia_external_workflow_prepare_run', { ...options }),
    spawnNextflow: (options: SpawnExternalWorkflowNextflowOptions) =>
      core.invoke<{ jobId: string }>('lia_external_workflow_spawn_nextflow', { ...options }),
    collectOutputs: (options: CollectExternalWorkflowOutputsOptions) =>
      core.invoke<ExternalWorkflowCollectedOutput[]>('lia_external_workflow_collect_outputs', { ...options }),
  };
}
