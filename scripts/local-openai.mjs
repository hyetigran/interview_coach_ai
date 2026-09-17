import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Wrangler prefers .dev.vars over .env. Copy only this server-side key into its
// ignored local secrets file; never print credentials or pass them as CLI args.
export function syncLocalOpenAI() {
  if (!existsSync('.env') || !existsSync('.dev.vars')) return false;
  const key = parseEnv(readFileSync('.env', 'utf8')).OPENAI_API_KEY?.trim();
  const existing = readFileSync('.dev.vars', 'utf8');
  const content = existing.replace(/^OPENAI_API_KEY=.*(?:\r?\n|$)/gm, '').trimEnd();
  writeFileSync('.dev.vars', `${content}\n${key ? `OPENAI_API_KEY=${JSON.stringify(key)}\n` : ''}`, { mode: 0o600 });
  return Boolean(key);
}
