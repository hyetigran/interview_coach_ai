import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaServer } from '../scripts/media-adapter.mjs';

const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('A private media-service secret of at least 32 characters is required.');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'interviewcoach-container-'));
const server = mediaServer(secret, temporaryRoot);
server.listen(8790, '0.0.0.0', () => console.log('Media service ready'));
process.once('SIGTERM', () => {
  server.close();
  server.closeAllConnections();
});

// Absolute lifetime survives a lost Worker request; process exit kills codec children.
setTimeout(() => process.exit(0), 120000).unref();
