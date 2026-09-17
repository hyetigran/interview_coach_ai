export type RecoveryStage='preparation'|'transcription'|'confirmation'|'grouping'|'coaching';
export type RecoveryArtifact={stage:RecoveryStage;id:string;state:string;attempts:number;receipt:'none'|'complete'|'partial';billing:'none'|'settled'|'reserved';maximumUnits:number;current:boolean};
export type RecoveryStep={stage:RecoveryStage;id:string;action:'reuse'|'publish'|'retry'|'wait'|'blocked';maximumUnits:number;reason:string};
const busy=new Set(['queued','running','encoding','submitting','preparing','generating','verifying','publishing']);
const retryable=new Set(['failed','configuration','budget_blocked','reconciliation_exhausted']);
export function recoveryPlan(artifacts:RecoveryArtifact[],availableUnits:number):{steps:RecoveryStep[];maximumUnits:number} {
 let maximumUnits=0;
 const steps=artifacts.map((artifact):RecoveryStep=>{
  const step=(action:RecoveryStep['action'],reason:string,maximumUnits=0):RecoveryStep=>({stage:artifact.stage,id:artifact.id,action,reason,maximumUnits});
  if(!artifact.current)return step('blocked','The inputs changed. Load the current review before retrying.');
  if(artifact.state==='ready'||artifact.state==='confirmed')return step('reuse','Reuse the completed stage.');
  if(busy.has(artifact.state))return step('wait','This stage already has persisted work in progress.');
  if(artifact.receipt==='complete'&&artifact.state!=='reconciliation_exhausted')return step('publish','Publish the saved provider result without another paid request.');
  if(artifact.billing==='reserved'||artifact.state==='unknown')return step('blocked','The provider outcome or charge is unresolved. Keep its reservation until reconciliation.');
  if(artifact.state==='withheld')return step('blocked','The support check rejected this advice. Review its evidence before requesting new coaching.');
  if(artifact.attempts>=3)return step('blocked','This stage has reached its three-attempt limit.');
  if(!retryable.has(artifact.state))return step('blocked','This stage needs input review before it can run again.');
  if(artifact.maximumUnits>availableUnits-maximumUnits)return step('blocked','The remaining processing allowance cannot cover this retry.');
  maximumUnits+=artifact.maximumUnits;
  return step('retry',artifact.receipt==='partial'?'Reuse the saved stage result and retry only the missing operation.':'Retry only this incomplete stage.',artifact.maximumUnits);
 });
 return {steps,maximumUnits};
}
