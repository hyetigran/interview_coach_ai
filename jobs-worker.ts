import { createRuntimeSpeakers } from './server/speakers';
export { ContinuationWorkflow } from './server/continuation-workflow';
import { createTranscriptionModule } from './server/transcription';
import { createRuntimeProcessing } from './server/processing';
import { createMediaModule } from './server/media';
export { PreparationWorkflow } from './server/preparation-workflow';
export default {
  fetch: () => new Response('Local job worker ready'),
  scheduled: (_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(Promise.all([createRuntimeProcessing(env).reconcile(), createMediaModule(env).cleanup(), createTranscriptionModule(env).cleanup(), createRuntimeSpeakers(env).reconcile()]));
  },
};
