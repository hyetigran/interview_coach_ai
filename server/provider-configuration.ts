// The app may enqueue retries while the secret stays in the separate job Worker.
// This flag is configuration only: execution still requires OPENAI_API_KEY there.
export function providerConfigured(env: {OPENAI_API_KEY?: string; OPENAI_JOBS_CONFIGURED?: string}) {
  return Boolean(env.OPENAI_API_KEY) || env.OPENAI_JOBS_CONFIGURED === 'true';
}
