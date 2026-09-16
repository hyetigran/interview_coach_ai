import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars', `AUTH_SECRET=${randomBytes(48).toString('hex')}\nAPP_ORIGIN=http://127.0.0.1:3000\n`, { mode: 0o600 });
  console.log('Created private local authentication configuration.');
} else console.log('Existing local configuration preserved.');
