// DEC-01: Keep pixel computation in workers; UI only transports state and paints.
import {PreparedImage,hash,noise,rgb} from './core.js';
import type {WorkRequest,WorkResponse} from './types.js';
const scope=self as unknown as DedicatedWorkerGlobalScope;
const sources=new Map<string,PreparedImage>();
scope.onmessage=(event:MessageEvent<WorkRequest>)=>{
 const job=event.data;
 try{
  let canvas=new OffscreenCanvas(job.width,job.height),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas unavailable');
  let analysis;
  if(job.task.kind==='image'){
   if(job.bitmap){ctx.drawImage(job.bitmap,0,0,job.width,job.height);job.bitmap.close();const rgba=ctx.getImageData(0,0,job.width,job.height).data;sources.set(job.sourceKey,new PreparedImage({width:job.width,height:job.height,rgba}));}
   const source=sources.get(job.sourceKey);if(!source)throw new Error('SOURCE_MISSING');
   // LRU source storage is bounded by pixel area, not just number of images.
   sources.delete(job.sourceKey);sources.set(job.sourceKey,source);
   while([...sources.values()].reduce((sum,s)=>sum+s.frame.width*s.frame.height,0)>8_000_000&&sources.size>1)sources.delete(sources.keys().next().value!);
   const output=source.render(job.task.fx,job.task.seed);analysis=output.analysis;ctx.putImageData(new ImageData(output.rgba,job.width,job.height),0,0);
  }else if(job.task.kind==='paper'){
   const {amount,seed}=job.task,pixels=ctx.createImageData(job.width,job.height),a=pixels.data;
   for(let y=0;y<job.height;y++)for(let x=0;x<job.width;x++){const i=(y*job.width+x)*4,coarse=noise(x/45,y/45,seed+6),fine=hash(x,y,seed+7),r=hash(x,y,seed+139);const alpha=fine<amount*.0029?60+Math.floor(r*100):fine>1-amount*.0041?23+Math.floor(r*60):Math.floor(amount*(.13+.55*Math.abs(coarse-.5))*(.15+r));const dark=fine<.65;a[i]=dark?13:255;a[i+1]=dark?17:246;a[i+2]=dark?15:226;a[i+3]=Math.min(235,alpha);}ctx.putImageData(pixels,0,0);
  }else if(job.task.kind==='stamp'){
   if(!job.bitmap)throw new Error('Stamp source missing');ctx.drawImage(job.bitmap,0,0,job.width,job.height);job.bitmap.close();const pixels=ctx.getImageData(0,0,job.width,job.height),a=pixels.data,color=rgb(job.task.color);for(let i=0;i<a.length;i+=4){const lum=(a[i]!*.2126+a[i+1]!*.7152+a[i+2]!*.0722)/255;a[i+3]=Math.round(a[i+3]!*(job.task.polarity==='dark'?1-lum:lum));a[i]=color[0]!;a[i+1]=color[1]!;a[i+2]=color[2]!;}ctx.putImageData(pixels,0,0);
  }else{
   if(!job.bitmap)throw new Error('Text raster missing');ctx.drawImage(job.bitmap,0,0);job.bitmap.close();const pixels=ctx.getImageData(0,0,job.width,job.height),a=pixels.data,{amount,seed}=job.task;
   for(let y=0;y<job.height;y++)for(let x=0;x<job.width;x++){const i=(y*job.width+x)*4;if(a[i+3]!<8)continue;if(hash(x,y,seed)*.69+noise(x/3.3,y/3.3,seed+90)*.31<amount/100*.47)a[i+3]=0;else if(a[i+3]!>120)a[i+3]=255;}ctx.putImageData(pixels,0,0);
  }
  const bitmap=canvas.transferToImageBitmap();const response:WorkResponse={id:job.id,bitmap,...(analysis?{analysis}:{})};scope.postMessage(response,[bitmap]);
 }catch(error){job.bitmap?.close();const response:WorkResponse={id:job.id,error:error instanceof Error?error.message:String(error)};scope.postMessage(response);}
};
