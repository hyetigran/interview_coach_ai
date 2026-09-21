# Concurrent upload reservations — 2026-09-21

Partial evidence for #15. This check needs no interview recordings and does not
submit media bytes or complete an upload, so it cannot start automatic processing
or paid provider calls. It creates synthetic invited accounts and empty multipart
sessions; database and storage operations still use their configured environment.

`e2e/admission-race.spec.ts` sends four concurrent upload-initiation requests for
four reviews owned by one candidate. Exactly three must succeed and the fourth
must return 409. Every review must report zero admitted recordings and three
reserved slots. Three concurrent retries for an accepted review must return the
same upload identity without consuming another slot.

A second candidate cannot read or initiate an upload for the first candidate's
review, but can reserve a slot in their own account. Deleting one unfinished
review must deny further access, reduce the first account's reservations to two,
and allow the previously rejected review to reserve the freed slot. Cleanup
attempts deletion for every created review and requires physical cleanup to
finish. The test does not replenish or modify already-admitted recording counts.

## Run

After local setup and migrations:

```sh
E2E_DEV=1 pnpm exec playwright test e2e/admission-race.spec.ts
```

Against the isolated deployed preview, with authorized D1 invitation access:

```sh
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.hyetigran.workers.dev \
pnpm exec playwright test e2e/admission-race.spec.ts
```

## Observations and limits

The local test passed in 4.8 seconds (12.0 seconds including server startup).
Lint and typechecking passed. The preview attempt failed before creating an
account or review: Cloudflare rejected the invitation insert into preview D1
with authentication error 10000. No deployed concurrency success is claimed;
preview must be rerun when authorized D1 access is restored.

On the next attempt, authenticated D1 access succeeded. The deployed test passed
the four-request admission race, retry identity/count checks, and second-account
isolation/capacity checks. It then failed because deleting an unfinished review
exceeded the 30-second HTTP timeout. The final cleanup completed, but this failed
run does not establish reservation release and readmission after deletion.

Deletion called global grouping, coaching, and correction receipt sweeps. A local
regression made an unrelated receipt deletion unavailable and reproduced failure
of deleting an empty review. Deletion now limits those storage sweeps to the
requested review. Scheduled sweeps retain their global scope and late-artifact
cleanup; the regression checks that unrelated receipts survive the request and
are subsequently removed by normal sweeps. This fixes the demonstrated global
receipt dependency, not every possible source of deletion latency. A deployed
rerun remains necessary.

That rerun passed after [PR #47](https://github.com/hyetigran/interview_coach_ai/pull/47)
merged as `b46a60558fff08f0f652eaa0ba753314467f4527`. The staging build deployed
preview version `c9ee34a7-0a6d-4d27-a113-7374601cb331`. The unchanged test passed
in 42.3 seconds (43.1 seconds total), including deletion, access denial,
freed-slot reuse, and cleanup of every created review. The earlier authentication
failure and deletion timeout are historical observations, not current blockers
for this reservation-only check. The broader limits below still apply.

The complete local development-server browser suite then passed all 13 enabled
tests in 2.5 minutes, including this admission check; 12 opt-in cases were skipped.
The run used the documented invalid provider fixture key. It emitted Workers
hung-request cancellation, aborted-response, and recovered-connection diagnostics
during other journeys. Passing assertions do not establish that those runtime
diagnostics are resolved. Both Standards and Spec reviews found no issues in this
increment.

This covers reservation admission through authenticated HTTP APIs. It does not
verify completed-upload admission races, permanent allowance after deleting an
admitted recording, account automatic-job claims, the final shared budget
reservation, unknown provider charges, or deletion during active processing.
Those requirements retain their separate tests and acceptance evidence. It also
does not establish keyboard accessibility, interview quality, or pilot outcomes.
Ticket #15 remains open.
