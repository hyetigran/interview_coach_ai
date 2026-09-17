import {expect,test} from 'vitest';
import {contextSources,emptyContext,reviewContextSchema} from '../lib/review-context';
test('optional context is bounded and only explicitly selected sources enter generation',()=>{
 const input={...emptyContext('Engineer'),resume:{text:'I worked on a migration.',selected:true},jobDescription:{text:'Looking for a team lead.',selected:true},stories:[{id:crypto.randomUUID(),text:'A private unselected story.',selected:false}]};
 const sources=contextSources('review:v2',input);expect(sources.map(s=>s.kind)).toEqual(['background','job']);expect(sources[0].contextId).toBe('review:v2');expect(sources.some(s=>s.quote.includes('private'))).toBe(false);
 expect(contextSources('review:v3',{...input,resume:{...input.resume,selected:false}}).map(s=>s.kind)).toEqual(['job']);
});
test('required role, context size, story identities and three-story limit are enforced',()=>{
 const context=emptyContext('Engineer'),story={id:crypto.randomUUID(),text:'I shipped a project.',selected:true};
 for(const value of [{...context,role:' '},{...context,resume:{text:'x'.repeat(12001),selected:true}},{...context,stories:[story,story]},{...context,stories:Array.from({length:4},()=>({...story,id:crypto.randomUUID()}))}])expect(()=>reviewContextSchema.parse(value)).toThrow();
});
