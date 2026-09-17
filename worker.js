import nextWorker from './.open-next/worker.js';
import { createMediaModule } from './server/media';
import { createRuntimeProcessing } from './server/processing';
export * from './.open-next/worker.js';
export default {
  fetch: (request, env, ctx) => nextWorker.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => ctx.waitUntil(Promise.all([createMediaModule(env).cleanup(), createRuntimeProcessing(env).reconcile()])),
};
