# Interview Coach AI

An invited pilot for software-engineering candidates reviewing recordings of hiring and mock interviews. Product requirements, architecture, glossary, and decisions are maintained in the repository documentation.

The first implementation slice provides invitation-gated accounts and private persisted review metadata. Recording ingestion and coaching remain subsequent tickets. The fictional interaction prototype is available at `/example`; it is separate from private reviews.

## Local development

Use Node.js 22 and the pinned pnpm version.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate:local
pnpm invite candidate@example.com
pnpm dev
```

Open `http://127.0.0.1:3000/sign-in`, choose “Have an invitation? Create account,” and use the code printed by the invitation command. Codes expire after seven days, are stored only as hashes, and are consumed after registration. Share real invitation codes privately. The CLI intentionally rejects duplicate email invitations instead of silently reactivating revoked access.

Local authentication secrets live in the ignored `.dev.vars` file. Never commit secrets, recordings, or transcripts. Authentication uses Better Auth email/password sessions with D1 persistence; public registration requires a valid invitation. Every review read/write checks the server-derived owner and active invitation. Operator revocation is an administrative update to the invitation's `revoked` flag; no public administration route exists.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Integration tests use real local D1 through Miniflare. Browser tests run the built application through Wrangler, including invitation, sign-in, create, reload, sign-out/sign-in, and deletion. Run local migrations and the Workers build before browser tests. Tests require loopback networking; no cloud credentials are required.

## Cloudflare deployment

Preview and production use distinct Workers and D1 databases. The repository configuration contains the provisioned database IDs and exact application origins. Preview is deployed at https://interview-coach-preview.hyetigran.workers.dev; production has an isolated database and secret but the application has not been deployed there. Never bind preview to production storage.

1. Authenticate using `wrangler login` or a scoped Cloudflare API token.
2. Create the preview and production D1 databases and record each returned ID under its matching environment binding.
3. Set each environment's `APP_ORIGIN` to its exact HTTPS application origin, and set a distinct `AUTH_SECRET` with `wrangler secret put AUTH_SECRET --env <environment>`.
4. Connect Workers Builds to this repository with locked dependency installation and `pnpm lint && pnpm typecheck && pnpm test && pnpm build` as the checked build sequence. Serialize production deployments.
5. Apply reviewed migrations to the selected environment before publishing the compatible Worker: `pnpm exec wrangler d1 migrations apply DB --remote --env <environment>`.
6. Deploy with `pnpm exec opennextjs-cloudflare deploy --env <environment>` and run the create/reopen/isolation/delete smoke checks against that deployed origin.

Use backward-compatible migrations: rolling back a Worker does not undo database changes. Keep all auth secrets server-side. Remote invitations require both `--remote` and an explicit `--env preview` or `--env production`.

Successful local build/testing does not establish a deployed smoke result. Track that evidence on the originating ticket before closing it.

After preview deployment, run the same browser flow against its exact origin:

```sh
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.<account-subdomain>.workers.dev pnpm test:e2e
```

This command creates two synthetic invited accounts in preview D1 using the authenticated Wrangler CLI. It verifies unauthenticated denial, owner isolation, same-origin mutation protection, create/reload/new-session persistence, and deletion. It deletes the test review; synthetic accounts remain in preview. The test refuses production origins.

### Deployment evidence (2026-09-17 UTC)

Preview Worker version `559b7f80-767b-4052-a9b9-4cddb6743b40` passed the deployed browser smoke test (23.8 seconds): invited registration, create/reload/new-session persistence, unauthenticated denial, cross-owner read/list/delete isolation, cross-origin mutation rejection, and owner deletion. Both isolated D1 databases have migration `0000_reviews.sql`; each environment has a separately generated `AUTH_SECRET` stored in Cloudflare.

Workers Builds is not yet connected. The CLI OAuth credential receives HTTP 403 from its API. Connect the preview Worker to `hyetigran/interview_coach_ai` in Settings → Builds using the persistent `staging` branch. Feature PRs merge into staging after review and CI; deployed acceptance then gates ticket closure. A separate release PR promotes accepted changes from staging to main. Use:

- Build: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm exec opennextjs-cloudflare build --env preview`
- Deploy: `pnpm exec wrangler d1 migrations apply DB --remote --env preview && pnpm exec opennextjs-cloudflare deploy --env preview`

Require a successful connected staging build before treating the selected deployment path as complete. Production app deployment remains a separate release action.

GitHub checks run on feature PRs and pushes to both `staging` and `main`. Set the preview Worker’s build branch to `staging`; do not connect its preview database to the production Worker.

`pnpm build` produces the complete OpenNext Worker bundle, including `.open-next/.build/open-next.config.edge.mjs`. `pnpm build:next` runs only the underlying Next.js compiler and is not sufficient for Cloudflare deployment. OpenNext explicitly invokes `build:next` to avoid recursively invoking itself.
