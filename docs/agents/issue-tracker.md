# Issue tracker: GitHub

Issues live in `hyetigran/interview_coach_ai`. Use `gh` with `--repo hyetigran/interview_coach_ai`.

Read the issue body and comments before implementing. Publish multiline bodies through `--body-file`. Use native blocking relationships and work on tickets whose blockers are complete. PRs reference their originating issue and close it only when every acceptance criterion is verified. Do not treat a partial implementation as a completed ticket.

PRs as a request surface: no.

Feature PRs target `staging`. Passing local and CI checks plus code review permit merging a feature into staging for deployed acceptance. Cloudflare preview builds from staging. Keep the ticket open until its deployed acceptance criteria pass. Promote verified staging changes to `main` through a separate release PR; production deployment requires release authorization.

For code review, compare feature branches against the merge base with `origin/staging` and release PRs against `origin/main`. Review standards and the originating issue independently, resolve findings, and verify checks before merging.

Current user priority: complete implementation and verify the app in the local development environment. Continue dependent implementation once its prerequisite code and local checks pass; defer cloud deployment/CI troubleshooting and record remote acceptance as outstanding rather than blocking all development.
