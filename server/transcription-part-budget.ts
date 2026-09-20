import {TRANSCRIPTION_RESERVATION} from '../lib/transcription-attempt';
export async function transcriptionRetryMaximum(db:D1Database,id:string){
 const rows=(await db.prepare('SELECT state FROM transcription_parts WHERE transcription_id=?').bind(id).all<{state:string}>()).results;
 return rows.length?rows.filter(row=>row.state!=='ready').length*2000000:TRANSCRIPTION_RESERVATION;
}
