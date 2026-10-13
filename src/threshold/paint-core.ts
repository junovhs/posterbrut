// DEC-01: Brush analysis and stroke sampling are worker-owned computation.
import {hash} from './core.js';
import type {BrushPreset,Frame,PaintPoint,PaintStroke} from './types.js';
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
/** Evaluate imported Procreate pressure curves, with a linear fallback. */
export function pressureCurve(points:number[][],p:number):number{
 p=clamp(p,0,1);for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;if(p<=b[0]!)return clamp(a[1]!+(b[1]!-a[1]!)*(p-a[0]!)/Math.max(1e-6,b[0]!-a[0]!),0,1);}return points.at(-1)?.[1]??p;
}
/** Convert original white/black shape and grain sources to a cached alpha tip. */
export function tipPixels(shape:Frame,grain:Frame|undefined,brush:BrushPreset):Uint8ClampedArray<ArrayBuffer>{
 const out=new Uint8ClampedArray(shape.rgba.length);
 for(let i=0;i<shape.width*shape.height;i++){const k=i*4,a=shape.rgba;let alpha=(a[k]!*.2126+a[k+1]!*.7152+a[k+2]!*.0722)/255;if(brush.shapeInverted)alpha=1-alpha;alpha*=a[k+3]!/255;
  if(grain){const x=i%shape.width,y=Math.floor(i/shape.width),j=(Math.min(grain.height-1,Math.floor(y/shape.height*grain.height))*grain.width+Math.min(grain.width-1,Math.floor(x/shape.width*grain.width)))*4,g=grain.rgba;let v=(g[j]!*.2126+g[j+1]!*.7152+g[j+2]!*.0722)/255;if(brush.grainInverted)v=1-v;alpha*=1-brush.grainDepth+brush.grainDepth*v;}
  out[k]=out[k+1]=out[k+2]=255;out[k+3]=Math.round(alpha*255);
 }return out;
}
export interface Dab {x:number;y:number;size:number;angle:number;opacity:number}
export interface StrokeState {count:number;index:number;toNext:number;point?:PaintPoint}
/** Append only new points; spacing and seeded scatter remain identical on replay. */
export function appendDabs(state:StrokeState,stroke:PaintStroke,w:number,h:number,brush:BrushPreset,emit:(dab:Dab)=>void):number{
 const base=Math.max(.5,stroke.size*w),step=Math.max(.5,base*brush.spacing);let emitted=0;
 const stamp=(x:number,y:number,p:number,direction:number)=>{const index=state.index++,strength=brush.pressureSize,size=base*(1-strength+strength*Math.max(brush.minSize,pressureCurve(brush.sizeCurve,p))),opacity=stroke.opacity*(1-brush.pressureOpacity+brush.pressureOpacity*Math.max(brush.minOpacity,pressureCurve(brush.opacityCurve,p)));
  const jitter=base*brush.jitter;emit({x:x+(hash(index,1,stroke.seed)-.5)*jitter,y:y+(hash(index,2,stroke.seed)-.5)*jitter,size,angle:brush.angle+(brush.follow?direction:0)+(hash(index,3,stroke.seed)-.5)*brush.scatter*Math.PI,opacity});emitted++;
 };
 for(let i=state.count;i<stroke.points.length;i++){const next=stroke.points[i]!,point:PaintPoint=[next[0]*w,next[1]*h,clamp(next[2],.01,1)];
  if(!state.point){stamp(point[0],point[1],point[2],0);state.toNext=step;}
  else{const a=state.point,dx=point[0]-a[0],dy=point[1]-a[1],length=Math.hypot(dx,dy),direction=Math.atan2(dy,dx);if(length>1e-6){let d=state.toNext;for(;d<=length;d+=step){const t=d/length;stamp(a[0]+dx*t,a[1]+dy*t,a[2]+(point[2]-a[2])*t,direction);}state.toNext=d-length;}}
  state.point=point;state.count=i+1;
 }return emitted;
}
/** Stroke headers identify incremental state; shrinking or changed strokes need replay. */
export function strokeKey(stroke:PaintStroke):string{return [stroke.id,stroke.brush,stroke.mode,stroke.color,stroke.size,stroke.opacity,stroke.seed].join(':');}
