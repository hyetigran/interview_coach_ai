import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
const [input, ...flags] = process.argv.slice(2);
const email = z.email().parse((input ?? '').trim().toLowerCase());
const remote = flags.includes('--remote');
const target = flags[flags.indexOf('--env') + 1];
if (remote && !['preview', 'production'].includes(target)) throw new Error('Remote invitations require --env preview or --env production.');
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
const folder = mkdtempSync(join(tmpdir(), 'interview-coach-invite-'));
try {
  const file = join(folder, 'invite.sql');
  const quotedEmail = email.replaceAll("'", "''");
  writeFileSync(file, `INSERT INTO invitations (email, token_hash, expires_at) VALUES ('${quotedEmail}', '${hash}', ${Date.now() + 7 * 86400000});`, { mode: 0o600 });
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--file', file, ...(remote ? ['--remote', '--env', target] : ['--local'])], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`Invitation for ${email}; expires in seven days. Share privately:\n${token}`);
} finally { rmSync(folder, { recursive: true, force: true }); }
