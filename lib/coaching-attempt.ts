export function coachingAttemptId(id:string,attempt:number,stage:'draft'|'verify') {
 return `${id}${attempt===0?'':`-attempt-${attempt}`}-${stage}`;
}
