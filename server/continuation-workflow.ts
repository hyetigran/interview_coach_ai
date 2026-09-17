import {createRuntimeCoachingRetry} from './coaching-retry';
import {createRuntimeGroupingRetry} from './grouping-retry';
import {createReanalysisModule} from './reanalysis';
import { createCoachingModule } from './coaching';
import { runGroupingSections } from './grouping-steps';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createGroupingModule } from './grouping';
import { createRuntimeSpeakers } from './speakers';
export class ContinuationWorkflow extends WorkflowEntrypoint<CloudflareEnv, { confirmationId: string; coachingRunId?: string; groupingRecoveryId?:string; coachingRecoveryId?:string }> {
  async run(event: WorkflowEvent<{ confirmationId: string; coachingRunId?: string; groupingRecoveryId?:string; coachingRecoveryId?:string }>, step: WorkflowStep) {
    const speakers = createRuntimeSpeakers(this.env);
    const grouping = createGroupingModule(this.env);
    const id = event.payload.confirmationId;
    if(event.payload.groupingRecoveryId){
      const recovery=await step.do('load-grouping-retry',()=>createRuntimeGroupingRetry(this.env).work(event.payload.groupingRecoveryId!));
      if(!recovery)return;
      for(const item of recovery.steps){
        try{await step.do(`retry-section-${item.ordinal}`,{timeout:'2 minutes',retries:{limit:0,delay:'1 second'}},()=>grouping.runChunk(recovery.runId,item.ordinal,item.attempt));}
        catch{await step.do(`interrupt-retry-${item.ordinal}`,()=>grouping.interruptChunk(recovery.runId,item.ordinal,item.attempt));}
        await step.do(`publish-retry-${item.ordinal}`,{timeout:'90 seconds',retries:{limit:2,delay:'2 seconds',backoff:'exponential'}},()=>grouping.recoverReceipt(recovery.runId,item.ordinal));
      }
      await step.do('finish-grouping-retry',()=>grouping.finish(recovery.runId));return;
    }
    const coaching=createCoachingModule(this.env);
    if(event.payload.coachingRecoveryId){
      const recovery=await step.do('load-coaching-retry',()=>createRuntimeCoachingRetry(this.env).work(event.payload.coachingRecoveryId!));
      if(!recovery)return;
      try{await step.do('retry-coaching',{timeout:'4 minutes',retries:{limit:0,delay:'1 second'}},()=>coaching.run(recovery.jobId,recovery.attempt));}
      catch{await step.do('interrupt-coaching-retry',()=>coaching.interrupt(recovery.jobId,recovery.attempt));}
      await step.do('publish-coaching-retry',{timeout:'90 seconds',retries:{limit:2,delay:'2 seconds',backoff:'exponential'}},()=>coaching.recoverReceipts(recovery.jobId));
      await step.do('finish-coaching-retry',()=>coaching.finish(recovery.runId));return;
    }
    const runId=event.payload.coachingRunId??id;
    let jobs:string[];
    if(event.payload.coachingRunId) {
      jobs=await step.do('persist-reanalysis-jobs',()=>coaching.begin(id,runId));
    } else {
      const count=await step.do('persist-grouping-intent',()=>grouping.begin(id));
      await step.do('validate-persisted-speaker-confirmation',async()=>{await speakers.resume(id);});
      await runGroupingSections(step,grouping,id,count,false);
      jobs=await step.do('persist-coaching-intent',()=>coaching.begin(id));
      await step.do('finish-grouping',()=>grouping.finish(id));
    }
    for(const job of jobs) {
      try {await step.do(`coach-${job}`,{timeout:'4 minutes',retries:{limit:0,delay:'1 second'}},()=>coaching.run(job));}
      catch {await step.do(`interrupt-${job}`,()=>coaching.interrupt(job));}
    }
    for(const job of jobs)await step.do(`publish-saved-${job}`,{timeout:'90 seconds',retries:{limit:2,delay:'2 seconds',backoff:'exponential'}},()=>coaching.recoverReceipts(job));
    await step.do('finish-coaching',()=>coaching.finish(runId));
    await step.do('dispatch-next-reanalysis',()=>createReanalysisModule(this.env).reconcile());
    await step.do('dispatch-next-confirmation', () => speakers.reconcile());
  }
}
