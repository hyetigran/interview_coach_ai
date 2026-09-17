import { z } from 'zod';
export const STRUCTURED_MODEL='gpt-4.1-mini-2025-04-14';
export const STRUCTURED_RESERVATION=450000;
export function requestStructured(request:typeof fetch,key:string,id:string,instructions:string,input:string,schema:Record<string,unknown>) {
  return request('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','X-Client-Request-Id':id},body:JSON.stringify({model:STRUCTURED_MODEL,store:false,truncation:'disabled',max_output_tokens:8192,instructions,input,text:{format:{type:'json_schema',name:'supported_result',strict:true,schema}}}),signal:AbortSignal.timeout(90000)});
}
export function structuredCharge(data:unknown) {
  const {usage}=z.object({usage:z.object({input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative(),input_tokens_details:z.object({cached_tokens:z.number().int().nonnegative()})})}).parse(data);
  if(usage.input_tokens_details.cached_tokens>usage.input_tokens)throw new Error('Invalid usage.');
  return Math.ceil((usage.input_tokens-usage.input_tokens_details.cached_tokens)*0.4+usage.input_tokens_details.cached_tokens*0.1+usage.output_tokens*1.6);
}
export function structuredOutput(data:unknown) {
  const response=z.object({status:z.literal('completed'),output:z.array(z.object({type:z.string(),content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()}))}).parse(data);
  const text=response.output.flatMap(item=>item.type==='message'?item.content??[]:[]).filter(item=>item.type==='output_text').map(item=>item.text??'').join('');
  return JSON.parse(text) as unknown;
}
