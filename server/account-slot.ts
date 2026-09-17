import {noUnresolvedProviders} from './historical-billing';
// A review's automatic pipeline owns one account slot. Receipt publication
// reacquires it; work within the same current review shares that pipeline.
export function accountSlotAvailable(owner:string,review?:string,reservedOperation?:string) {
 const other=(alias:string)=>`${alias}.owner_id=${owner}${review?` AND ${alias}.review_id<>${review}`:''}`;
 return `NOT EXISTS(SELECT 1 FROM processing_jobs slot_prepare WHERE ${other('slot_prepare')} AND (slot_prepare.state='running' OR slot_prepare.dispatch_state='cancel_pending'))
 AND NOT EXISTS(SELECT 1 FROM transcriptions slot_transcript WHERE ${other('slot_transcript')} AND slot_transcript.state IN ('queued','encoding','submitting','publishing'))
 AND NOT EXISTS(SELECT 1 FROM speaker_confirmations slot_confirmation WHERE ${other('slot_confirmation')} AND slot_confirmation.state='running')
 AND NOT EXISTS(SELECT 1 FROM grouping_runs slot_group WHERE ${other('slot_group')} AND (slot_group.state='running' OR EXISTS(SELECT 1 FROM grouping_chunks slot_chunk WHERE slot_chunk.run_id=slot_group.id AND slot_chunk.state='publishing')))
 AND NOT EXISTS(SELECT 1 FROM coaching_runs slot_coaching WHERE ${other('slot_coaching')} AND (slot_coaching.state='running' OR EXISTS(SELECT 1 FROM coaching_jobs slot_advice WHERE slot_advice.run_id=slot_coaching.id AND slot_advice.state='publishing')))
 AND ${noUnresolvedProviders(owner,review,reservedOperation)}`;
}
