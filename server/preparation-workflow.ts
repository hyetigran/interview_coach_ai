import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createRuntimeProcessing } from './processing';
export class PreparationWorkflow extends WorkflowEntrypoint<CloudflareEnv, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const processing = createRuntimeProcessing(this.env);
    try {
      await step.do('validate-and-checkpoint-audio', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '90 seconds' }, () => processing.prepare(event.payload.jobId));
    } catch (error) {
      await step.do('record-preparation-failure', () => processing.fail(event.payload.jobId, error instanceof Error ? error.message : undefined));
    }
    await step.do('dispatch-next-waiting-recording', () => processing.reconcile());
  }
}
