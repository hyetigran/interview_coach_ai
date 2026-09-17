/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  MEDIA_PROCESSOR?: DurableObjectNamespace;
  LOCAL_API_ORIGIN?: string;
  LOCAL_MEDIA_ADAPTER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_JOBS_CONFIGURED?: string;
  CONTINUATION?: Workflow<{ confirmationId: string; coachingRunId?: string }>;
  DB: D1Database;
  MEDIA: R2Bucket;
  PROCESSING?: Workflow<{ jobId: string }>;
  RECORDING_ALLOWANCE?: string;
  AUTH_SECRET: string;
  APP_ORIGIN: string;
}
