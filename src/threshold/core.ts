// DEC-01: Keep pixel computation in workers; UI only transports state and paints.
import type {Effects,Frame,Analysis} from './types.js';
export const defaults:Effects={mode:'threshold',threshold:130,contrast:165,brightness:0,gamma:100,adaptive:0,grain:53,grainSize:42,grit:23,inkDensity:100,invert:false,ink:'#161514',secondInk:'#e0be60',dither:46,halftone:9,angle:34,blackPoint:0,whitePoint:255,denoise:0,sharpen:0,localRadius:16,localBias:0,localMethod:'mean'};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function effects(input:Partial<Effects>):Effects {const fx={...defaults,...input};fx.blackPoint=clamp(fx.blackPoint,0,254);fx.whitePoint=clamp(fx.whitePoint,fx.blackPoint+1,255);fx.localRadius=clamp(Math.round(fx.localRadius),1,512);fx.gamma=clamp(fx.gamma,20,300);return fx;}
export const hash=(x:number,y:number,seed:number)=>{let n=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
export function noise(x:number,y:number,seed:number):number{const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,ux=xf*xf*(3-2*xf),uy=yf*yf*(3-2*yf);const a=hash(xi,yi,seed),b=hash(xi+1,yi,seed),c=hash(xi,yi+1,seed),d=hash(xi+1,yi+1,seed);return (a+(b-a)*ux)*(1-uy)+(c+(d-c)*ux)*uy;}
export const rgb=(hex:string):number[]=>{const full=hex.length===4?[...hex.slice(1)].map(c=>c+c).join(''):hex.slice(1);return [0,2,4].map(i=>parseInt(full.slice(i,i+2),16)||0);};
const bayer=[0,48,12,60,3,51,15,63,32,16,44,28,35,19,47,31,8,56,4,52,11,59,7,55,40,24,36,20,43,27,39,23,2,50,14,62,1,49,13,61,34,18,46,30,33,17,45,29,10,58,6,54,9,57,5,53,42,26,38,22,41,25,37,21];
export function integral(plane:Float32Array,w:number,h:number,squared=false):Float64Array{const a=new Float64Array((w+1)*(h+1));for(let y=0;y<h;y++){let sum=0;for(let x=0;x<w;x++){const v=plane[y*w+x]!;sum+=squared?v*v:v;a[(y+1)*(w+1)+x+1]=a[y*(w+1)+x+1]!+sum;}}return a;}
function mean(a:Float64Array,x:number,y:number,r:number,w:number,h:number):number{const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r),y0=Math.max(0,y-r),y1=Math.min(h-1,y+r),s=w+1;return (a[(y1+1)*s+x1+1]!-a[y0*s+x1+1]!-a[(y1+1)*s+x0]!+a[y0*s+x0]!)/((x1-x0+1)*(y1-y0+1));}
export function autoThreshold(hist:readonly number[]):number{const total=hist.reduce((a,b)=>a+b,0);if(!total)return 128;const sum=hist.reduce((a,b,i)=>a+b*i,0);let weight=0,partial=0,best=-1,first=128,last=128;for(let t=0;t<255;t++){weight+=hist[t]||0;partial+=t*(hist[t]||0);if(!weight||weight===total)continue;const delta=partial/weight-(sum-partial)/(total-weight),variance=weight*(total-weight)*delta*delta;if(variance>best){best=variance;first=last=t;}else if(variance===best)last=t;}return best<0?Math.round(sum/total):Math.round((first+last)/2)+1;}
/** An alpha-aware tone percentile, interpolated within the occupied bin. */
function percentile(hist:readonly number[],fraction:number):number{const total=hist.reduce((a,b)=>a+b,0);if(!total)return 128;const target=clamp(fraction,0,1)*total;let count=0;for(let i=0;i<256;i++){const n=hist[i]||0;if(n&&count+n>=target)return clamp(i-.5+(target-count)/n,0,255);count+=n;}return 255;}
/** Cached immutable source analysis; slider changes reuse its luminance and integral. */
export class PreparedImage {
 readonly lum:Float32Array;readonly sums:Float64Array;readonly sourceHistogram=new Array<number>(256).fill(0);
 constructor(readonly frame:Frame){this.lum=new Float32Array(frame.width*frame.height);for(let i=0;i<this.lum.length;i++){const k=i*4;this.lum[i]=frame.rgba[k]!*.2126+frame.rgba[k+1]!*.7152+frame.rgba[k+2]!*.0722;}for(let i=0;i<this.lum.length;i++)if(frame.rgba[i*4+3]!>=5)this.sourceHistogram[Math.round(this.lum[i]!)]!++;this.sums=integral(this.lum,frame.width,frame.height);}
 render(input:Partial<Effects>,seed=0):{rgba:Uint8ClampedArray<ArrayBuffer>;analysis:Analysis}{
  const started=performance.now(),fx=effects(input),{width:w,height:h,rgba:source}=this.frame;
  // DEC-01: Source normalization and macro mapping stay inside the worker kernel.
  const macro=fx.feelInk!==undefined;
  if(macro){const texture=clamp(fx.feelTexture??.25,0,1),lo=percentile(this.sourceHistogram,.02),hi=percentile(this.sourceHistogram,.98);fx.blackPoint=lo;fx.whitePoint=Math.max(lo+1,hi);fx.contrast=100;fx.brightness=0;fx.gamma=100;fx.adaptive=0;fx.denoise=0;fx.sharpen=texture*18;fx.grain=texture*65;fx.grit=texture*38;fx.grainSize=25+texture*30;fx.inkDensity=100-texture*12;}
  const tone=new Float32Array(w*h),hist=new Array<number>(256).fill(0),lut=new Float32Array(4096);
  for(let i=0;i<lut.length;i++){let v=clamp((i/4095*255-fx.blackPoint)*255/(fx.whitePoint-fx.blackPoint),0,255);v=clamp(128+(v-128)*fx.contrast/100+fx.brightness*1.5,0,255);v=255*Math.pow(v/255,fx.gamma/100);lut[i]=fx.invert?255-v:v;}
  const denoise=fx.denoise/100,sharp=fx.sharpen/100;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let value=this.lum[i]!;if(denoise||sharp){const nearby=mean(this.sums,x,y,Math.max(1,Math.round(1+fx.denoise/25)),w,h);value=value*(1-denoise)+nearby*denoise+sharp*(value-nearby)*1.6;}value=lut[Math.round(clamp(value,0,255)/255*4095)]!;tone[i]=value;if(source[i*4+3]!>=5)hist[clamp(Math.round(value),0,255)]!++;}
  if(macro)fx.threshold=percentile(hist,.04+clamp(fx.feelInk??.5,0,1)*.92);
  const sums=fx.adaptive?integral(tone,w,h):null,squares=fx.adaptive&&fx.localMethod==='sauvola'?integral(tone,w,h,true):null;
  const out=new Uint8ClampedArray(source.length),ink=rgb(fx.ink),second=rgb(fx.secondInk);
  const grain=fx.grain/100,grit=fx.grit/100,adaptive=fx.adaptive/100,angle=fx.angle*Math.PI/180,sa=Math.sin(angle),ca=Math.cos(angle),size=Math.max(2,24-fx.halftone*1.7);let printedCount=0,opaque=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y*w+x)*4;if(source[i+3]!<5)continue;opaque++;if(fx.inkDensity<=0)continue;
   const lum=tone[y*w+x]!;let threshold=fx.threshold;
   if(sums){const local=mean(sums,x,y,fx.localRadius,w,h);const localThreshold=squares?local*(1+.25*(Math.sqrt(Math.max(0,mean(squares,x,y,fx.localRadius,w,h)-local*local))/128-1)):local;threshold=fx.threshold+adaptive*(localThreshold-128+fx.localBias);}
   let jitter=0,offset=0,blotch=0;
   if(grain||grit){blotch=noise(x/(6+fx.grainSize*.19),y/(6+fx.grainSize*.19),seed+11);if(grain)offset=((hash(x,y,seed)-.5)*1.25+(noise(x/(1+(101-fx.grainSize)/100*2),y/(1+(101-fx.grainSize)/100*2),seed+8)-.5)*.5+(blotch-.5)*.85+(noise(x/48,y/48,seed+38)-.5)*.35)*grain*100;if(grit)jitter=(blotch-.5)*grit*59+(hash(Math.floor(x/2),Math.floor(y/2),seed+55)-.5)*grit*22;}
   let primary=false,secondary=false;
   if(fx.mode==='halftone'){const u=(x*ca+y*sa)/size,v=(-x*sa+y*ca)/size,dx=(u-Math.floor(u)-.5)*2,dy=(v-Math.floor(v)-.5)*2;primary=dx*dx+dy*dy<clamp((threshold-lum+128+offset*.75)/255,0,1)*1.72;}
   else if(fx.mode==='dither')primary=lum+offset*.68+jitter*.5<threshold+((bayer[(y%8)*8+x%8]||0)/63-.5)*fx.dither*1.85;
   else{primary=lum+offset+jitter<threshold;secondary=fx.mode==='duotone'&&!primary&&lum+offset<threshold+42;}
   if(!primary&&!secondary){if(grit&&hash(x,y,seed+141)<grit*.018&&noise(x/3.2,y/3.2,seed+121)>.53)primary=true;else continue;}
   if(grit||fx.inkDensity<100){const edge=clamp(1-Math.abs(lum-threshold)/72,0,1),test=hash(x,y,seed+207)*.72+noise(x/(2+fx.grainSize*.06),y/(2+fx.grainSize*.06),seed+211)*.28;if(test<(1-fx.inkDensity/100)*.88+grit*(.009+edge*.087))continue;}
   const color=secondary?second:ink;out[i]=color[0]!;out[i+1]=color[1]!;out[i+2]=color[2]!;out[i+3]=255;printedCount++;
  }
  return {rgba:out,analysis:{sourceHistogram:this.sourceHistogram,histogram:hist,coverage:opaque?printedCount/opaque*100:0,autoThreshold:autoThreshold(hist),ms:performance.now()-started}};
 }
}
