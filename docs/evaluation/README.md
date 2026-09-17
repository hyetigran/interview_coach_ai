# Independent quality evaluation

Status: **prepared protocol and tooling; no evaluation recordings are ready; reference annotations have not been supplied and independent reviewer availability is unconfirmed**. The user clarified on 2026-09-17 that no recordings are ready. No corpus has been inspected or frozen, and no measured results are available. This work supports ticket #14. Author fixtures demonstrate the evaluation tool, not transcription accuracy, useful coaching, or product demand.

## Evidence needed before completion

- Permissioned English recordings representative of software-engineering behavioral and past-project interviews, from hiring or externally conducted mock interviews.
- An independent labeler with relevant interviewing experience; retain a pseudonymous ID and independence declaration. Record unresolved disagreements instead of silently replacing inconvenient labels.
- Independent coaching reviewers who did not author the outputs or tune on held-out cases.
- A frozen held-out set before tuning, actual application/baseline outputs, blinded reviews, and a report of all failures and limitations.

No recordings or reviewers have been recruited by this change. Do not close the evaluation as independently completed until these inputs exist. Recruitment/contact requires authorization; do not invent participants or send private material to an additional processor without permission.

## Private corpus layout and freeze

Keep recordings, transcripts, permission documents, reviewer identities, raw outputs, and packets outside Git. A local `.evaluation-private/` directory is ignored, but an access-controlled external directory is preferable for shared work. Use pseudonymous case/reviewer IDs. Publish only aggregate, anonymized findings.

Copy `manifest.template.json` into the private corpus and add cases. A case declares `id`, `origin` (`hiring`, `mock`, or `synthetic`), `permission_reference`, `split: held_out`, and relative `recording_file`, `reference_file`, and `context_file` paths. Permission references point to permission held by the organizer, not a claim that this script verifies consent. Development and held-out material use separate manifests.

A reference file has a `labeler_id`, boolean `independent_labeler`, and `questions` array. Each question has a unique `id`, `thread_id`, boolean `substantive`, and `answer_utterance_ids` (empty when unanswered). Follow-ups have their own question IDs but share the originating thread ID. Keep source question spans, speaker assignments, uncertainty, exclusions, question categories, and labeling disagreements in this reference document as well; the entire document is hashed.

Identify substantive interviewer questions before seeing system output. Include ambiguity, unintelligible audio, speaker overlap, unanswered questions, and technical discussions whose correctness is outside coaching scope. Exclude only greetings, logistics, and candidate-to-interviewer questions, with reasons recorded. Differentiate one question thread from its individual follow-ups: grouping uses question counts; useful coaching uses distinct thread counts.

The context file contains the exact anonymized source transcript, target role, job description/background where supplied, and question/thread source mappings for both systems. Corrections/anonymization happen before freezing, with original evidence retained privately. Reusing a recording for tuning makes it development material for future evaluation.

```sh
python3 tools/evaluate.py freeze /private/corpus/manifest.json /private/corpus/lock.json
```

Freezing records SHA-256 hashes of the manifest, recording, reference labels, and context. It rejects empty corpora, missing artifacts, duplicate IDs, absent permission references, and missing substantive-question labels. Subsequent scoring/blinding rejects changed inputs. Revisions require a new frozen set and must not erase prior failed results.

## Labeling rubric

For every frozen substantive question, a reviewer compares the app grouping with the recording/reference and records:

- `correct_association`: the question is linked to the appropriate response spans, including follow-ups needed for interpretation.
- `omitted`: the question has no usable output association.
- `attribution_error`: a candidate/interviewer assignment consequentially changes interpretation.
- `transcription_error`: a consequential recognition error affects the evidence.

Also list spurious output groups by case and output-group ID. Do not count a valid quote as proof of a correct association. Unanswered questions can be correctly represented as unanswered; silently omitting them fails association coverage. Resolve disagreements separately while retaining raw judgments.

## Coaching comparison

Use the same underlying model where feasible, identical frozen source/context, comparable token/output budgets, and similar output presentation. Record exact prompt/model versions, requested and actual usage, and any mismatch. Do not tune the baseline on held-out results.

Baseline prompt:

