import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createApplication } from '@/server/application';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  return createApplication(env).fetch(request);
}
export { handle as GET, handle as POST, handle as DELETE, handle as PUT, handle as PATCH, handle as HEAD };
