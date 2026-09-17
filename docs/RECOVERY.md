# Local processing recovery

Recovery is persisted in D1 and R2. Closing a browser does not cancel a job. The review page reads the current stage and offers an explicit retry when its inputs, previous charges, attempt limit, and shared allowance permit one.

| Stage | Reused work | Explicit retry |
| --- | --- | --- |
| Preparation | Original upload; a completed audio checkpoint | New preparation attempt after the previous Workflow is stopped. Invalid or expired media requires a new recording. |
| Transcription | Prepared audio | New attempt and reservation. An unknown provider outcome cannot be resubmitted. |
| Voice confirmation | Transcript and saved candidate speaker selection | New continuation identity for an expired confirmation with no downstream submission, saved result, or billing record. An untouched grouping intent is retained as outdated under its original identity. |
| Grouping | Completed prefix; later results whose request inputs still match | Recheck the incomplete section and its dependent suffix. Reserve the suffix ceiling atomically, then release unused reservations when results are reused. Saved manual groups remain authoritative and require explicit grouping edits. |
| Coaching | Other completed threads; a valid saved draft | Retry drafting plus verification, or verification alone. A rejected support check remains withheld. Reanalysis after changed grouping/context creates a new run and reuses advice with matching evidence dependencies. If reanalysis expires before creating any jobs, Reanalyze coaching can start a new continuation identity, up to three total attempts; repeated actions cannot revive older continuations. |

Preparation, transcription, grouping sections, and coaching threads have three total attempt identities. A retry does not reset an earlier ledger entry. Reservations and queue publication share a D1 transaction for paid retries. Provider receipts and known charges remain attached to their original attempts.

Saved provider results have at most three publication attempts within 15 minutes, with a five-minute publication lease. Replaying publication does not call the provider. A saved coaching draft is not publishable advice without its support check. Missing or ambiguous paid outcomes retain their reservations.

Preparation dispatch has three attempts and a five-minute stage deadline once claimed. A failed preparation retains the account slot until cancellation succeeds. Confirmation and context-reanalysis dispatch also have three attempts with a one-minute lease; their stage deadlines remain five minutes and three hours respectively. Other explicit retry dispatches have three attempts; transcription and coaching retries expire within 15 minutes. Grouping dispatch expires after 15 minutes, while an admitted grouping plan has a three-hour processing deadline. HTTP retry endpoints persist intent and return `202`; the scheduled job Worker dispatches it. Dispatch retries reuse the same Workflow identity after a lost response. Late callbacks must match the current attempt and input dependencies before publication.

The local development command is `pnpm dev`. It reads `OPENAI_API_KEY` from the ignored `.env` file and synchronizes it to the ignored Wrangler secrets file. Apply local migrations with `pnpm db:migrate:local` before starting a checkout with new schema changes.

## Verification and remaining acceptance

The integration suite injects provider-response loss, database-publication failure, invalid output, changed dependencies, duplicate actions, dispatch failure, budget exhaustion, and deletion. `pnpm test:media` exercises real ffmpeg conversion and attempt-specific compression routes. Recovery browser tests exercise authenticated keyboard interaction and reload persistence using deterministic cases that require no provider calls.

Remote smoke acceptance remains outstanding while local implementation is prioritized. These tests do not establish provider quality, recording permissions for a pilot corpus, or independent coaching-quality acceptance.
