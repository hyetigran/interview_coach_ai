import { runGroupingSections } from './grouping-steps';
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
    await runGroupingSections(step, grouping, id, count);
    await step.do('dispatch-next-confirmation', () => speakers.reconcile());
  }
}
