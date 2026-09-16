# Interview Coach

Product and architecture plans are in [PRD.md](./docs/PRD.md) and
[ARCHITECTURE.md](./docs/ARCHITECTURE.md). The current application is an interactive frontend prototype of the selected review-workspace design.

## Run the prototype

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000 and use the Landing page / Dashboard tabs.

The UI uses official shadcn/ui components with the supplied
[preset b7BFcVLrE](https://ui.shadcn.com/create?preset=b7BFcVLrE):
Nova (Base UI), Green theme, Mist base, Inter, Lucide, and default radius.
Configuration is in `components.json`; generated theme tokens are in
`app/globals.css`. Inter is bundled locally.

The prototype supports question selection, source inspection, edited revisions,
saved answers, and preparation priorities. All data is fictional and changes
last for the page session. Import opens a sample; no upload, analysis, or auth
service is connected. Earlier static designs remain in `mockups/`.

Checks: `npm run lint`, `npm run typecheck`, and `npm run build`.

## Selected deployment architecture

- Next.js and TypeScript on Cloudflare Workers, with shadcn/ui and TanStack Query.
- D1 with Drizzle ORM/Kit for structured review data and migrations.
- Private R2 for transcripts, context, and immutable source/result snapshots.
- Workers Builds for CI/CD, with isolated preview and production storage.
- Zod for validation; the model provider and exact Next.js/Workers integration remain to be selected.

The frontend prototype is implemented. Cloud resources, backend services, migrations, and deployment scripts have not been created yet. See the architecture for guarded storage publication and retryable deletion.

## Linting

Use Node.js 20.19+ on the Node 20 line, or Node.js 22.12+.

```sh
npm ci
npm run lint
```

After making code changes, run `npm run lint` and fix all errors.

Oxlint registers `@shadcn/lint` in `.oxlintrc.json`. No shadcn rules or presets
are enabled. Add your chosen `shadcn/*` rules to the empty `rules` object when
you are ready to define the design system's policies.

- [Available rules](https://github.com/shadcn-ui/lint/blob/main/README.md#rules)
- [Configuration examples](https://github.com/shadcn-ui/lint/blob/main/README.md#get-started)

Component and theme discovery use the initialized `components.json`.
