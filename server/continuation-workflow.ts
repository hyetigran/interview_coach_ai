import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createRuntimeSpeakers } from './speakers';
export class ContinuationWorkflow extends WorkflowEntrypoint<CloudflareEnv, { confirmationId: string }> {
  async run(event: WorkflowEvent<{ confirmationId: string }>, step: WorkflowStep) {
    const speakers = createRuntimeSpeakers(this.env);
    await step.do('validate-persisted-speaker-confirmation', async () => { await speakers.resume(event.payload.confirmationId); });
    await step.do('dispatch-next-confirmation', () => speakers.reconcile());
  }
}
