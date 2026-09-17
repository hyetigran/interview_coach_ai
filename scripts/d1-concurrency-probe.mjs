import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Diagnostic only: two runtimes reproduce unsafe concurrent ownership of local
// SQLite. One runtime is the control. Never opens application storage.
const count = Number(process.argv[2] ?? '2');
if (![1, 2].includes(count)) throw new Error('Usage: node scripts/d1-concurrency-probe.mjs [1|2]');
const directory = await mkdtemp(join(tmpdir(), 'coach-d1-concurrency-'));
const runtimes = [];
try {
  for (let index = 0; index < count; index++) {
    const runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: `export default { async fetch(request, env) {
        try {
          await env.DB.prepare('INSERT INTO probe(id) VALUES(?)').bind(crypto.randomUUID()).run();
          return new Response('ok');
        } catch (error) { return new Response(String(error), { status: 503 }); }
      } }`,
      d1Databases: { DB: 'probe-database' }, resourcePersistencePath: directory,
    }));
    runtimes.push(runtime);
    if (index === 0) await (await runtime.getD1Database('DB')).prepare('CREATE TABLE probe(id TEXT PRIMARY KEY)').run();
    await runtime.ready;
  }
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => runtimes[index % count].dispatchFetch('http://probe/').then(async response => ({ status: response.status, error: response.ok ? null : await response.text() }))));
  const failures = results.filter(result => result.status !== 200).length;
  console.log(JSON.stringify({ runtimes: count, writes: results.length, failures, errors: [...new Set(results.map(result => result.error).filter(Boolean))] }));
  process.exitCode = failures ? 1 : 0;
} finally {
  for (const runtime of runtimes) await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
