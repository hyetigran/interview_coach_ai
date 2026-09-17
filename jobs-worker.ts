import {createRuntimeCoachingRetry} from './server/coaching-retry';
import {createRuntimeGroupingRetry} from './server/grouping-retry';
import {createRuntimeTranscriptionRetry} from './server/transcription-retry';
import {createCoachingModule} from './server/coaching';
import {createReanalysisModule} from './server/reanalysis';
import { createGroupingModule } from './server/grouping';
import { createRuntimeSpeakers } from './server/speakers';
export { ContinuationWorkflow } from './server/continuation-workflow';
import { createTranscriptionModule } from './server/transcription';
import { createRuntimeProcessing } from './server/processing';
import { createMediaModule } from './server/media';
export { PreparationWorkflow } from './server/preparation-workflow';
export default {
  fetch: () => new Response('Local job worker ready'),
  scheduled: (_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(Promise.allSettled([createRuntimeCoachingRetry(env).reconcile(),createRuntimeGroupingRetry(env).reconcile(),createRuntimeTranscriptionRetry(env).reconcile(),createRuntimeProcessing(env).reconcile(), createMediaModule(env).cleanup(), createTranscriptionModule(env).reconcileReceipts(), createRuntimeSpeakers(env).reconcile(), createGroupingModule(env).reconcileReceipts(), createReanalysisModule(env).reconcile(),createCoachingModule(env).reconcileReceipts()]));
  },
};
