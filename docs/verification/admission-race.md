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
