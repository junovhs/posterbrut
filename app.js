import { ThresholdClient, defaults as printDefaults } from './engine/client.js';
import { tiptopAssets } from './library/catalog.js';
import { renderTexture } from './library/render.js';
import { layoutText, drawTextLayout } from './library/text-render.js';

/* INK/NOISE — dependency-free binary-ink poster compositor.
 * Everything is rendered locally in Canvas 2D; no uploaded images leave your device.
 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const canvas = $('#poster'), context = canvas.getContext('2d', {willReadFrequently:false});
const stage = $('#artboard'), stageScroll = $('#stage-scroll'), stageInner = $('#stage-inner');
const inspector = $('#inspector');
const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const uid = ()=> 'l' + Math.random().toString(36).slice(2,9);
const esc = t => String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const f = (n,d=0)=>Number(n).toFixed(d);
const defaultFX = ()=>({...printDefaults,mode:'threshold',ink:'#161514',secondInk:'#e0be60',threshold:130,contrast:165,brightness:0,gamma:100,adaptive:0,grain:53,grainSize:42,grit:23,dither:46,halftone:9,angle:34,roughness:32,inkDensity:100,invert:false});
const defaultMask = ()=>({type:'none',points:[],roughness:30,strokes:[]});
const mkImage = (src,name,x=80,y=110,w=560,h=560)=>({id:uid(),type:'image',name,visible:true,locked:false,x,y,w,h,angle:0,opacity:100,blend:'source-over',src,fx:defaultFX(),mask:defaultMask()});
const mkText = (text,x,y,size=82)=>({id:uid(),type:'text',name:text.replace(/\n/g,' ').slice(0,25)||'Type',visible:true,locked:false,x,y,w:400,h:size,angle:0,opacity:100,blend:'source-over',text,font:'Anton',fontSize:size,weight:400,color:'#191817',tracking:0,stretch:100,lineHeight:100,distress:0,align:'left',outline:0});
const mkShape = (type,x,y,w,h)=>({id:uid(),type:'shape',name:type==='ellipse'?'Ellipse':'Rectangle',shape:type,visible:true,locked:false,x,y,w,h,angle:0,opacity:100,blend:'source-over',fill:'#151616',stroke:'#f2e7da',strokeWidth:0});
const demo = ()=>{
  const scene=mkImage('assets/messalina-scene.webp','Rome / archival image',27,60,666,558);
  scene.fx={...defaultFX(),threshold:50,contrast:122,grain:39,grit:14,roughness:22,inkDensity:100,ink:'#171717'};
  const title=mkText('DEATH',26,604,167);title.tracking=-4;title.stretch=120;
  const subtitle=mkText('OF MESSALINA',29,765,75);subtitle.tracking=-1.5;subtitle.stretch=108;
  const small=mkText('A STUDY OF POWER, DECAY & VIOLENCE   /   VOL. 001',29,865,10);small.font='IBM Plex Mono';small.weight=600;small.tracking=.4;
  const top=mkText('ANTIQUITY / RECONSTRUCTED',29,25,12);top.font='IBM Plex Mono';top.weight=700;top.tracking=1.1;
  const num=mkText('Nº 001   •   ROMA',507,27,10);num.font='IBM Plex Mono';num.weight=600;
  return {project:'DEATH OF MESSALINA',canvas:{w:720,h:900,bg:'#ed4b3b',paper:19,seed:401,texture:1},layers:[scene,title,subtitle,small,top,num],selectedId:scene.id};
};
let data = demo();
let tool='select', zoom=.68, showGrid=false, brushSize=42, pointer=null, cursor={x:0,y:0}, isBusy=false;
const printEngine=new ThresholdClient(),processing=new Map(),latestJobs=new Map(),lastFrames=new Map(),imageAnalysis=new Map(),analysisCache=new Map();
let compareImageId=null,fxGesture=null;
const images = new Map(), layerCache=new Map(), paperCache=new Map();
let replacementTargetId=null,replacementSequence=0;
let pendingFrame=0, history=[], future=[], lastHistory=0, toastTimer, autoStoreTimer, lassoPreview=[];
const selected=()=>data.layers.find(l=>l.id===data.selectedId)||null;
const getImage=src=>{
  if(!src)return null;
  if(images.has(src))return images.get(src);
  const img = new Image(); img.crossOrigin = src.startsWith('http')?'anonymous':null;
  const entry={img,ready:false,error:false,version:uid()};images.set(src,entry);
  entry.promise=new Promise(resolve=>entry.finish=resolve);
  img.onload=()=>{entry.ready=true;entry.finish(true);const live=new Set(data.layers.map(l=>l.src));for(const [key,value] of images){if(images.size<=12)break;if(value.ready&&!live.has(key))images.delete(key);}invalidate();schedule();};
  img.onerror=()=>{entry.error=true;entry.finish(false);notify('IMAGE COULD NOT BE LOADED');};
  img.src=src;
  return entry;
};
function snapshot(){return JSON.stringify(data);}
function remember(force=false){const now=Date.now();if(!force && now-lastHistory<260 && history.length)return;history.push(snapshot());if(history.length>40)history.shift();future=[];lastHistory=now;updateHistoryUI();}
function mutate(fn,{historyEntry=true,inspectorRefresh=false,layerRefresh=false}={}){if(historyEntry)remember();fn();markDirty();if(inspectorRefresh)renderInspector();if(layerRefresh)renderLayers();schedule();}
function markDirty(){$('#save-status').textContent='● MODIFIED'; clearTimeout(autoStoreTimer);autoStoreTimer=setTimeout(()=>{try{localStorage.setItem('inknoise-autosave',snapshot());$('#save-status').textContent='● AUTOSAVED';}catch(e){$('#save-status').textContent='● LOCAL ONLY';}},1100);}
function undo(){if(!history.length)return;future.push(snapshot());restore(JSON.parse(history.pop()));updateHistoryUI();}
function redo(){if(!future.length)return;history.push(snapshot());restore(JSON.parse(future.pop()));updateHistoryUI();}
function restore(obj){data=obj;for(const l of data.layers)if(l.type==='image')l.fx={...defaultFX(),...l.fx};invalidate();$('#project-name').value=data.project;refreshAll();}
function updateHistoryUI(){$('#undo-btn').disabled=history.length===0;$('#redo-btn').disabled=future.length===0;}
function notify(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400);}
function invalidate(){layerCache.clear();paperCache.clear();const ids=new Set(data.layers.map(l=>l.id));for(const key of lastFrames.keys())if(key!=='paper'&&!ids.has(key)&&!ids.has(key.replace(/^(text|stamp):/,'')))lastFrames.delete(key);}
function schedule(){if(!pendingFrame)pendingFrame=requestAnimationFrame(()=>{pendingFrame=0;render();});}
function fontSpec(l){return `${l.weight||400} ${l.fontSize||48}px "${l.font||'Anton'}", Impact, "Arial Black", sans-serif`; }
function effectiveTextWidth(l){const dummy=document.createElement('canvas').getContext('2d');dummy.font=fontSpec(l);const lines=l.text.split('\n');return Math.max(1,...lines.map(line=>{let v=0;for(const c of line)v+=dummy.measureText(c).width+(l.tracking||0);return v*(l.stretch||100)/100;}));}
function geometry(l){if(l.type==='text')return {w:Math.max(20,effectiveTextWidth(l)),h:Math.max(20,l.text.split('\n').length*l.fontSize*(l.lineHeight||100)/100)};return {w:l.w,h:l.h};}
function worldToLocal(l,x,y){const a=-(l.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=x-l.x,dy=y-l.y;return {x:dx*c-dy*s,y:dx*s+dy*c};}
function localToWorld(l,x,y){const a=(l.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return {x:l.x+x*c-y*s,y:l.y+x*s+y*c};}
function inside(l,x,y){const p=worldToLocal(l,x,y),g=geometry(l);return p.x>=0&&p.y>=0&&p.x<=g.w&&p.y<=g.h;}
function hit(x,y){for(let i=data.layers.length-1;i>=0;i--){const l=data.layers[i];if(l.visible&&!l.locked&&inside(l,x,y))return l;}return null;}
function handleHit(l,x,y){if(!l)return null;const g=geometry(l);for(let i=0;i<4;i++){const p=localToWorld(l,i%2?g.w:0,i>=2?g.h:0);if(Math.hypot(p.x-x,p.y-y)<11/zoom)return i;}return null;}
const hash=(x,y,seed=0)=>{let n=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
function noise2(x,y,seed){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;const ux=xf*xf*(3-2*xf),uy=yf*yf*(3-2*yf);const a=hash(xi,yi,seed),b=hash(xi+1,yi,seed),c=hash(xi,yi+1,seed),d=hash(xi+1,yi+1,seed);return ((a+(b-a)*ux)*(1-uy)+(c+(d-c)*ux)*uy);}
function newCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function colorRGB(c){const el=document.createElement('canvas').getContext('2d');el.fillStyle=c;const normalized=el.fillStyle;let m=normalized.match(/^#([a-f0-9]{6})$/i);if(m)return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];m=normalized.match(/^#([a-f0-9]{3})$/i);if(m)return [...m[1]].map(x=>parseInt(x+x,16));return [0,0,0];}
function requestRaster(slot,key,sourceKey,w,h,task,source,cache,finish){
  latestJobs.set(slot,key);if(cache.has(key)){if(analysisCache.has(key)){imageAnalysis.set(slot,analysisCache.get(key));updateAnalysisUI();}return Promise.resolve(cache.get(key));}if(processing.has(key))return processing.get(key);
  const promise=printEngine.run(slot,sourceKey,w,h,task,source).then(result=>{
    const c=newCanvas(w,h);c.getContext('2d').drawImage(result.bitmap,0,0);result.bitmap.close();if(finish)finish(c);
    cache.set(key,c);if(cache.size>22)cache.delete(cache.keys().next().value);
    if(latestJobs.get(slot)===key&&!slot.startsWith('export')&&(slot==='paper'||data.layers.some(l=>l.id===slot.replace(/^(text|stamp):/,'')))){lastFrames.set(slot,c);if(result.analysis){analysisCache.set(key,result.analysis);if(analysisCache.size>48)analysisCache.delete(analysisCache.keys().next().value);imageAnalysis.set(slot,result.analysis);updateAnalysisUI();}schedule();}
    return c;
  }).catch(error=>{if(error.name!=='AbortError'){notify('PROCESSING FAILED: '+error.message);console.error(error);}throw error;}).finally(()=>processing.delete(key));
  processing.set(key,promise);return promise;
}
function buildPaper(scale,wait=false){const w=Math.round(data.canvas.w*scale),h=Math.round(data.canvas.h*scale),key=`paper:${w}:${h}:${data.canvas.paper}:${data.canvas.seed}`;
  const job=requestRaster(wait?'export-paper':'paper',key,'',w,h,{kind:'paper',amount:data.canvas.paper,seed:data.canvas.seed},undefined,paperCache);
  if(wait)return job;job.catch(()=>{});return paperCache.get(key)||lastFrames.get('paper');
}
function applyMask(l,processed,w,h){const m=l.mask||defaultMask();if(m.type==='none'&&(!m.strokes||!m.strokes.length))return;
  const mask=newCanvas(w,h),mc=mask.getContext('2d');mc.fillStyle='#fff';
  if(m.type==='none')mc.fillRect(0,0,w,h);
  else if(m.type==='rough'){
    const rough=(m.roughness||30)/100, n=180, cx=w*.5,cy=h*.5,rx=w*.475,ry=h*.47;mc.beginPath();for(let i=0;i<=n;i++){let a=i/n*Math.PI*2;const tt=Math.cos(a*9+1.1)*.09+Math.sin(a*17)*.05+(hash(i,4,l.id.length)-.5)*.22;
      const mod=1+rough*tt*2.1;const x=cx+rx*Math.cos(a)*mod,y=cy+ry*Math.sin(a)*mod;i?mc.lineTo(x,y):mc.moveTo(x,y);}mc.closePath();mc.fill();
  }else if(m.type==='lasso'&&m.points?.length>2){mc.beginPath();m.points.forEach((p,i)=>i?mc.lineTo(p[0]*w,p[1]*h):mc.moveTo(p[0]*w,p[1]*h));mc.closePath();mc.fill();}
  for(const stroke of m.strokes||[]){const pts=stroke.points||[];if(!pts.length)continue;mc.save();mc.globalCompositeOperation=stroke.mode==='erase'?'destination-out':'source-over';mc.strokeStyle='#fff';mc.fillStyle='#fff';mc.lineCap='round';mc.lineJoin='round';mc.lineWidth=Math.max(1,(stroke.size||30)*w/Math.max(1,l.w));mc.beginPath();pts.forEach((p,i)=>i?mc.lineTo(p[0]*w,p[1]*h):mc.moveTo(p[0]*w,p[1]*h));if(pts.length===1){mc.arc(pts[0][0]*w,pts[0][1]*h,mc.lineWidth/2,0,Math.PI*2);mc.fill();}else mc.stroke();mc.restore();}
  const pc=processed.getContext('2d');pc.save();pc.globalCompositeOperation='destination-in';pc.drawImage(mask,0,0);pc.restore();
}
function processedImage(l,scale,preview=false,wait=false){const image=getImage(l.src);if(!image?.ready)return wait?image?.promise.then(()=>processedImage(l,scale,preview,true)):null;
  const renderScale=preview?Math.min(1,zoom*(window.devicePixelRatio||1),1024/Math.max(l.w,l.h)):scale;
  const w=Math.max(1,Math.round(l.w*renderScale)),h=Math.max(1,Math.round(l.h*renderScale));
  const sourceKey=`${l.id}:${image.version}:${w}:${h}`,key=sourceKey+':'+JSON.stringify(l.fx)+':'+JSON.stringify(l.mask)+':'+data.canvas.seed;
  const fx={...l.fx,localRadius:Math.max(1,Math.round((l.fx.localRadius||16)*renderScale))},maskLayer=JSON.parse(JSON.stringify({...l,src:''}));
  const job=requestRaster(wait&&!preview?'export:'+l.id:l.id,key,sourceKey,w,h,{kind:'image',fx,seed:data.canvas.seed+l.id.length*17},()=>createImageBitmap(image.img,{resizeWidth:w,resizeHeight:h,resizeQuality:'high'}),layerCache,c=>applyMask(maskLayer,c,w,h));
  if(wait)return job;job.catch(()=>{});return layerCache.get(key)||lastFrames.get(l.id);
}
function textureCanvas(l,scale,wait=false){
  const image=getImage(l.src);if(!image?.ready)return null;
  const w=Math.max(1,Math.round(l.w*scale)),h=Math.max(1,Math.round(l.h*scale)),key='texture:'+l.id+':'+w+':'+h+':'+image.version+':'+JSON.stringify(l.texture);
  if(layerCache.has(key))return wait?Promise.resolve(layerCache.get(key)):layerCache.get(key);
  if(l.texture.mode==='stamp'){
    const job=requestRaster(wait?'export-stamp:'+l.id:'stamp:'+l.id,key,key,w,h,{kind:'stamp',color:l.texture.color,polarity:l.texture.polarity},()=>createImageBitmap(image.img,{resizeWidth:w,resizeHeight:h}),layerCache);
    if(wait)return job;job.catch(()=>{});return lastFrames.get('stamp:'+l.id);
  }
  const c=renderTexture(image.img,w,h,l.texture);layerCache.set(key,c);return wait?Promise.resolve(c):c;
}
function textCanvas(l,scale,wait=false){const g=geometry(l),measure=document.createElement('canvas').getContext('2d');measure.font=fontSpec(l);const layout=layoutText(measure,l,g.w,g.h),w=Math.max(1,Math.ceil(layout.w*scale)),h=Math.max(1,Math.ceil(layout.h*scale));
  const key='text:'+l.id+':'+w+':'+h+':'+JSON.stringify([l.text,l.font,l.fontSize,l.weight,l.color,l.tracking,l.stretch,l.lineHeight,l.distress,l.align,l.outline])+':'+data.canvas.seed;
  if(layerCache.has(key))return layerCache.get(key);
  const c=newCanvas(w,h),cx=c.getContext('2d');cx.scale(scale,scale);cx.translate(-layout.x,-layout.y);cx.font=fontSpec(l);drawTextLayout(cx,l,layout);c.textOffset={x:layout.x,y:layout.y};
  if(l.distress){const job=requestRaster(wait?'export-text:'+l.id:'text:'+l.id,key,key,w,h,{kind:'distress',amount:l.distress,seed:data.canvas.seed+l.id.length},()=>createImageBitmap(c),layerCache,output=>output.textOffset=c.textOffset);job.catch(()=>{});return lastFrames.get('text:'+l.id)||c;}
  layerCache.set(key,c);if(layerCache.size>22)layerCache.delete(layerCache.keys().next().value);return c;
}
function drawShape(ctx,l){ctx.beginPath();if(l.shape==='ellipse')ctx.ellipse(l.w/2,l.h/2,Math.max(0,l.w/2),Math.max(0,l.h/2),0,0,Math.PI*2);else ctx.rect(0,0,l.w,l.h);if(l.fill!=='transparent'){ctx.fillStyle=l.fill;ctx.fill();}if(l.strokeWidth>0){ctx.strokeStyle=l.stroke;ctx.lineWidth=l.strokeWidth;ctx.stroke();}}
function drawComposition(ctx,scale,{preview=false,includeGuides=false}={}){
  const w=data.canvas.w,h=data.canvas.h;ctx.save();ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=data.canvas.bg;ctx.fillRect(0,0,w,h);
  for(const l of data.layers){if(!l.visible)continue;
    ctx.save();ctx.globalAlpha=clamp(l.opacity/100,0,1);ctx.globalCompositeOperation=l.blend||'source-over';ctx.translate(l.x,l.y);ctx.rotate((l.angle||0)*Math.PI/180);
    if(l.type==='image'){const c=processedImage(l,scale,preview);if(preview&&compareImageId===l.id&&getImage(l.src)?.ready){ctx.drawImage(getImage(l.src).img,0,0,l.w,l.h);}else if(c){ctx.drawImage(c,0,0,l.w,l.h);}else{ctx.fillStyle='#201f1c';ctx.fillRect(0,0,l.w,l.h);ctx.fillStyle='#e6d9bf';ctx.font='16px monospace';ctx.fillText('LOADING IMAGE...',15,30);}}
    else if(l.type==='texture'){const c=textureCanvas(l,scale);if(c)ctx.drawImage(c,0,0,l.w,l.h);}
    else if(l.type==='shape')drawShape(ctx,l);
    else if(l.type==='text'){const c=textCanvas(l,scale);ctx.drawImage(c,c.textOffset.x,c.textOffset.y,c.width/scale,c.height/scale);}
    ctx.restore();
  }
  if(data.canvas.paper>0){ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Math.min(.95,data.canvas.paper/100+.22);const stock=buildPaper(scale);if(stock)ctx.drawImage(stock,0,0,w,h);ctx.restore();}
  if(preview){drawSelection(ctx);if(tool==='lasso'&&lassoPreview.length){ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=1.7/zoom;ctx.setLineDash([4/zoom,4/zoom]);ctx.beginPath();lassoPreview.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();}}
  ctx.restore();
}
function drawSelection(ctx){const l=selected();if(!l||!l.visible)return;const g=geometry(l);ctx.save();ctx.translate(l.x,l.y);ctx.rotate(l.angle*Math.PI/180);ctx.strokeStyle='#fffdf1';ctx.lineWidth=1/zoom;ctx.setLineDash([6/zoom,4/zoom]);ctx.strokeRect(0,0,g.w,g.h);ctx.setLineDash([]);const sz=6/zoom;for(let i=0;i<4;i++){const x=i%2?g.w:0,y=i>=2?g.h:0;ctx.fillStyle='#ff553e';ctx.fillRect(x-sz/2,y-sz/2,sz,sz);ctx.strokeStyle='#1c1d1a';ctx.lineWidth=1/zoom;ctx.strokeRect(x-sz/2,y-sz/2,sz,sz);}ctx.restore();}
function render(){const w=data.canvas.w,h=data.canvas.h;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}try{drawComposition(context,1,{preview:true});}catch(e){console.error(e);$('#footer-state').textContent='RENDER ERROR — SEE CONSOLE';}$('#canvas-label').textContent=`${w} × ${h} PX`;}
function setZoom(z){zoom=clamp(z,.12,2.4);stage.style.width=`${Math.round(data.canvas.w*zoom)}px`;stage.style.height=`${Math.round(data.canvas.h*zoom)}px`;$('#zoom-label').textContent=`${Math.round(zoom*100)}%`;schedule();}
function fitZoom(){const rect=stageScroll.getBoundingClientRect();const z=Math.min((rect.width-115)/data.canvas.w,(rect.height-95)/data.canvas.h);setZoom(clamp(z,.2,1));}
function renderLayers(){const root=$('#layers-list');$('#layer-count').textContent=String(data.layers.length).padStart(2,'0');root.innerHTML=[...data.layers].reverse().map(l=>`<div class="layer-item ${l.id===data.selectedId?'selected':''}" data-id="${l.id}">
  <div class="layer-thumb ${l.type==='shape'?'shape-thumb':''}" ${l.type==='shape'?`style="--thumb-color:${esc(l.fill)}"`:''}>${l.src?`<img src="${esc(l.src)}" alt="">`:l.type==='text'?'T':l.type==='shape'?'◩':'◇'}</div>
  <div class="layer-info"><div class="layer-name">${esc(l.name)}</div><div class="layer-meta">${l.type==='texture'?(l.texture.mode==='stamp'?'✳ STAMP':'▤ TEXTURE'):l.type==='image'?'▤ RASTER':l.type==='text'?'T TYPE':'◇ VECTOR'} · ${l.opacity}%</div></div>
  <button class="layer-eye ${l.visible?'':'off'}" data-visibility="${l.id}" title="Toggle visibility">${l.visible?'◉':'◌'}</button></div>`).join('');
  root.querySelectorAll('.layer-item').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('[data-visibility]'))return;data.selectedId=el.dataset.id;setTool('select');renderLayers();renderInspector();schedule();}));
  root.querySelectorAll('[data-visibility]').forEach(b=>b.addEventListener('click',()=>mutate(()=>{const l=data.layers.find(x=>x.id===b.dataset.visibility);l.visible=!l.visible;},{layerRefresh:true})));
}
const section=(title,content,right='')=>`<section class="ins-section"><div class="sec-header"><span>${title}</span><small>${right}</small></div>${content}</section>`;
const ninput=(obj,key,label,min=-9999,max=9999,step=1)=>`<div class="field-stack"><label>${label}</label><input type="number" data-prop="${obj}.${key}" min="${min}" max="${max}" step="${step}" value="${f(prop(obj+'.'+key),step<1?2:0)}"></div>`;
function prop(path){let obj=data;if(path.startsWith('layer.')){obj=selected();path=path.slice(6);}else if(path.startsWith('canvas.')){obj=data.canvas;path=path.slice(7);}const ps=path.split('.');return ps.reduce((o,k)=>o?.[k],obj);}
function range(path,title,min,max,step=1,unit='%'){const v=prop(path);return `<div class="ins-row"><label class="ins-label">${title}</label><input aria-label="${title}" type="range" data-prop="${path}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="ins-value" data-display="${path}">${f(v,step<1?1:0)}${unit}</span></div>`;}
function field(path,label,type='text'){return `<div class="field-stack"><label>${label}</label><input type="${type}" data-prop="${path}" value="${esc(prop(path))}"></div>`;}
function color(path,title){return `<div class="ins-row"><label class="ins-label">${title}</label><input aria-label="${esc(title)}" type="color" data-prop="${path}" value="${esc(prop(path))}"><span class="ins-value">${esc(prop(path)).toUpperCase()}</span></div>`;}
function selectField(path,title,choices){return `<div class="ins-row"><label class="ins-label">${title}</label><select aria-label="${esc(title)}" data-prop="${path}">${choices.map(([v,label])=>`<option value="${esc(v)}" ${prop(path)===v?'selected':''}>${label}</option>`).join('')}</select></div>`;}
const blends=[['source-over','Normal'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],['darken','Darken'],['lighten','Lighten'],['difference','Difference'],['exclusion','Exclusion'],['hard-light','Hard light'],['soft-light','Soft light'],['color-burn','Color burn']];
function canvasInspector(){return section('01 — ARTBOARD',`<div class="field-pair">${field('canvas.w','WIDTH / PX','number')}${field('canvas.h','HEIGHT / PX','number')}</div>${color('canvas.bg','Paper color')}<div class="button-row"><button class="outline-button" data-action="preset-square">SQUARE 1:1</button><button class="outline-button" data-action="preset-portrait">POSTER 4:5</button></div>`,'DIMENSIONS')
  +section('02 — PAPER STOCK',`${range('canvas.paper','Paper grit',0,100,1)}${field('canvas.seed','Seed','number')}<p class="section-note">Physical-looking paper fibers and surface dust are rendered at export resolution. The seed makes your texture repeatable.</p><button class="utility-button wide" data-action="library">BROWSE TIPTOP LIBRARY</button><button class="utility-button wide" data-action="random-seed">↻ RE-ROLL GRAIN SEED</button>`,'TEXTURE')
  +section('03 — QUICK START',`<div class="button-row"><button class="outline-button" data-action="add-image">＋ IMAGE</button><button class="outline-button" data-action="add-text">T TEXT</button></div><div class="button-row"><button class="outline-button" data-action="add-rect">▣ SHAPE</button><button class="outline-button" data-action="export">↗ EXPORT</button></div><div class="callout">THE FORMULA: <strong>RAW IMAGE → THRESHOLD → GRAIN → MASK → BINARY PRINT</strong><br>Upload any photo, draw an unruly lasso around a subject, then adjust its ink density to blend it into the poster.</div>`,'WORKFLOW');}
function transformInspector(l){return section('01 — TRANSFORM',`<div class="field-pair">${ninput('layer','x','X / POSITION')}${ninput('layer','y','Y / POSITION')}${l.type!=='text'?ninput('layer','w','WIDTH / PX',10,4000)+ninput('layer','h','HEIGHT / PX',10,4000):ninput('layer','fontSize','FONT SIZE',4,800)}</div>${range('layer.angle','Rotation',-180,180,1,'°')}<div class="button-row"><button class="outline-button" data-action="center-h">CENTER H</button><button class="outline-button" data-action="center-v">CENTER V</button></div>`,'GEOMETRY');}
function compositionInspector(l){return section('02 — COMPOSITING',`${range('layer.opacity','Opacity',0,100)}${selectField('layer.blend','Blend mode',blends)}<p class="section-note">${l.type==='texture'?'Blend this texture with the layers below. Opacity controls its strength.':'<strong>Layer opacity</strong> is ordinary transparency. <strong>Ink density</strong> in the print engine deletes dots instead, leaving ink fully opaque.'}</p>`,'LAYER');}
function fxControl(key,title,min,max,step=1,unit=''){
  const path='layer.fx.'+key,value=prop(path);return `<div class="fx-control"><label>${title}<span>${unit}</span></label><div><input type="range" aria-label="${title}" data-prop="${path}" min="${min}" max="${max}" step="${step}" value="${value}"><input type="number" aria-label="${title} value" data-prop="${path}" min="${min}" max="${max}" step="${step}" value="${value}"></div></div>`;
}
function updateAnalysisUI(){const l=selected(),analysis=l&&imageAnalysis.get(l.id),root=$('#fx-histogram');if(!analysis||!root)return;
  const max=Math.max(1,...analysis.histogram);root.innerHTML=analysis.histogram.map((count,i)=>`<rect x="${i}" y="${40-count/max*40}" width="1" height="${count/max*40}"/>`).join('')+`<line x1="${l.fx.threshold}" x2="${l.fx.threshold}" y1="0" y2="40"/>`;
  $('#fx-status').textContent=`${analysis.coverage.toFixed(1)}% INK · LIVE PREVIEW`;
}
const fxPresets={clean:{...printDefaults,grain:0,grit:0,contrast:100},photocopy:{...printDefaults,grain:10,grit:5,contrast:180,threshold:140},detail:{...printDefaults,grain:0,grit:0,contrast:110,adaptive:65,localMethod:'sauvola',localRadius:24,sharpen:20},linework:{...printDefaults,grain:0,grit:0,contrast:150,threshold:110,adaptive:75,localRadius:16,localBias:-12,denoise:15}};
function fxInspector(l){return section('THRESHOLD / PRINT EFFECT',`<div class="mode-grid">${[['threshold','THRESH'],['dither','DITHER'],['halftone','HALFTONE'],['duotone','2-TONE']].map(([mode,label])=>`<button class="${l.fx.mode===mode?'active':''}" data-mode="${mode}">${label}</button>`).join('')}</div>
    <svg id="fx-histogram" class="fx-histogram" viewBox="0 0 256 40" role="img" aria-label="Image tone histogram and threshold position"></svg><div id="fx-status" class="section-note" role="status">Updating preview…</div>
    ${fxControl('threshold','Threshold',0,255,.1)}<div class="button-row"><button class="outline-button" id="fx-auto">AUTO THRESHOLD</button><button class="outline-button" id="fx-compare" aria-pressed="false">HOLD ORIGINAL</button></div>
    <div class="fx-presets">${[['clean','CLEAN'],['photocopy','PHOTOCOPY'],['detail','DETAIL'],['linework','LINEWORK']].map(([key,label])=>`<button data-fx-preset="${key}" class="outline-button">${label}</button>`).join('')}</div>
    ${fxControl('contrast','Contrast',10,350,1,'%')}${fxControl('brightness','Exposure',-100,100,.1)}${fxControl('gamma','Gamma',20,300,1,'%')}
    <details class="fx-details"><summary>LEVELS & DETAIL</summary>${fxControl('blackPoint','Black point',0,254)}${fxControl('whitePoint','White point',1,255)}${fxControl('denoise','Denoise',0,100,1,'%')}${fxControl('sharpen','Detail boost',0,100,1,'%')}</details>
    <details class="fx-details" ${l.fx.adaptive?'open':''}><summary>LOCAL THRESHOLD</summary>${fxControl('adaptive','Local strength',0,100,1,'%')}${selectField('layer.fx.localMethod','Method',[['mean','Local mean'],['sauvola','Detail / Sauvola']])}${fxControl('localRadius','Neighborhood',1,128,1,'px')}${fxControl('localBias','Local bias',-100,100,.1)}<p class="section-note">Local threshold follows uneven lighting. Neighborhood controls the size of detail; bias adds or removes ink.</p></details>
    ${color('layer.fx.ink','Primary ink')}${l.fx.mode==='duotone'?color('layer.fx.secondInk','Secondary ink'):''}
    <label class="ins-row"><span class="ins-label">Invert</span><input type="checkbox" data-prop="layer.fx.invert" ${l.fx.invert?'checked':''}><span class="section-note">Switch positive / negative</span></label><button class="utility-button wide" id="fx-reset">RESET EFFECT</button>`,'LIVE')
    +section('04 — GRAIN LAB',`${range('layer.fx.grain','Film grain',0,100,1,'%')}${range('layer.fx.grainSize','Grain scale',0,100,1,'%')}${range('layer.fx.grit','Ink erosion',0,100,1,'%')}${range('layer.fx.inkDensity','Ink density',0,100,1,'%')}${l.fx.mode==='dither'?range('layer.fx.dither','Dither matrix',0,100,1,'%'):''}${l.fx.mode==='halftone'?range('layer.fx.halftone','Screen LPI',1,13,1,'')+range('layer.fx.angle','Screen angle',0,90,1,'°'):''}
    <div class="callout"><strong>100% OPAQUE INK · SPATIALLY THINNED</strong><br>At 60% density, missing pixels show the layers below. Surviving printed pixels retain 255 alpha. Not a transparency hack.</div><div class="button-row"><button class="outline-button" data-action="grain-fine">FINE DUST</button><button class="outline-button" data-action="grain-heavy">ROUGH INK</button></div>`,'PHYSICAL PRINT')
    +section('05 — CUTOUT / MASK',`<div class="mode-grid"><button data-action="mask-none" class="${l.mask.type==='none'?'active':''}">NO MASK</button><button data-action="mask-rough" class="${l.mask.type==='rough'?'active':''}">ROUGH CUT</button><button data-action="lasso" class="${l.mask.type==='lasso'?'active':''}">LASSO</button></div>
    ${range('layer.mask.roughness','Jagged edge',0,100,1,'%')}<div class="button-row"><button class="outline-button" data-action="mask-erase">− ERASE BRUSH</button><button class="outline-button" data-action="mask-reveal">＋ RESTORE</button></div>
    <div class="ins-row"><span class="ins-label">Brush size</span><input type="range" id="brush-size" min="4" max="240" value="${brushSize}"><span class="ins-value" id="brush-size-label">${brushSize}px</span></div>
    <button class="utility-button wide" data-action="clear-brush">CLEAR BRUSH STROKES</button><p class="section-note">Choose <strong>ROUGH CUT</strong> for an instant irregular die-cut; use <strong>LASSO</strong> to trace a subject directly on canvas. Erase or restore the mask with the brush. Brush changes are non-destructive.</p>`,'RAW EDGES');}
function textureInspector(l){return section('03 — TIPTOP '+(l.libraryKind==='paper'?'PAPER':'INK STAMP'),
  (l.libraryKind==='ink'?selectField('layer.texture.mode','Render as',[['stamp','Tinted stamp'],['original','Original overlay']]):'')
  +(l.texture.mode==='stamp'?color('layer.texture.color','Stamp ink')+selectField('layer.texture.polarity','Keep marks',[['light','Light on dark'],['dark','Dark on light']]):'')
  +`<p class="section-note">${l.texture.mode==='stamp'?'The background becomes transparent. Choose which marks to keep, then tint them with any ink color.':'Original image tones are preserved. Try Multiply, Screen or Soft light with the opacity control above.'}</p><div class="button-row"><button class="outline-button" data-action="shape-full">FILL CANVAS</button><button class="outline-button" data-action="library">BROWSE LIBRARY</button></div>`,'LIBRARY');}
function textInspector(l){const fonts=['Anton','Archivo Black','Bebas Neue','Barlow Condensed','Oswald','Space Grotesk','Inter','IBM Plex Mono'];return section('03 — TYPOGRAPHY',`<div class="field-stack"><label>TEXT CONTENT</label><textarea class="full-textarea" data-prop="layer.text">${esc(l.text)}</textarea></div><div class="subhead">TYPE FAMILY / GOOGLE FONTS</div>${selectField('layer.font','Typeface',fonts.map(x=>[x,x]))}<div class="field-pair">${ninput('layer','weight','WEIGHT',100,900,100)}${ninput('layer','fontSize','SIZE / PX',4,800)}</div>${range('layer.tracking','Tracking',-20,50,.5,'px')}${range('layer.stretch','X stretch',30,300,1,'%')}${range('layer.lineHeight','Leading',50,250,1,'%')}${color('layer.color','Ink color')}${range('layer.distress','Text distress',0,100)}${range('layer.outline','Outline',0,12,1,'px')}<p class="section-note">True individual-glyph tracking, horizontal type stretching, variable type weight, multi-line leading and distressed letterpress printing.</p>`,'TYPE LAB');}
function shapeInspector(l){return section('03 — SHAPE',`${selectField('layer.shape','Geometry',[['rect','Rectangle'],['ellipse','Ellipse']])}${color('layer.fill','Fill ink')}${color('layer.stroke','Outline ink')}${range('layer.strokeWidth','Stroke',0,40,1,'px')}<div class="button-row"><button class="outline-button" data-action="shape-full">FILL CANVAS</button><button class="outline-button" data-action="duplicate">DUPLICATE</button></div>`,'VECTOR');}
function renderInspector(){const l=selected();$('#active-type').textContent=l?(l.type==='texture'?(l.libraryKind==='paper'?'PAPER':l.texture.mode==='stamp'?'STAMP':'TEXTURE'):l.type.toUpperCase()):'ARTBOARD';if(!l){inspector.innerHTML=canvasInspector();wireInspector();return;}
  inspector.innerHTML=`<div class="ins-section" style="padding:12px 20px"><input class="full-input" aria-label="Layer name" data-prop="layer.name" value="${esc(l.name)}">${l.type==='image'?`<button class="utility-button wide" data-action="replace-image" ${l.locked?'disabled':''}>REPLACE IMAGE</button>`:''}</div>`+(l.type==='image'?fxInspector(l):'')+transformInspector(l)+compositionInspector(l)+(l.type==='texture'?textureInspector(l):l.type==='text'?textInspector(l):l.type==='shape'?shapeInspector(l):'')+section('06 — LAYER ACTIONS',`<div class="button-row"><button class="outline-button" data-action="duplicate">⧉ DUPLICATE</button><button class="outline-button" data-action="delete">⌫ DELETE</button></div><div class="button-row"><button class="outline-button" data-action="up">↑ UP</button><button class="outline-button" data-action="down">↓ DOWN</button></div><button class="utility-button wide" data-action="toggle-lock">${l.locked?'UNLOCK LAYER':'LOCK LAYER'}</button>`,'EDIT');wireInspector();}
function updateProp(path,val){const target=path.startsWith('canvas.')?data.canvas:selected();if(!target)return;const p=path.startsWith('canvas.')?path.slice(7):path.slice(6),keys=p.split('.');let holder=target;for(let i=0;i<keys.length-1;i++)holder=holder[keys[i]];const k=keys.at(-1),old=holder[k];if(path.startsWith('layer.fx.')&&typeof val!=='boolean'){const bounds={threshold:[0,255],contrast:[10,350],brightness:[-100,100],gamma:[20,300],blackPoint:[0,254],whitePoint:[1,255],denoise:[0,100],sharpen:[0,100],adaptive:[0,100],localRadius:[1,128],localBias:[-100,100]};if(bounds[k])val=clamp(Number(val),...bounds[k]);}if(typeof old==='number')val=Number(val);else if(typeof old==='boolean')val=!!val;if(Number.isNaN(val))return; if(['w','h','fontSize'].includes(k)&&typeof val==='number')val=Math.max(k==='fontSize'?4:10,val);
  if(old===val)return;if(fxGesture?.path===path){if(!fxGesture.recorded){remember(true);fxGesture.recorded=true;}}else remember();holder[k]=val;if(path==='layer.fx.blackPoint')holder.whitePoint=Math.max(holder.whitePoint,val+1);if(path==='layer.fx.whitePoint')holder.blackPoint=Math.min(holder.blackPoint,val-1);
  if(path==='layer.text')target.name=val.replace(/\n/g,' ').slice(0,25)||'Text';
  if(path==='layer.font')document.fonts.load(fontSpec(target)).then(schedule);
  if(path.startsWith('layer.fx.')||path.startsWith('layer.mask.'))latestJobs.delete(target.id);
  if(path.startsWith('layer.texture.')||path.startsWith('layer.fx.')||path.startsWith('layer.mask.')||path.startsWith('layer.text')||path.startsWith('layer.font')||path.startsWith('layer.distress')||path.startsWith('layer.tracking'))layerCache.clear();
  if(path==='canvas.w'||path==='canvas.h')setZoom(zoom);
  markDirty();schedule();
}
function wireInspector(){inspector.querySelectorAll('[data-prop]').forEach(el=>{
  const path=el.dataset.prop;if(path.startsWith('layer.fx.')){const begin=()=>{fxGesture={path,recorded:false};},end=()=>{fxGesture=null;};el.addEventListener('pointerdown',begin);el.addEventListener('focus',begin);el.addEventListener('pointerup',end);el.addEventListener('blur',end);}el.addEventListener(el.type==='range'||(el.type==='number'&&path.startsWith('layer.fx.'))||el.tagName==='TEXTAREA'?'input':'change',()=>{updateProp(path,el.type==='checkbox'?el.checked:el.value);inspector.querySelectorAll(path.startsWith('layer.fx.')?'[data-prop^="layer.fx."]':`[data-prop="${path}"]`).forEach(other=>{if(other!==el){if(other.type==='checkbox')other.checked=prop(other.dataset.prop);else other.value=prop(other.dataset.prop);}});const d=inspector.querySelector(`[data-display="${path}"]`);if(d){const suffix=d.textContent.match(/(%|px|°)$/)?.[0]||'';d.textContent=f(el.value,Number(el.step)<1?1:0)+suffix;}if(el.type==='color'&&el.nextElementSibling)el.nextElementSibling.textContent=el.value.toUpperCase();if(['layer.font','layer.text','layer.name','layer.shape','layer.texture.mode'].includes(path))renderLayers();if(path==='layer.texture.mode')renderInspector();});
  });
  inspector.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>mutate(()=>{selected().fx.mode=el.dataset.mode;invalidate();},{inspectorRefresh:true})));
  inspector.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>runAction(el.dataset.action)));
  updateAnalysisUI();
  inspector.querySelectorAll('[data-fx-preset]').forEach(button=>button.onclick=()=>{remember(true);mutate(()=>{const l=selected(),ink=l.fx.ink;l.fx={...fxPresets[button.dataset.fxPreset],ink};layerCache.clear();},{historyEntry:false,inspectorRefresh:true});});
  const reset=$('#fx-reset');if(reset)reset.onclick=()=>{remember(true);mutate(()=>{selected().fx={...printDefaults,grain:0,grit:0,contrast:100};layerCache.clear();},{historyEntry:false,inspectorRefresh:true});};
  const auto=$('#fx-auto');if(auto)auto.onclick=async()=>{const layer=selected();auto.disabled=true;try{await processedImage(layer,1,true,true);if(selected()===layer){const analysis=imageAnalysis.get(layer.id);if(analysis){remember(true);mutate(()=>{layer.fx.threshold=analysis.autoThreshold;layerCache.clear();},{historyEntry:false,inspectorRefresh:true});}}}catch(error){if(error.name!=='AbortError')notify('AUTO THRESHOLD FAILED');}finally{auto.disabled=false;}};
  const compare=$('#fx-compare');if(compare){const show=()=>{compareImageId=selected()?.id;compare.setAttribute('aria-pressed','true');schedule();},hide=()=>{compareImageId=null;compare.setAttribute('aria-pressed','false');schedule();};compare.onpointerdown=show;compare.onpointerup=hide;compare.onpointerleave=hide;compare.onpointercancel=hide;compare.onblur=hide;compare.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();show();}};compare.onkeyup=hide;}
  const bs=$('#brush-size');if(bs)bs.addEventListener('input',e=>{brushSize=Number(e.target.value);$('#brush-size-label').textContent=brushSize+'px';});
}
function newText(){const l=mkText('YOUR TEXT',data.canvas.w*.17,data.canvas.h*.44,95);mutate(()=>{data.layers.push(l);data.selectedId=l.id;},{layerRefresh:true,inspectorRefresh:true});setTool('select');}
function newShape(type){const l=mkShape(type,data.canvas.w*.32,data.canvas.h*.34,data.canvas.w*.37,data.canvas.h*.19);mutate(()=>{data.layers.push(l);data.selectedId=l.id;},{layerRefresh:true,inspectorRefresh:true});setTool('select');}
function deleteSelected(){const l=selected();if(!l)return;mutate(()=>{const i=data.layers.indexOf(l);data.layers.splice(i,1);data.selectedId=data.layers[Math.max(0,i-1)]?.id||null;},{layerRefresh:true,inspectorRefresh:true});}
function duplicateSelected(){const l=selected();if(!l)return;const copy=JSON.parse(JSON.stringify(l));copy.id=uid();copy.name=l.name+' copy';copy.x+=24;copy.y+=24;mutate(()=>{data.layers.splice(data.layers.indexOf(l)+1,0,copy);data.selectedId=copy.id;},{layerRefresh:true,inspectorRefresh:true});}
function moveLayer(dir){const l=selected();if(!l)return;const i=data.layers.indexOf(l),target=i+dir;if(target<0||target>=data.layers.length)return;mutate(()=>{data.layers.splice(i,1);data.layers.splice(target,0,l);},{layerRefresh:true});}
function runAction(a){const l=selected();switch(a){case'replace-image':if(l?.type==='image'&&!l.locked){replacementTargetId=l.id;replacementSequence++;$('#replace-image-input').value='';$('#replace-image-input').click();}break;case'library':openLibrary();break;case'add-image':$('#image-input').click();break;case'add-text':newText();break;case'add-rect':newShape('rect');break;case'add-circle':newShape('ellipse');break;case'delete':deleteSelected();break;case'duplicate':duplicateSelected();break;case'up':moveLayer(1);break;case'down':moveLayer(-1);break;
    case'center-h':if(l)mutate(()=>l.x=(data.canvas.w-geometry(l).w)/2,{inspectorRefresh:true});break;
    case'center-v':if(l)mutate(()=>l.y=(data.canvas.h-geometry(l).h)/2,{inspectorRefresh:true});break;
    case'shape-full':if(l)mutate(()=>{l.x=0;l.y=0;l.w=data.canvas.w;l.h=data.canvas.h;},{inspectorRefresh:true});break;
    case'toggle-lock':if(l)mutate(()=>l.locked=!l.locked,{inspectorRefresh:true,layerRefresh:true});break;
    case'mask-none':if(l?.type==='image')mutate(()=>{l.mask.type='none';l.mask.strokes=[];invalidate();},{inspectorRefresh:true});break;
    case'mask-rough':if(l?.type==='image')mutate(()=>{l.mask.type='rough';invalidate();},{inspectorRefresh:true});break;
    case'lasso':setTool('lasso');break;
    case'mask-erase':setTool('mask-erase');break;
    case'mask-reveal':setTool('mask-reveal');break;
    case'clear-brush':if(l?.type==='image')mutate(()=>{l.mask.strokes=[];invalidate();});break;
    case'grain-fine':if(l?.type==='image')mutate(()=>{Object.assign(l.fx,{grain:67,grainSize:14,grit:12,inkDensity:90});invalidate();},{inspectorRefresh:true});break;
    case'grain-heavy':if(l?.type==='image')mutate(()=>{Object.assign(l.fx,{grain:82,grainSize:67,grit:48,inkDensity:77});invalidate();},{inspectorRefresh:true});break;
    case'random-seed':mutate(()=>{data.canvas.seed=Math.floor(Math.random()*100000);invalidate();},{inspectorRefresh:true});break;
    case'preset-square':mutate(()=>{data.canvas.w=900;data.canvas.h=900;setZoom(zoom);},{inspectorRefresh:true});fitZoom();break;
    case'preset-portrait':mutate(()=>{data.canvas.w=720;data.canvas.h=900;setZoom(zoom);},{inspectorRefresh:true});fitZoom();break;
    case'export':openExport();break;
  }}
function setTool(t){if(t.startsWith('add-')){runAction(t);return;}tool=t;$$('.rail-tool[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));stage.style.cursor=t==='hand'?'grab':t==='lasso'?'crosshair':t.startsWith('mask-')?'none':'default';canvas.style.cursor=t==='hand'?'grab':t==='lasso'?'crosshair':t.startsWith('mask-')?'none':'crosshair';$('#footer-state').textContent=t==='lasso'?'TRACE CUTOUT · RELEASE TO CLOSE':t==='mask-erase'?'MASK ERASER · PAINT TO CUT':t==='mask-reveal'?'MASK RESTORE · PAINT TO REVEAL':'READY TO PRINT';$('#brush-cursor').hidden=!t.startsWith('mask-');}
function canvasCoords(e){const r=stage.getBoundingClientRect();return {x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom};}
function onPointerDown(e){if(e.button!==0&&e.button!==1)return;const p=canvasCoords(e),l=selected();stage.setPointerCapture(e.pointerId);
  pointer={mode:'',x:p.x,y:p.y,startX:p.x,startY:p.y,orig:l?{x:l.x,y:l.y,w:l.w,h:l.h}:null,screenX:e.clientX,screenY:e.clientY,scrollX:stageScroll.scrollLeft,scrollY:stageScroll.scrollTop,pointStart:p};
  if(tool==='hand'||e.button===1||e.spaceKey){pointer.mode='pan';return;}
  if(tool==='lasso'){
    if(!l||l.type!=='image'||l.locked){notify('SELECT AN IMAGE LAYER TO CUT OUT');pointer=null;return;}remember();pointer.mode='lasso';lassoPreview=[p];return;}
  if(tool==='mask-erase'||tool==='mask-reveal'){
    if(!l||l.type!=='image'||l.locked){notify('SELECT AN IMAGE LAYER TO PAINT ITS MASK');pointer=null;return;}
    remember();pointer.mode='brush';const local=worldToLocal(l,p.x,p.y);if(!l.mask)l.mask=defaultMask();l.mask.strokes.push({mode:tool==='mask-erase'?'erase':'reveal',size:brushSize,points:[[local.x/l.w,local.y/l.h]]});invalidate();schedule();return;}
  const handle=l&&!l.locked?handleHit(l,p.x,p.y):null;
  if(handle!==null){remember();pointer.mode='resize';pointer.handle=handle;return;}
  const clicked=hit(p.x,p.y);if(clicked){if(clicked.id!==data.selectedId){data.selectedId=clicked.id;renderLayers();renderInspector();}remember();pointer.mode='move';pointer.orig={x:clicked.x,y:clicked.y,w:clicked.w,h:clicked.h};}else{data.selectedId=null;renderLayers();renderInspector();pointer.mode='none';}schedule();
}
function onPointerMove(e){const p=canvasCoords(e);$('#pointer-coordinates').textContent=`X ${Math.floor(p.x).toString().padStart(3,'0')}  Y ${Math.floor(p.y).toString().padStart(3,'0')}`;
  if(tool.startsWith('mask-')){const c=$('#brush-cursor');c.style.left=`${p.x*zoom}px`;c.style.top=`${p.y*zoom}px`;c.style.width=`${brushSize*zoom}px`;c.style.height=`${brushSize*zoom}px`;}
  if(!pointer)return;const l=selected();
  if(pointer.mode==='pan'){stageScroll.scrollLeft=pointer.scrollX-(e.clientX-pointer.screenX);stageScroll.scrollTop=pointer.scrollY-(e.clientY-pointer.screenY);return;}
  if(pointer.mode==='move'&&l){const dx=p.x-pointer.startX,dy=p.y-pointer.startY;l.x=pointer.orig.x+dx;l.y=pointer.orig.y+dy;if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))l.y=pointer.orig.y;else l.x=pointer.orig.x;}schedule();return;}
  if(pointer.mode==='resize'&&l){const loc=worldToLocal(l,p.x,p.y),g=pointer.orig;
    if(l.type==='text'){const target=Math.max(5,loc.x);l.fontSize=clamp(l.fontSize*(target/Math.max(1,geometry(l).w)),5,700);layerCache.clear();}
    else {if(pointer.handle%2===1)l.w=Math.max(20,loc.x);else {const dx=p.x-pointer.startX;l.x=g.x+dx;l.w=Math.max(20,g.w-dx);}if(pointer.handle>=2)l.h=Math.max(20,loc.y);else {const dy=p.y-pointer.startY;l.y=g.y+dy;l.h=Math.max(20,g.h-dy);}if(e.shiftKey){const s=Math.max(l.w/g.w,l.h/g.h);l.w=g.w*s;l.h=g.h*s;}invalidate();}schedule();return;}
  if(pointer.mode==='lasso'){if(!lassoPreview.length||Math.hypot(p.x-lassoPreview.at(-1).x,p.y-lassoPreview.at(-1).y)>2/zoom){lassoPreview.push(p);schedule();}return;}
  if(pointer.mode==='brush'&&l){const local=worldToLocal(l,p.x,p.y),stroke=l.mask.strokes.at(-1),pt=[local.x/l.w,local.y/l.h],old=stroke.points.at(-1);if(Math.hypot((pt[0]-old[0])*l.w,(pt[1]-old[1])*l.h)>Math.max(1,brushSize*.13)){stroke.points.push(pt);invalidate();schedule();}return;}
}
function onPointerUp(e){if(!pointer)return;const mode=pointer.mode,l=selected();if(mode==='lasso'&&l&&lassoPreview.length>=3){const points=lassoPreview.map(p=>{const loc=worldToLocal(l,p.x,p.y);return [loc.x/l.w,loc.y/l.h];});l.mask.type='lasso';l.mask.points=points;l.mask.strokes=[];invalidate();renderInspector();notify('ROUGH CUTOUT CREATED · USE ERASE TO REFINE');setTool('select');}
  lassoPreview=[];pointer=null;if(['lasso','move','resize','brush'].includes(mode)){markDirty();renderLayers();renderInspector();schedule();}}
function addFiles(fileList){const files=[...fileList].filter(file=>file.type.startsWith('image/'));if(!files.length)return;remember();Promise.all(files.map(file=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve({src:reader.result,name:file.name});reader.onerror=()=>resolve(null);reader.readAsDataURL(file);}))).then(items=>{
  for(const item of items.filter(Boolean)){const l=mkImage(item.src,item.name.replace(/\.[^.]+$/,''),75+data.layers.length%4*20,110+data.layers.length%3*16,Math.round(data.canvas.w*.68),Math.round(data.canvas.w*.68));data.layers.push(l);data.selectedId=l.id;getImage(item.src);}
  markDirty();renderLayers();renderInspector();schedule();notify(`${files.length} IMAGE${files.length!==1?'S':''} ADDED · USE LASSO FOR CUTOUT`);
});}
async function replaceImage(file,targetId,sequence){
  const project=data,target=data.layers.find(l=>l.id===targetId);
  if(!file||!target||target.type!=='image'||target.locked)return;
  if(!file.type.startsWith('image/')){notify('PLEASE CHOOSE AN IMAGE');return;}
  try{
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('File could not be read'));reader.readAsDataURL(file);});
    if(!await getImage(src).promise)throw new Error('Image could not be decoded');
    if(sequence!==replacementSequence||project!==data||!data.layers.includes(target)||target.locked||target.src===src)return;
    remember(true);mutate(()=>{target.src=src;layerCache.clear();},{historyEntry:false,layerRefresh:true,inspectorRefresh:true});notify('IMAGE REPLACED');
  }catch(e){notify('IMAGE NOT REPLACED: '+e.message);}
}
function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},3000);}
function saveJSON(){const blob=new Blob([JSON.stringify({...data,version:2,engine:'INK/NOISE'},null,2)],{type:'application/json'});download(blob,(data.project||'untitled').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.inknoise.json');$('#save-status').textContent='● SAVED';notify('EDITABLE PROJECT SAVED');}
function loadJSON(file){const r=new FileReader();r.onload=()=>{try{const obj=JSON.parse(r.result);if(!obj.canvas||!Array.isArray(obj.layers))throw new Error('Invalid project file');remember();restore(obj);fitZoom();markDirty();notify('PROJECT OPENED');}catch(e){notify('INVALID PROJECT FILE');}};r.readAsText(file);}
function modal(html){const root=$('#modal-root');root.hidden=false;root.innerHTML=`<div class="modal"><button class="modal-close" id="modal-close">×</button>${html}</div>`;$('#modal-close').onclick=()=>root.hidden=true;root.onclick=e=>{if(e.target===root)root.hidden=true;};return root;}
function openLibrary(category='paper'){
  const assets=tiptopAssets.filter(a=>a.kind===category);
  const root=modal(`<div class="inspector-tiny">TIPTOP / YOUR ORIGINAL ARTWORK</div><h2 id="library-title">Textures & stamps.</h2><p>Five paper stocks and twenty ink distress sources. Add a paper beneath your artwork, or a tinted stamp above it.</p><div class="library-tabs" aria-label="Library category"><button data-library-tab="paper" aria-pressed="${category==='paper'}">PAPER / 05</button><button data-library-tab="ink" aria-pressed="${category==='ink'}">INK STAMPS / 20</button></div><div class="library-grid">${assets.map(a=>`<button class="library-card" data-asset="${a.id}" aria-label="Add ${a.name}"><img loading="lazy" decoding="async" width="240" height="240" src="${a.thumbnail}" alt=""><span>${a.name}</span><small>${category==='paper'?'ADD PAPER':'ADD STAMP'} +</small></button>`).join('')}</div><p id="library-status" role="status">${category==='paper'?'Paper is added as a background layer.':'Stamps have transparent backgrounds and editable ink colors. Switch to Original overlay for blend-mode treatments.'}</p>`);
  const dialog=root.querySelector('.modal');dialog.classList.add('library-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','library-title');
  const close=()=>{root.hidden=true;$('#library-btn').focus();};$('#modal-close').setAttribute('aria-label','Close library');$('#modal-close').onclick=close;root.onclick=e=>{if(e.target===root)close();};
  dialog.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled)')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  root.querySelectorAll('[data-library-tab]').forEach(b=>b.onclick=()=>openLibrary(b.dataset.libraryTab));
  root.querySelectorAll('[data-asset]').forEach(b=>b.onclick=async()=>{
    const asset=tiptopAssets.find(a=>a.id===b.dataset.asset),project=data;
    const buttons=[...root.querySelectorAll('[data-asset],[data-library-tab]')];buttons.forEach(button=>button.disabled=true);
    $('#library-status').textContent='Loading '+asset.name+'…';
    const ready=await getImage(asset.src).promise;
    if(root.hidden||project!==data)return;
    if(!ready){buttons.forEach(button=>button.disabled=false);$('#library-status').textContent='Could not load this image. Reload the app and try again.';return;}
    const paper=asset.kind==='paper',ratio=asset.width/asset.height;
    const w=paper?Math.max(data.canvas.w,data.canvas.h*ratio):Math.min(data.canvas.w,data.canvas.h)*.7,h=w/ratio;
    const l={id:uid(),type:'texture',libraryId:asset.id,libraryKind:asset.kind,name:asset.name,src:asset.src,visible:true,locked:false,x:(data.canvas.w-w)/2,y:(data.canvas.h-h)/2,w,h,angle:0,opacity:100,blend:'source-over',texture:{mode:paper?'original':'stamp',color:'#161514',polarity:asset.polarity}};
    remember(true);mutate(()=>{if(paper)data.layers.unshift(l);else data.layers.push(l);data.selectedId=l.id;},{historyEntry:false,layerRefresh:true,inspectorRefresh:true});setTool('select');close();notify(asset.name.toUpperCase()+' ADDED');
  });
  $('#modal-close').focus();
}
async function prepareEffects(scale){
  for(const l of data.layers.filter(l=>l.visible)){
    if(l.type==='image')await processedImage(l,scale,false,true);else if(l.type==='texture')await textureCanvas(l,scale,true);
    else if(l.type==='text'&&l.distress){textCanvas(l,scale,true);const jobs=[...processing.entries()].filter(([key])=>key.startsWith('text:'+l.id+':'));await Promise.all(jobs.map(([,promise])=>promise));}
  }
  if(data.canvas.paper>0)await buildPaper(scale,true);
}
function openExport(){const root=modal(`<div class="inspector-tiny">OUTPUT / PRESS-READY</div><h2>Export artwork<span style="color:#ff553e">.</span></h2><p>Local, full-resolution compositor. All grain, masks, vector type and binary-ink dropout are burned into the exported PNG.</p><label class="export-label">OUTPUT RESOLUTION</label><div class="export-choice" id="export-sizes"><button data-scale="1">1×<br><small>SCREEN</small></button><button data-scale="2" class="active">2×<br><small>PRINT</small></button><button data-scale="3">3×<br><small>HI-RES</small></button></div><p id="export-meta" class="section-note">${data.canvas.w*2} × ${data.canvas.h*2} px · transparent pixels only inside image masks</p><button class="primary-button" id="render-png">↗ RENDER PNG</button><div class="modal-tip">Large exports may take a few seconds. Image processing is entirely on-device and works offline after initial font load.</div>`);
  let scale=2;root.querySelectorAll('[data-scale]').forEach(b=>b.onclick=()=>{scale=Number(b.dataset.scale);root.querySelectorAll('[data-scale]').forEach(x=>x.classList.toggle('active',x===b));$('#export-meta').textContent=`${data.canvas.w*scale} × ${data.canvas.h*scale} px · RGB PNG`;});
  $('#render-png').onclick=async()=>{if(isBusy)return;isBusy=true;$('#render-png').textContent='LOADING ASSETS…';const loaded=await Promise.all(data.layers.filter(l=>l.visible&&l.src).map(l=>getImage(l.src).promise));if(loaded.some(ok=>!ok)){notify('EXPORT STOPPED: IMAGE COULD NOT BE LOADED');isBusy=false;$('#render-png').textContent='↗ RETRY PNG';return;}$('#render-png').textContent='PROCESSING…';try{await prepareEffects(scale);}catch{notify('EXPORT STOPPED: PROCESSING FAILED');isBusy=false;$('#render-png').textContent='↗ RETRY PNG';return;}$('#render-png').textContent='RENDERING…';setTimeout(()=>{try{const c=newCanvas(data.canvas.w*scale,data.canvas.h*scale);drawComposition(c.getContext('2d'),scale);c.toBlob(blob=>{if(blob){download(blob,(data.project||'poster').toLowerCase().replace(/[^a-z0-9]+/g,'-')+`-${scale}x.png`);notify('POSTER EXPORTED / '+c.width+' × '+c.height);}else notify('EXPORT FAILED');isBusy=false;root.hidden=true;},'image/png');}catch(e){console.error(e);notify('EXPORT FAILED: '+e.message);isBusy=false;root.hidden=true;}},60);};}
function openHelp(){modal(`<div class="inspector-tiny">MANUAL / FIELD NOTES</div><h2>Make some noise.</h2><p>Print-first brutalist layout engine. Combine thresholded photos, editable rough cutouts, oversized type, and vector geometry.</p><div class="shortcuts"><span><kbd>V</kbd> Select</span><span><kbd>H</kbd> Pan</span><span><kbd>T</kbd> Add type</span><span><kbd>R</kbd> Rectangle</span><span><kbd>E</kbd> Ellipse</span><span><kbd>L</kbd> Freehand lasso</span><span><kbd>B</kbd> Erase mask</span><span><kbd>G</kbd> Restore mask</span><span><kbd>⌘ / Ctrl + Z</kbd> Undo</span><span><kbd>Delete</kbd> Remove</span><span><kbd>⌘ / Ctrl + S</kbd> Save</span><span><kbd>+</kbd> Zoom in</span></div><p class="tagline">TO MAKE A CUTOUT</p><p>Upload an image → select it in Layers → press L → trace the subject by dragging around its silhouette → release. Press B and drag to chip away edges, or G to restore. Raise grain and lower Ink density for the photo to melt into adjacent imagery.</p><button class="primary-button" id="help-ok">BACK TO STUDIO →</button>`);$('#help-ok').onclick=()=>$('#modal-root').hidden=true;}
function refreshAll(){renderLayers();renderInspector();updateHistoryUI();setZoom(zoom);schedule();}
function bind(){
  $$('[data-tool]').forEach(el=>el.addEventListener('click',()=>setTool(el.dataset.tool)));
  $('#library-btn').onclick=()=>openLibrary();$('#help-btn').onclick=openHelp;$('#add-layer-btn').onclick=()=>$('#image-input').click();$('#image-input').onchange=e=>{addFiles(e.target.files);e.target.value='';};
  $('#replace-image-input').onchange=e=>{const id=replacementTargetId,sequence=replacementSequence;replacementTargetId=null;replaceImage(e.target.files[0],id,sequence);e.target.value='';};
  $('#replace-image-input').oncancel=()=>{replacementTargetId=null;};
  $('#project-input').onchange=e=>{if(e.target.files[0])loadJSON(e.target.files[0]);e.target.value='';};
  $('#new-btn').onclick=()=>{if(!confirm('Create a new composition? Export or save your current work first.'))return;remember();data={project:'UNTITLED COMPOSITION',canvas:{w:720,h:900,bg:'#e94736',paper:20,seed:420,texture:1},layers:[],selectedId:null};$('#project-name').value=data.project;invalidate();refreshAll();};
  $('#load-btn').onclick=()=>$('#project-input').click();$('#save-btn').onclick=saveJSON;$('#export-btn').onclick=openExport;
  $('#undo-btn').onclick=undo;$('#redo-btn').onclick=redo;$('#project-name').onchange=e=>mutate(()=>data.project=e.target.value);
  $('#move-up').onclick=()=>moveLayer(1);$('#move-down').onclick=()=>moveLayer(-1);$('#duplicate').onclick=duplicateSelected;$('#delete').onclick=deleteSelected;
  $('#zoom-in').onclick=()=>setZoom(zoom*1.18);$('#zoom-out').onclick=()=>setZoom(zoom/1.18);$('#fit-btn').onclick=fitZoom;$('#grid-btn').onclick=()=>{$('#grid-btn').classList.toggle('on',showGrid=!showGrid);stage.classList.toggle('with-grid',showGrid);};
  $$('.swatches button').forEach(btn=>btn.onclick=()=>{const l=selected(),c=btn.dataset.color;if(l)mutate(()=>{if(l.type==='texture'){l.texture.color=c;invalidate();}else if(l.type==='image'){l.fx.ink=c;invalidate();}else if(l.type==='text')l.color=c;else l.fill=c;},{inspectorRefresh:true});else mutate(()=>{data.canvas.bg=c;paperCache.clear();},{inspectorRefresh:true});});
  stage.addEventListener('pointerdown',onPointerDown);stage.addEventListener('pointermove',onPointerMove);stage.addEventListener('pointerup',onPointerUp);stage.addEventListener('pointercancel',onPointerUp);
  stageScroll.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(zoom*(e.deltaY>0?.92:1.08));}},{passive:false});
  stageScroll.addEventListener('dragover',e=>{e.preventDefault();stageScroll.style.outline='2px dashed #ff553e';});stageScroll.addEventListener('dragleave',()=>stageScroll.style.outline='');stageScroll.addEventListener('drop',e=>{e.preventDefault();stageScroll.style.outline='';addFiles(e.dataTransfer.files);});
  window.addEventListener('keydown',e=>{if(!$('#modal-root').hidden){if(e.key==='Escape')$('#modal-root').hidden=true;return;}const input=['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveJSON();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(input)return;
    switch(e.key.toLowerCase()){case'v':setTool('select');break;case'h':setTool('hand');break;case't':newText();break;case'r':newShape('rect');break;case'e':newShape('ellipse');break;case'l':setTool('lasso');break;case'b':setTool('mask-erase');break;case'g':setTool('mask-reveal');break;case'delete':case'backspace':deleteSelected();break;case'escape':setTool('select');data.selectedId=null;renderLayers();renderInspector();schedule();break;case'+':case'=':setZoom(zoom*1.15);break;case'-':setZoom(zoom/1.15);break;case'arrowleft':case'arrowright':case'arrowup':case'arrowdown':{const l=selected();if(!l||l.locked)break;e.preventDefault();remember();const n=e.shiftKey?10:1;if(e.key==='ArrowLeft')l.x-=n;if(e.key==='ArrowRight')l.x+=n;if(e.key==='ArrowUp')l.y-=n;if(e.key==='ArrowDown')l.y+=n;markDirty();renderInspector();schedule();break;}}});
  window.addEventListener('resize',()=>{if(window.innerWidth<760)fitZoom();});
}
function init(){try{const autosave=localStorage.getItem('inknoise-autosave');if(autosave){const saved=JSON.parse(autosave);if(saved.canvas&&Array.isArray(saved.layers))data=saved;}}catch(e){console.warn('Autosave unavailable',e);}
  $('#project-name').value=data.project;for(const l of data.layers){if(l.type==='image')l.fx={...defaultFX(),...l.fx};if(l.src)getImage(l.src);}
  bind();refreshAll();requestAnimationFrame(()=>fitZoom());document.fonts.ready.then(()=>{layerCache.clear();schedule();});}
init();
