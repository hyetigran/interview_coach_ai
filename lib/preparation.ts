import {z} from 'zod';
export const prioritiesSchema=z.array(z.string().trim().min(1).max(500)).max(3);
export const answerSaveSchema=z.object({jobId:z.string().min(1).max(150),version:z.number().int().nonnegative(),text:z.string().trim().min(1).max(10000)}).strict();
export type SavedAnswer={id:string;jobId:string;threadId:string;version:number;text:string;question:string;createdAt:number};
export type Preparation={priorities:{version:number;items:string[]};answers:SavedAnswer[]};
