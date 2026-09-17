import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export async function hashInvitation(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

export function createAuth(env: CloudflareEnv) {
  const db = drizzle(env.DB);
  return betterAuth({
    appName: 'Interview Coach', baseURL: env.APP_ORIGIN, secret: env.AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === '/sign-in/email') {
          const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
          const invitation = await db.select({ email: schema.invitations.email }).from(schema.invitations)
            .where(and(eq(schema.invitations.email, email), eq(schema.invitations.revoked, false))).get();
          if (!invitation) throw new APIError('FORBIDDEN', { message: 'Unable to sign in with these credentials.' });
        }
        if (ctx.path !== '/sign-up/email') return;
        const token = ctx.headers?.get('x-invitation-token');
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
        if (!token || token.length < 32 || token.length > 256) throw new APIError('FORBIDDEN', { message: 'A valid invitation is required.' });
        const invitation = await db.select().from(schema.invitations).where(and(
          eq(schema.invitations.email, email), eq(schema.invitations.tokenHash, await hashInvitation(token)),
          eq(schema.invitations.revoked, false), isNull(schema.invitations.consumedAt), gt(schema.invitations.expiresAt, Date.now()),
        )).get();
        if (!invitation) throw new APIError('FORBIDDEN', { message: 'A valid invitation is required.' });
      }),
      after: createAuthMiddleware(async ctx => {
        if (ctx.path === '/sign-up/email' && ctx.context.newSession) {
          await db.update(schema.invitations).set({ consumedAt: Date.now() }).where(eq(schema.invitations.email, ctx.context.newSession.user.email));
        }
      }),
    },
  });
}
