import { spawn } from 'node:child_process';
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; clearInterval(timer); for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } setTimeout(() => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } process.exit(code); }, 1000); }
function start(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env, detached: true }); children.push(child);
  child.on('error', () => stop(1)); child.on('exit', code => { if (!stopping) stop(code ?? 1); }); return child;
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
const timer = setInterval(() => { if (!stopping) fetch('http://127.0.0.1:8789/cdn-cgi/local/scheduled', { signal: AbortSignal.timeout(5000) }).catch(() => {}); }, 15000);
start('node', ['scripts/media-adapter.mjs']);
start('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.jobs.jsonc', '--ip', '127.0.0.1', '--port', '8789']);
let ready = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
  try { const response = await fetch('http://127.0.0.1:8789/'); if (response.ok && await response.text() === 'Local job worker ready') { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (ready && !stopping) start('pnpm', process.argv.includes('--worker') ? ['exec', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', '3000'] : ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3000']);
else stop(1);
