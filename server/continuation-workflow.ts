import { createCoachingModule } from './coaching';
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
    const coaching=createCoachingModule(this.env);
    await runGroupingSections(step, grouping, id, count, false);
    const jobs=await step.do('persist-coaching-intent',()=>coaching.begin(id));
    await step.do('finish-grouping',()=>grouping.finish(id));
    for(const job of jobs) {
      try {await step.do(`coach-${job}`,{timeout:'4 minutes',retries:{limit:0,delay:'1 second'}},()=>coaching.run(job));}
      catch {await step.do(`interrupt-${job}`,()=>coaching.interrupt(job));}
    }
    await step.do('finish-coaching',()=>coaching.finish(id));
    await step.do('dispatch-next-confirmation', () => speakers.reconcile());
  }
}
