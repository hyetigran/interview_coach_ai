import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createApplication } from '@/server/application';
import { forwardLocalApplication } from '@/server/local-application';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  if (env.LOCAL_API_ORIGIN) return forwardLocalApplication(request, env);
  return createApplication(env).fetch(request);
}
export { handle as GET, handle as POST, handle as DELETE, handle as PUT, handle as PATCH, handle as HEAD };
