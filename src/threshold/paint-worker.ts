// DEC-01: Tip decoding, grain pixel passes and incremental stroke rendering live here.
import {brushPresets} from './brushes.js';
import {appendDabs,strokeKey,tipPixels} from './paint-core.js';
import type {StrokeState} from './paint-core.js';
import type {Frame,BrushPreset,WorkRequest,WorkResponse} from './types.js';
const scope=self as unknown as DedicatedWorkerGlobalScope;
const brushes=new Map(brushPresets.map(b=>[b.id,b]));
const masks=new Map<string,Promise<OffscreenCanvas>>(),tints=new Map<string,OffscreenCanvas>();
interface Surface {canvas:OffscreenCanvas;keys:string[];states:StrokeState[]}
const surfaces=new Map<string,Surface>();
async function readAsset(path:string):Promise<Frame>{const response=await fetch(new URL('../'+path,import.meta.url));if(!response.ok)throw new Error('Brush asset unavailable');const bitmap=await createImageBitmap(await response.blob()),c=new OffscreenCanvas(256,256),ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0,256,256);bitmap.close();return {width:256,height:256,rgba:ctx.getImageData(0,0,256,256).data};}
async function tip(brush:BrushPreset,color:string):Promise<OffscreenCanvas>{
 const key=brush.id+':'+color;const cached=tints.get(key);if(cached){tints.delete(key);tints.set(key,cached);return cached;}
 if(!masks.has(brush.id))masks.set(brush.id,(async()=>{const shape=await readAsset(brush.shape),grain=brush.grain?await readAsset(brush.grain):undefined,c=new OffscreenCanvas(256,256);c.getContext('2d')!.putImageData(new ImageData(tipPixels(shape,grain,brush),256,256),0,0);return c;})().catch(error=>{masks.delete(brush.id);throw error;}));
 const mask=await masks.get(brush.id)!,c=new OffscreenCanvas(256,256),ctx=c.getContext('2d')!;ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,256,256);tints.set(key,c);if(tints.size>32)tints.delete(tints.keys().next().value!);return c;
}
scope.onmessage=async(event:MessageEvent<WorkRequest>)=>{const job=event.data;
 try{
  if(job.task.kind!=='paint')throw new Error('Unsupported paint task');const strokes=job.task.strokes,keys=strokes.map(strokeKey);
  let surface=surfaces.get(job.sourceKey);
  // Undo/changed settings replay; growing strokes append only newly sampled dabs.
  if(!surface||surface.canvas.width!==job.width||surface.canvas.height!==job.height||surface.keys.length>keys.length||surface.keys.some((key,i)=>key!==keys[i]||surface!.states[i]!.count>strokes[i]!.points.length))surface={canvas:new OffscreenCanvas(job.width,job.height),keys:[],states:[]};
  const ctx=surface.canvas.getContext('2d')!;
  for(let i=0;i<strokes.length;i++){
   const stroke=strokes[i]!,brush=brushes.get(stroke.brush);if(!brush)throw new Error('Unknown brush preset');const state=surface.states[i]??{count:0,index:0,toNext:0};
   if(state.count<stroke.points.length){const bitmap=await tip(brush,stroke.color);ctx.globalCompositeOperation=stroke.mode==='erase'?'destination-out':'source-over';appendDabs(state,stroke,job.width,job.height,brush,dab=>{ctx.save();ctx.globalAlpha=dab.opacity;ctx.translate(dab.x,dab.y);ctx.rotate(dab.angle);ctx.drawImage(bitmap,-dab.size/2,-dab.size/2,dab.size,dab.size);ctx.restore();});}
   surface.keys[i]=keys[i]!;surface.states[i]=state;
  }
  surfaces.delete(job.sourceKey);surfaces.set(job.sourceKey,surface);while([...surfaces.values()].reduce((n,s)=>n+s.canvas.width*s.canvas.height,0)>4_000_000&&surfaces.size>1)surfaces.delete(surfaces.keys().next().value!);
  // Copy rather than transferToImageBitmap: incremental backing pixels must survive.
  const bitmap=await createImageBitmap(surface.canvas),response:WorkResponse={id:job.id,bitmap};scope.postMessage(response,[bitmap]);
 }catch(error){const response:WorkResponse={id:job.id,error:error instanceof Error?error.message:String(error)};scope.postMessage(response);}
};
