// DEC-01: Keep pixel computation in workers; UI only transports state and paints.
import type {Task,WorkRequest,WorkResponse,Result} from './types.js';
interface Pending {id:number;slot:string;sourceKey:string;width:number;height:number;task:Task;source?:()=>Promise<ImageBitmap>;resolve:(value:Result)=>void;reject:(error:Error)=>void;retried:boolean}
/** UI transport only: one active worker job, latest queued preview per layer. */
export class ThresholdClient {
 private readonly worker:Worker;
 private active:Pending|null=null;
 private queue:Pending[]=[];
 private known=new Set<string>();
 private nextId=0;
 private failure:Error|null=null;
 readonly stats={submitted:0,coalesced:0,completed:0};
 constructor(){this.worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});this.worker.onmessage=(event:MessageEvent<WorkResponse>)=>this.receive(event.data);this.worker.onerror=()=>{const error=new Error('Image processor failed. Reload the app to restart it.');this.failure=error;this.active?.reject(error);this.active=null;for(const job of this.queue)job.reject(error);this.queue=[];};}
 run(slot:string,sourceKey:string,width:number,height:number,task:Task,source?:()=>Promise<ImageBitmap>):Promise<Result>{
  if(this.failure)return Promise.reject(this.failure);this.stats.submitted++;
  return new Promise((resolve,reject)=>{const previous=this.queue.findIndex(job=>job.slot===slot);if(previous>=0){this.queue.splice(previous,1)[0]!.reject(new DOMException('Superseded','AbortError'));this.stats.coalesced++;}this.queue.push({id:++this.nextId,slot,sourceKey,width,height,task,source,resolve,reject,retried:false});void this.pump();});
 }
 private async pump():Promise<void>{if(this.active||!this.queue.length)return;const job=this.queue.shift()!;this.active=job;
  try{const bitmap=job.source&&(!this.known.has(job.sourceKey)||job.task.kind==='distress'||job.task.kind==='stamp')?await job.source():undefined;const request:WorkRequest={id:job.id,sourceKey:job.sourceKey,width:job.width,height:job.height,task:job.task,...(bitmap?{bitmap}:{})};this.worker.postMessage(request,bitmap?[bitmap]:[]);}catch(error){job.reject(error instanceof Error?error:new Error(String(error)));this.active=null;void this.pump();}
 }
 private receive(result:WorkResponse):void{const job=this.active;if(!job||result.id!==job.id){if('bitmap'in result)result.bitmap.close();return;}this.active=null;
  if('error'in result){if(result.error==='SOURCE_MISSING'&&!job.retried){this.known.delete(job.sourceKey);job.retried=true;this.queue.unshift(job);}else job.reject(new Error(result.error));}
  else{if(job.task.kind==='image'){this.known.delete(job.sourceKey);this.known.add(job.sourceKey);if(this.known.size>32)this.known.delete(this.known.values().next().value!);}this.stats.completed++;job.resolve(result);}void this.pump();
 }
}
export {defaults,effects} from './core.js';
