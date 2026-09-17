export const TRANSCRIPTION_RESERVATION=6000000;
export function transcriptionAttemptId(id:string,attempt:number) {return attempt===0?id:`${id}-attempt-${attempt}`;}
