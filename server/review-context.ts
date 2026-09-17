import {z} from 'zod';
import {emptyContext,reviewContextSchema,type ReviewContext} from '../lib/review-context';
export class ContextError extends Error {constructor(public status:number,message:string){super(message);}}
export async function contextSnapshot(db:D1Database,review:string,revision:number) {
 const row=await db.prepare('SELECT id,body FROM review_context_versions WHERE review_id=? AND revision=?').bind(review,revision).first<{id:string;body:string}>();
 if(row)return {id:row.id,context:reviewContextSchema.parse(JSON.parse(row.body))};
 const current=await db.prepare("SELECT role FROM reviews WHERE id=? AND coaching_revision=? AND lifecycle='active'").bind(review,revision).first<{role:string}>();
 if(!current)throw new ContextError(409,'The selected context changed. Reload before continuing.');
 return {id:`${review}:context:${revision}`,context:emptyContext(current.role)};
}
export function createContextModule(db:D1Database) {
 async function get(owner:string,review:string) {
  const row=await db.prepare("SELECT coaching_revision FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first<{coaching_revision:number}>();
  if(!row)throw new ContextError(404,'Review not found.');
  return {revision:row.coaching_revision,...await contextSnapshot(db,review,row.coaching_revision)};
 }
 async function save(owner:string,review:string,input:unknown) {
  const value=z.object({revision:z.number().int().positive(),context:reviewContextSchema}).strict().parse(input);
  const old=await get(owner,review);if(old.revision!==value.revision)throw new ContextError(409,'Context was changed in another tab. Reload before saving.');
  if(JSON.stringify(old.context)===JSON.stringify(value.context))return old;
  const next=value.revision+1,id=`${review}:context:${next}`;
  const result=await db.batch([
   db.prepare("INSERT OR IGNORE INTO review_context_versions(id,review_id,revision,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND coaching_revision=?)").bind(old.id,review,old.revision,JSON.stringify(old.context),Date.now(),review,owner,value.revision),
   db.prepare("INSERT OR IGNORE INTO review_context_versions(id,review_id,revision,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND coaching_revision=?)").bind(id,review,next,JSON.stringify(value.context),Date.now(),review,owner,value.revision),
   db.prepare("UPDATE reviews SET role=?,coaching_revision=?,updated_at=? WHERE id=? AND owner_id=? AND lifecycle='active' AND coaching_revision=?").bind(value.context.role,next,Date.now(),review,owner,value.revision),
  ]);
  if(!result[2].meta.changes)throw new ContextError(409,'Context changed while saving. Reload before trying again.');
  return get(owner,review);
 }
 return {get,save};
}
export type SelectedContext={id:string;context:ReviewContext};
