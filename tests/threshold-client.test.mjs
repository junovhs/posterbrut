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
