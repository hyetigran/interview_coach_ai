/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  LOCAL_MEDIA_ADAPTER?: string;
  OPENAI_API_KEY?: string;
  CONTINUATION?: Workflow<{ confirmationId: string }>;
  DB: D1Database;
  MEDIA: R2Bucket;
  PROCESSING?: Workflow<{ jobId: string }>;
  RECORDING_ALLOWANCE?: string;
  AUTH_SECRET: string;
  APP_ORIGIN: string;
}
