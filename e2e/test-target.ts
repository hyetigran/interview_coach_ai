const preview = process.env.E2E_PREVIEW_ORIGIN;
if (preview && !/^https:\/\/interview-coach-preview\.[a-z0-9-]+\.workers\.dev$/.test(preview)) {
  throw new Error('E2E_PREVIEW_ORIGIN must point to the HTTPS preview Worker.');
}
export const testOrigin = preview ?? 'http://127.0.0.1:3000';
export const invitationFlags = preview ? ['--remote', '--env', 'preview'] : [];
export const databaseFlags = preview ? ['--remote', '--env', 'preview'] : ['--local'];
export const storageFlags = preview ? ['--remote'] : ['--local'];
export const mediaBucket = preview ? 'interview-coach-preview-media' : 'interview-coach-local-media';
