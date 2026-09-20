# Recovery verification without interview samples

Sample-interview-dependent acceptance is deferred by the user's 2026-09-20
instruction. These checks use seeded records, synthetic receipts, or controlled
browser responses. They do not require recordings or independent reviewers.

## Checks and boundaries

| Check | What it verifies | Boundary |
| --- | --- | --- |
| `e2e/stage-recovery.spec.ts` | Original recovery request returns 202 before page closure; a new page observes the same prepared job and transcript; subsequent duplicate actions retain the paid identity and zero-cost fixture ledger; deletion denies retries | Seeded artifacts, not a live provider outage |
| `e2e/recovery.spec.ts` | Expired saved speaker confirmation resumes without changing the transcript; reload and deletion denial | Candidate-only synthetic text avoids provider requests |
| `e2e/analysis-recovery.spec.ts` | Grouping and coaching retries finish through the deployed Workflow and persist across reload; reservations settle to zero | Candidate-only grouping and incomplete coaching fixtures |
| `e2e/late-artifact-cleanup.spec.ts` | Deletion rejects capabilities/access, and scheduled cleanup removes injected late objects | Injected storage writes, not a live provider cancellation |
| `e2e/recovery-states.spec.ts` | Twelve stage/condition combinations show explanations, withhold ineligible retry buttons, and retain available evidence | Controlled API responses verify presentation only; server admission is covered separately |

The presentation matrix covers preparation, transcription, grouping, and coaching
under budget blocks, unresolved charges, and exhausted retries. It intercepts and
fails any browser write instead of allowing a retry to reach the server.

Before the page-closure strengthening, all six deployed recovery/cleanup scenarios
above passed. The presentation matrix also passed in preview. The strengthened
page-closure test requires server acceptance before closing and observes completion
before replaying duplicates, preventing those duplicates from masking an aborted
original submission. Current execution results belong to the associated PR checks
and validation report; this document does not turn test definitions into proof.

Local integration tests separately exercise lost dispatch, finite attempts and
deadlines, unknown charges, incremental reservations, failed storage publication,
dependency changes, delayed responses, concurrent actions, and deletion during
provider work. The grouping finalization regression gates a receipt publication
while Workflow finalization runs, then requires the stopped run to become partial
without losing earlier groups or making another provider call.

Run the browser checks against isolated preview resources:

```sh
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.hyetigran.workers.dev \
pnpm exec playwright test e2e/stage-recovery.spec.ts e2e/recovery.spec.ts \
  e2e/analysis-recovery.spec.ts e2e/late-artifact-cleanup.spec.ts \
  e2e/recovery-states.spec.ts
```

The preview job Worker containing the reviewed finalization fix was deployed as
`ee7ea021-5dcb-4ed5-add9-ff3426926d45`. Historical hour-probe failures and costs are
recorded separately in `multipart-preview.md`; they are not recovery-quality or
independent coaching-quality evidence.
