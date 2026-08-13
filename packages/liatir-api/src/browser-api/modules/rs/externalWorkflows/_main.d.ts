import type { LiatirAPI } from '../../../types';
import type { ExternalWorkflowsInterface } from './_types';
/** App-internal filesystem boundary for safely staged External Workflow runs. */
export declare function buildExternalWorkflows(core: {
    invoke: LiatirAPI['invoke'];
}): ExternalWorkflowsInterface;
