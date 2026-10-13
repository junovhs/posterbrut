// DEC-01: Clipping uses native canvas composition; no UI-thread pixel loops.
export function clipChain(layer,layers){
  const byId=new Map(layers.map(l=>[l.id,l])),seen=new Set([layer.id]),chain=[];let id=layer.clipTo;
  while(id){if(seen.has(id))return null;seen.add(id);const target=byId.get(id);if(!target)break;chain.push(target);id=target.clipTo;}
  return chain;
}
export function canClipTo(layer,target,layers){return target.id!==layer.id&&['image','shape'].includes(target.type)&&clipChain({...layer,clipTo:target.id},layers)!==null;}
export function worldBounds(layer){
  const a=(layer.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),pad=layer.type==='shape'?(layer.strokeWidth||0)/2:0,points=[[-pad,-pad],[layer.w+pad,-pad],[-pad,layer.h+pad],[layer.w+pad,layer.h+pad]].map(([x,y])=>[layer.x+x*c-y*s,layer.y+x*s+y*c]);
  return {x:Math.min(...points.map(p=>p[0])),y:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1]))};
}
/** One cached cropped surface per clipped layer, with a pixel-area LRU ceiling. */
export class ClipRenderer{
  constructor(createCanvas,maxPixels=4_000_000){this.createCanvas=createCanvas;this.maxPixels=maxPixels;this.cache=new Map();this.pixels=0;}
  clear(){this.cache.clear();this.pixels=0;}
  draw(ctx,layer,{layers,width,height,scale=1,key,raw}){
    const chain=clipChain(layer,layers);if(chain===null||chain.some(l=>!l.visible))return;
    if(!chain.length){raw(ctx,layer);return;}
    const signature=[scale,width,height,key(layer),...chain.map(key)].join('|');let frame=this.cache.get(layer.id);
    if(frame?.key!==signature){
      let b=worldBounds(layer);for(const target of chain){const t=worldBounds(target);b={x:Math.max(b.x,t.x),y:Math.max(b.y,t.y),right:Math.min(b.right,t.right),bottom:Math.min(b.bottom,t.bottom)};}
      const x=Math.max(0,Math.floor(b.x)),y=Math.max(0,Math.floor(b.y)),w=Math.max(0,Math.ceil(Math.min(width,b.right))-x),h=Math.max(0,Math.ceil(Math.min(height,b.bottom))-y);
      if(!w||!h)return;
      const c=this.createCanvas(Math.ceil(w*scale),Math.ceil(h*scale)),out=c.getContext('2d'),mask=this.createCanvas(c.width,c.height),mc=mask.getContext('2d');
      out.scale(scale,scale);out.translate(-x,-y);raw(out,layer);
      for(const target of chain){mc.setTransform(1,0,0,1,0,0);mc.clearRect(0,0,mask.width,mask.height);mc.setTransform(scale,0,0,scale,-x*scale,-y*scale);mc.globalAlpha=Math.max(0,Math.min(1,(target.opacity??100)/100));raw(mc,target,true);out.save();out.setTransform(1,0,0,1,0,0);out.globalCompositeOperation='destination-in';out.drawImage(mask,0,0);out.restore();}
      if(frame)this.pixels-=frame.canvas.width*frame.canvas.height;
      frame={key:signature,canvas:c,x,y,w:c.width/scale,h:c.height/scale};this.cache.delete(layer.id);if(c.width*c.height<=this.maxPixels){this.cache.set(layer.id,frame);this.pixels+=c.width*c.height;}
      while(this.pixels>this.maxPixels&&this.cache.size){const id=this.cache.keys().next().value,old=this.cache.get(id);this.pixels-=old.canvas.width*old.canvas.height;this.cache.delete(id);}
    }else{this.cache.delete(layer.id);this.cache.set(layer.id,frame);}
    ctx.drawImage(frame.canvas,frame.x,frame.y,frame.w,frame.h);
  }
}
