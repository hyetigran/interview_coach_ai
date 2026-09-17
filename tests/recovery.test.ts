import {expect,test} from 'vitest';
import {recoveryPlan,type RecoveryArtifact} from '../lib/recovery';
const artifact=(overrides:Partial<RecoveryArtifact>={}):RecoveryArtifact=>({stage:'transcription',id:'t',state:'failed',attempts:1,receipt:'none',billing:'none',maximumUnits:6000000,current:true,...overrides});
test('a finite plan reuses completed stages and charges only eligible incremental operations',()=>{
 const plan=recoveryPlan([artifact({stage:'preparation',id:'p',state:'ready',maximumUnits:0}),artifact({state:'ready'}),artifact({stage:'coaching',id:'c',receipt:'partial',billing:'settled',maximumUnits:450000})],450000);
 expect(plan.steps.map(step=>step.action)).toEqual(['reuse','reuse','retry']);expect(plan.maximumUnits).toBe(450000);
});
test('stored complete results publish without additional allowance while unknown billing remains reserved',()=>{
 const plan=recoveryPlan([artifact({receipt:'complete',billing:'reserved'}),artifact({id:'unknown',state:'unknown',billing:'reserved'})],0);
 expect(plan.steps.map(step=>step.action)).toEqual(['publish','blocked']);expect(plan.maximumUnits).toBe(0);
});
test('stale inputs, active work, exhausted attempts and aggregate budget prevent duplicate or unsafe retries',()=>{
 const plan=recoveryPlan([artifact({current:false}),artifact({state:'submitting'}),artifact({attempts:3}),artifact({id:'first',maximumUnits:450000}),artifact({id:'second',maximumUnits:450000})],450000);
 expect(plan.steps.map(step=>step.action)).toEqual(['blocked','wait','blocked','retry','blocked']);expect(plan.maximumUnits).toBe(450000);
});
