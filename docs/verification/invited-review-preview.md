# Invited review: deployed acceptance

Ticket #1 was verified against `https://interview-coach-preview.hyetigran.workers.dev` on 2026-09-17 using Chromium and synthetic invited accounts. No interview recordings or paid provider calls were used.

The first browser run passed in 23.1 seconds. A second run added keyboard, loading/failure-state and server-validation checks and passed in 20.3 seconds. These exercised the empty-review portion of `e2e/review.spec.ts`; the later upload/video steps were deliberately outside this ticket's deployed acceptance.

| Requirement | Observed evidence |
| --- | --- |
| Invited authentication on the deployed Workers runtime | Registration through the sign-in UI succeeded with a generated, stored invitation. Uninvited registration returned 403. Sign-out and a fresh sign-in succeeded. |
| Required metadata and persistence | The UI created a hiring review with a title and target role. Reload and a new authenticated session reopened it. A subsequent API read matched the saved title, role and hiring origin. Server requests with blank title, blank role or invalid origin each returned 400. |
| Keyboard and asynchronous states | Enter on an empty form focused the required title input; Tab reached target role. A delayed list request exposed the loading status and then the empty state. A simulated 503 exposed an alert without discarding entered fields; focusing the re-enabled submit control and pressing Enter successfully retried against the real server. |
| Owner isolation and mutation protection | An unauthenticated detail request returned 401. A second invited account saw 404 for the first account's review and an empty own list. Its delete request did not remove the owner's review. An untrusted Origin on a cookie-authenticated delete returned 403. |
| Empty-review deletion | The owner deleted the review through the UI, returned to the empty list, and could no longer reopen its detail or audio endpoint. |
| Integration and deployment path | Existing reviewed implementation uses pinned Better Auth, Next.js/OpenNext, TypeScript, shadcn/ui, TanStack Query, Zod and Drizzle/D1. Preview/production bindings are distinct in the Wrangler configuration. CI run `35271539364` passed lint, types, regression tests, build, migrations and browser checks. Runtime checks above independently exercised the deployed preview. |

The injected 503 and response delay verified browser presentation/recovery; they do not establish a naturally occurring infrastructure failure rate. A failed intermediate test assumed a disabled submit control would retain focus; the final test explicitly focused the re-enabled control before its keyboard retry.

This closes only the invited empty-review slice. Upload, extraction, transcription, coaching, independent quality measurement and five-candidate pilot acceptance remain separate. The user declined the Workers Paid plan required for Cloudflare Containers; hosted media deployment is deferred while the hosting approach is reconsidered. No evaluation recordings are ready, and pilot candidates have not been recruited.
