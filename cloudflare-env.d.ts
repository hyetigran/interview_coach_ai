/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  PROCESSING?: Workflow<{ jobId: string }>;
  RECORDING_ALLOWANCE?: string;
  AUTH_SECRET: string;
  APP_ORIGIN: string;
}
