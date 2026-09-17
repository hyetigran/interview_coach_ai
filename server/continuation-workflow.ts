import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createGroupingModule } from './grouping';
import { createRuntimeSpeakers } from './speakers';
export class ContinuationWorkflow extends WorkflowEntrypoint<CloudflareEnv, { confirmationId: string }> {
  async run(event: WorkflowEvent<{ confirmationId: string }>, step: WorkflowStep) {
    const speakers = createRuntimeSpeakers(this.env);
    const grouping = createGroupingModule(this.env);
    const id = event.payload.confirmationId;
    const count = await step.do('persist-grouping-intent', () => grouping.begin(id));
    await step.do('validate-persisted-speaker-confirmation', async () => { await speakers.resume(id); });
    for (let ordinal = 0; ordinal < count; ordinal++) await step.do(`group-section-${ordinal}`, { timeout: '2 minutes', retries: { limit: 0, delay: '1 second' } }, () => grouping.runChunk(id, ordinal));
    await step.do('finish-grouping', () => grouping.finish(id));
    await step.do('dispatch-next-confirmation', () => speakers.reconcile());
  }
}
