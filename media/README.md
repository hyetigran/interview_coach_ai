# Preview media runtime

The app and job Worker use a private `MEDIA_PROCESSOR` Durable Object binding. The separate `wrangler.media.jsonc` deployment has no public route. Local development keeps the authenticated loopback adapter.

Each extraction or compression path names one durable object. Admission reserves $0.10 in the preview D1 processing ledger before starting compute and persists a consumed marker. Duplicate dispatch cannot restart that attempt, including after a lost result or process crash. An explicit candidate retry uses the existing next-attempt identity only after prior media execution is known to have completed or its uncertain outcome is reconciled. Admission repeats the current D1 lifecycle, revision, attempt and deadline predicates atomically with its reservation. Deletion marks the object consumed before destroying compute, so cancellation before dispatch also prevents a late start. Original/derivative storage and late publication remain governed by the existing review lifecycle checks and cleanup prefixes.

The container runs as a non-root user with no outbound Internet access, receives a generated per-start service secret, and never receives the OpenAI key. Only the media adapter and entrypoint enter the image build context. The image process exits after 120 seconds; the controller also schedules destruction after 120 seconds and destroys compute when the output stream completes or is cancelled. Codec operations retain their 75-second timeout and byte/duration limits. No source or result is persisted in the controller; its durable storage contains only execution/scheduling metadata.

The preview uses `basic` (0.25 vCPU, 1 GiB RAM, 4 GB disk), at most three instances. At the published rates, even 180 seconds at full allocated CPU/memory/disk is under $0.002 in compute; $0.10 reserves additional transfer/rounding margin for the bounded input and output. This is a conservative policy reservation, not a Cloudflare invoice. Actual charges remain unknown and the full reservation stays counted against the $50 allowance until an operator reconciles billing. When the output stream ends and container destruction succeeds, a durable completion timestamp records the known execution outcome. This permits continuation and later work while retaining the entire cost reservation. Missing completion evidence participates in the existing account admission guard and blocks replacement attempts until operator reconciliation. Never settle an unknown charge to zero or automatically resubmit it. Hosting, image storage and ordinary D1/R2/Worker charges remain separately reported. Recheck rates and bounds before changing instance size, deadlines, formats or output limits.

Sources checked 2026-09-17: [instance types](https://developers.cloudflare.com/containers/platform/limits/), [pricing](https://developers.cloudflare.com/containers/platform/pricing/), [container lifecycle interface](https://developers.cloudflare.com/containers/reference/container-class/).

## Verification and deployment

Build and exercise the real Linux image using synthetic media:

```sh
docker build --platform linux/amd64 -f media/Dockerfile -t interview-coach-media:local-test .
node scripts/test-media-container.mjs interview-coach-media:local-test
node scripts/test-media-container.mjs interview-coach-media:local-test --long-compression
pnpm lint
pnpm typecheck
pnpm test
pnpm exec wrangler deploy --config wrangler.media.jsonc --dry-run
```

Apply migration 0031 to preview D1 before deploying any of these bundles. Deploy in dependency order: private media Worker, job Worker/Workflows, then the preview app. Configure the OpenAI secret on the job Worker without putting it in code or build arguments. Set the app environment variable `OPENAI_JOBS_CONFIGURED=true` only after that secret is configured; remove the flag if the job runtime is disabled. The flag enables retry controls without copying the key into the app, and provider execution still requires the real key. Production has no hosted media binding and is outside this change.

```sh
pnpm exec wrangler d1 migrations apply DB --remote --env preview
pnpm exec wrangler deploy --config wrangler.media.jsonc
pnpm exec wrangler deploy --config wrangler.jobs.jsonc --env preview
pnpm run build --env preview
pnpm exec opennextjs-cloudflare deploy --env preview
```

Deployed acceptance remains outstanding until actual preview extraction/compression, Workflow continuation, playback, cancellation/deletion and billing observations are recorded. This implementation does not complete the independent quality evaluation or candidate pilot.
