import {z} from 'zod';
const text=z.string().max(12000);
export const reviewContextSchema=z.object({
 role:z.string().trim().min(1).max(120),
 resume:z.object({text,selected:z.boolean()}).strict(),
 jobDescription:z.object({text,selected:z.boolean()}).strict(),
 stories:z.array(z.object({id:z.uuid(),text:z.string().max(4000),selected:z.boolean()}).strict()).max(3),
}).strict().refine(value=>new Set(value.stories.map(story=>story.id)).size===value.stories.length,'Story identities must be unique.').refine(value=>new TextEncoder().encode(JSON.stringify(value)).length<=64000,'Context exceeds the supported size.');
export type ReviewContext=z.infer<typeof reviewContextSchema>;
export type ContextSource={sourceId:string;contextId:string;kind:'background'|'job';label:string;quote:string;start:number;end:number};
export function contextSources(contextId:string,input:ReviewContext):ContextSource[] {
 const context=reviewContextSchema.parse(input);const sources:ContextSource[]=[];
 function add(id:string,kind:ContextSource['kind'],label:string,item:{text:string;selected:boolean}) {
  if(item.selected&&item.text.trim())sources.push({sourceId:contextId+':'+id,contextId,kind,label,quote:item.text,start:0,end:item.text.length});
 }
 add('resume','background','Selected resume',context.resume);add('job','job','Selected job description',context.jobDescription);
 context.stories.forEach((story,index)=>add(story.id,'background',`Selected experience story ${index+1}`,story));return sources;
}
export function emptyContext(role:string):ReviewContext{return {role,resume:{text:'',selected:false},jobDescription:{text:'',selected:false},stories:[]};}
