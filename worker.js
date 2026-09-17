import nextWorker from './.open-next/worker.js';
import { createMediaModule } from './server/media';
export * from './.open-next/worker.js';
export default {
  fetch: (request, env, ctx) => nextWorker.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => ctx.waitUntil(createMediaModule(env).cleanup()),
};
