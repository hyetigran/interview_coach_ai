// Only an untouched grouping intent may be superseded by a new confirmation.
// Keep any paid identity or saved result for the stage-specific recovery plan.
export function confirmationCanRestart(target: string) {
 return `NOT EXISTS(SELECT 1 FROM coaching_runs WHERE grouping_id=${target})
 AND NOT EXISTS(SELECT 1 FROM grouping_runs WHERE id=${target} AND (output_version<>0 OR recovery_action_id IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM grouping_chunks c WHERE c.run_id=${target} AND
 (c.state NOT IN ('queued','failed') OR c.submitted<>0 OR c.attempt<>0 OR c.result IS NOT NULL
 OR c.input_payload IS NOT NULL OR c.reuse_result IS NOT NULL OR c.reuse_input IS NOT NULL
 OR c.recovery_action_id IS NOT NULL OR c.publication_attempts<>0
 OR EXISTS(SELECT 1 FROM processing_budget b WHERE b.id=c.id)))`;
}
