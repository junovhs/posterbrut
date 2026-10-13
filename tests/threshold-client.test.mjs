import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThresholdClient} from '../dist/engine/client.js';
class WorkerStub {static current;messages=[];constructor(){WorkerStub.current=this;}postMessage(job){this.messages.push(job);}finish(){const job=this.messages.at(-1);this.onmessage({data:{id:job.id,bitmap:{close(){}}}});}}
globalThis.Worker=WorkerStub;
test('transport coalesces queued previews and keeps exports independent',async()=>{
 const client=new ThresholdClient(),worker=WorkerStub.current,task={kind:'paper',amount:0,seed:1};
 const first=client.run('preview','a',1,1,task),second=client.run('preview','b',1,1,task).catch(e=>e.name),latest=client.run('preview','c',1,1,task),output=client.run('export','d',1,1,task);
 assert.equal(await second,'AbortError');assert.equal(worker.messages.length,1);worker.finish();await first;assert.equal(worker.messages.at(-1).sourceKey,'c');worker.finish();await latest;assert.equal(worker.messages.at(-1).sourceKey,'d');worker.finish();await output;assert.equal(client.stats.coalesced,1);assert.equal(client.stats.completed,3);
});

test('separate export client cannot block preview completion',async()=>{
 const preview=new ThresholdClient(),previewWorker=WorkerStub.current,output=new ThresholdClient(),exportWorker=WorkerStub.current,task={kind:'image',fx:{feelInk:.5},seed:1};
 const exporting=output.run('export:layer','full',2000,2000,task);
 const interactive=preview.run('layer','small',384,384,task);
 assert.equal(exportWorker.messages.length,1);assert.equal(previewWorker.messages.length,1);
 previewWorker.finish();await interactive;assert.equal(output.stats.completed,0);
 exportWorker.finish();await exporting;
});
test('worker source eviction retries with a fresh bitmap once',async()=>{
 const client=new ThresholdClient(),worker=WorkerStub.current,task={kind:'image',fx:{feelInk:.5},seed:1};let uploads=0;
 const source=async()=>{uploads++;return {close(){}};};
 const first=client.run('layer','source',1,1,task,source);await new Promise(resolve=>setImmediate(resolve));worker.finish();await first;
 const next=client.run('layer','source',1,1,task,source);await new Promise(resolve=>setImmediate(resolve));assert.equal(uploads,1);
 const id=worker.messages.at(-1).id;worker.onmessage({data:{id,error:'SOURCE_MISSING'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(uploads,2);assert.ok(worker.messages.at(-1).bitmap);
 worker.finish();await next;
});