> Review this interview question thread and candidate answer using the supplied role, job description, and selected background when relevant. Briefly explain the most consequential supported strength or gap and quote its source. Suggest future wording using only supported personal facts, or explain what to preserve. If another supplied experience fits better, explain why and cite it. Distinguish facts from the interview from new background. Ask for missing information rather than inventing achievements or metrics. Do not infer a hiring outcome, judge visual/vocal delivery, or certify technical correctness.

Run interview-only, job-description, and background comparisons separately where the dataset supports them; freeze each input condition. Do not give only the application access to useful context.

Prepare a private outputs JSON document with one `items` entry per frozen thread: `case_id`, `thread_id`, and text fields `app` and `baseline`. Represent unavailable system output as empty text, never drop that thread.

```sh
python3 tools/evaluate.py blind /private/corpus/manifest.json /private/corpus/lock.json /private/corpus/outputs.json /private/corpus/packets
```

The command randomizes both A/B assignment per thread and packet order. Give reviewers only `reviewer-packets.json`; keep `sealed-assignments.json` with the organizer. Both options receive the same frozen source. Preserve raw A/B judgments before unblinding; an organizer maps each `packet_id` and A/B choice back to `app` or `baseline` using the sealed assignment. Have another organizer verify that mapping before scoring. Do not change model text to favor either system.

For each system/thread/reviewer record:

- `supported_action`: a specific improvement or preservation action addresses the actual question and is substantively supported by source material. A generic rewrite or missing-fact question alone is false.
- `abstained`: output/reviewer cannot support an action. Record why in the raw judgment.
- `critical_defects`: invented employers, credentials, metrics, events, or material ownership misattribution. Any such finding blocks the affected generation behavior until fixed and reevaluated.
- `major_defects`: lesser unsupported scope changes and other substantial defects; do not downgrade material ownership inflation from critical.
- Preserve notes on question coverage, specificity, organization, reasoning, comparative preference/ties, and disagreements alongside the structured flags. These are judgment dimensions, not a universal interview score.

## Scoring and reporting

The ratings document has `reviewers` (`id`, boolean `independent`), `grouping`, `spurious_groups`, and `coaching` arrays. Each grouping judgment identifies `case_id`, `question_id`, and `reviewer_id` plus the four booleans above. Spurious entries identify `case_id`, `group_id`, and `reviewer_id`. Coaching entries identify `case_id`, `thread_id`, `reviewer_id`, and unblinded `system`, with booleans and defect-description arrays. Keep notes and A/B originals privately.

```sh
python3 tools/evaluate.py score /private/corpus/manifest.json /private/corpus/lock.json /private/corpus/ratings.json /private/corpus/report.json
python3 -m unittest discover -s tests -p 'test_evaluation.py'
```

The script refuses duplicate/unknown judgments and non-boolean flags. All frozen substantive questions remain in the grouping denominator; all frozen threads remain in the coaching denominator. Missing judgments count as unreviewed and never as successes. When reviewers disagree, a case counts as supported only if every supplied judgment supports it and none flags a defect/abstention. Disagreement counts remain visible; this conservative rule is fixed before evaluation.

Grouping target: at least 90% correct question/response associations. Useful-action target: at least 70% supported threads. Report raw counts, omissions, attribution/transcription errors, spurious groups, abstentions, disputes, and critical/major defects. Numeric target flags apply to the sample and do not override `validation_status`. Synthetic material, author labels, non-independent reviewers, or incomplete review prevent an independent-validation status.

Use the report template to add category breakdowns, reviewer disagreements, baseline preferences, and uncertainty. Report the sample's selection and dependence (many threads from one interview are not independent participants). A small passing sample does not establish population reliability. The broader-release 2% major-defect gate over at least 100 independently reviewed personalized recommendations is not evaluated by this tool; five usability participants are not a substitute for that dataset.

Critical defects block the affected capability regardless of aggregate score. If coverage falls below 70%, report failure, fix the system or explicitly narrow scope, and use a new held-out evaluation. Do not adjust thresholds, remove difficult cases, or relabel missing-fact requests after seeing results.

## Separation from the pilot

The five-candidate pilot measures independent workflow completion and a useful saved suggestion (target four of five), not independent coaching accuracy. No participant success, retention, or hiring benefit can be inferred from running this script. Keep actual workflow and cost observations in the pilot report, separate from the quality report.
