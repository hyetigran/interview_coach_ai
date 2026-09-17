import type { WorkflowStep } from 'cloudflare:workers';
import type { createGroupingModule } from './grouping';
export async function runGroupingSections(step:Pick<WorkflowStep,'do'>, grouping:Pick<ReturnType<typeof createGroupingModule>,'runChunk'|'interruptChunk'|'finish'>, id:string, count:number, finish=true) {
  for(let ordinal=0;ordinal<count;ordinal++) {
    try {await step.do(`group-section-${ordinal}`,{timeout:'2 minutes',retries:{limit:0,delay:'1 second'}},()=>grouping.runChunk(id,ordinal));}
    catch {await step.do(`interrupt-section-${ordinal}`,()=>grouping.interruptChunk(id,ordinal));}
  }
  if(finish) await step.do('finish-grouping',()=>grouping.finish(id));
}
