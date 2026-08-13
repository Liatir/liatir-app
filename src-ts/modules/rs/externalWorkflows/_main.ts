import type { LiatirAPI } from '../../../types';
import type {
  CollectExternalWorkflowOutputsOptions,
  ExternalWorkflowCollectedOutput,
  ExternalWorkflowRunLayout,
  ExternalWorkflowsInterface,
  PrepareExternalWorkflowRunOptions,
} from './_types';

/** App-internal filesystem boundary for safely staged External Workflow runs. */
export function buildExternalWorkflows(
  core: { invoke: LiatirAPI['invoke'] },
): ExternalWorkflowsInterface {
  return {
    prepareRun: (options: PrepareExternalWorkflowRunOptions) =>
      core.invoke<ExternalWorkflowRunLayout>('lia_external_workflow_prepare_run', { ...options }),
    collectOutputs: (options: CollectExternalWorkflowOutputsOptions) =>
      core.invoke<ExternalWorkflowCollectedOutput[]>('lia_external_workflow_collect_outputs', { ...options }),
  };
}
