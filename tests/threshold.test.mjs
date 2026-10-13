import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PreparedImage,autoThreshold,effects} from '../dist/engine/core.js';
const clean={grain:0,grit:0,contrast:100,brightness:0,gamma:100,threshold:128,inkDensity:100};
function image(values,width=values.length){const rgba=new Uint8ClampedArray(values.length*4);for(const [i,v] of values.entries())rgba.set([v,v,v,255],i*4);return new PreparedImage({width,height:values.length/width,rgba});}
const alphas=result=>[...result.rgba].filter((_,i)=>i%4===3);
test('precise threshold boundaries and inversion',()=>{const p=image([0,127,128,255]);assert.deepEqual(alphas(p.render(clean)),[255,255,0,0]);assert.deepEqual(alphas(p.render({...clean,invert:true})),[0,0,255,255]);});
test('level and gamma controls change tone before thresholding',()=>{const p=image([80,110,160,190]);const a=alphas(p.render(clean));assert.notDeepEqual(alphas(p.render({...clean,blackPoint:140,whitePoint:220})),a);assert.notDeepEqual(alphas(p.render({...clean,gamma:200})),a);assert.ok(effects({blackPoint:254,whitePoint:1}).whitePoint>254);});
test('transparent pixels do not print or pollute histogram',()=>{const p=image([0,255]);p.frame.rgba[3]=0;const r=p.render(clean);assert.deepEqual(alphas(r),[0,0]);assert.equal(r.analysis.histogram.reduce((a,b)=>a+b,0),1);});
test('Otsu cutoff separates bimodal tones and empty input is stable',()=>{const p=image([20,20,20,220,220,220]);const r=p.render(clean);assert.ok(r.analysis.autoThreshold>20&&r.analysis.autoThreshold<=220);assert.deepEqual(alphas(p.render({...clean,threshold:r.analysis.autoThreshold})),[255,255,255,0,0,0]);assert.equal(autoThreshold(new Array(256).fill(0)),128);});
test('local mean and Sauvola respond to uneven lighting',()=>{const values=Array.from({length:256},(_,i)=>Math.round(i%16/15*180+30));const p=image(values,16);const global=alphas(p.render(clean));for(const localMethod of ['mean','sauvola'])assert.notDeepEqual(alphas(p.render({...clean,adaptive:100,localRadius:3,localBias:-5,localMethod})),global);});
test('all print modes remain deterministic and binary',()=>{const p=image(Array.from({length:1024},(_,i)=>i%256),32);for(const mode of ['threshold','dither','halftone','duotone']){const fx={...clean,mode,grain:25,grit:15,inkDensity:75};const a=p.render(fx,17),b=p.render(fx,17);assert.deepEqual(a.rgba,b.rgba);assert.ok(alphas(a).every(v=>v===0||v===255));}});
test('analysis cache is immutable across detail settings',()=>{const p=image(Array.from({length:64},(_,i)=>i%2?255:0),8),before=new Float32Array(p.lum);p.render({...clean,denoise:50,sharpen:40});assert.deepEqual(p.lum,before);});

test('zero density removes every ink pixel',()=>{const p=image(new Array(4096).fill(0),64);assert.ok(alphas(p.render({...clean,inkDensity:0,grain:50,grit:25})).every(v=>v===0));});

test('manual cutoff remains effective at full local strength',()=>{const p=image(Array.from({length:256},(_,i)=>i%16*12+20),16);assert.notDeepEqual(alphas(p.render({...clean,adaptive:100,threshold:80})),alphas(p.render({...clean,adaptive:100,threshold:180})));});

test('ink feel adapts dark and light sources to comparable coverage',()=>{const ramp=Array.from({length:256},(_,i)=>i);const dark=image(ramp.map(v=>20+v*.2)),light=image(ramp.map(v=>180+v*.2));for(const feelInk of [.1,.5,.9]){const a=dark.render({feelInk,feelTexture:0}),b=light.render({feelInk,feelTexture:0});assert.ok(Math.abs(a.analysis.coverage-b.analysis.coverage)<3);assert.ok(Math.abs(a.analysis.coverage-(4+feelInk*92))<3);}});
test('original tone feedback remains stable across extreme effects',()=>{const p=image(Array.from({length:256},(_,i)=>i));const a=p.render({threshold:10,contrast:350}),b=p.render({feelInk:.9,feelTexture:1});assert.deepEqual(a.analysis.sourceHistogram,b.analysis.sourceHistogram);assert.equal(a.analysis.sourceHistogram.filter(Boolean).length,256);assert.notDeepEqual(a.rgba,b.rgba);});


test('automatic balancing recovers marks across uneven illumination',()=>{
 const w=128,values=Array.from({length:w*w},(_,i)=>128+(i%w/(w-1)-.5)*140+((Math.floor(i/w/4)%2)?20:-20));
 const p=image(values,w),balanced=p.render({feelInk:.5,feelTexture:0}),global=p.render(clean);
 const accuracy=r=>alphas(r).reduce((n,a,i)=>n+(Boolean(a)===(Math.floor(i/w/4)%2===0)),0)/values.length;
 assert.ok(accuracy(balanced)>accuracy(global)+.12,`${accuracy(balanced)} vs ${accuracy(global)}`);
});
test('hidden RGB cannot change automatic balancing of visible cutouts',()=>{
 const make=hidden=>{const w=32,rgba=new Uint8ClampedArray(w*w*4);for(let y=0;y<w;y++)for(let x=0;x<w;x++){const visible=x>=8&&x<24&&y>=8&&y<24,v=visible?60+x*4+y:hidden;rgba.set([v,v,v,visible?255:0],(y*w+x)*4);}return new PreparedImage({width:w,height:w,rgba});};
 assert.deepEqual(make(0).render({feelInk:.5,feelTexture:.5},8).rgba,make(255).render({feelInk:.5,feelTexture:.5},8).rgba);
});
test('near-flat and empty sources stay finite without amplified tone extremes',()=>{
 const flat=image(Array.from({length:1024},(_,i)=>128+i%2),32),r=flat.render({feelInk:.5,feelTexture:0});
 assert.ok(r.analysis.histogram.every(Number.isFinite));assert.equal(r.analysis.histogram[0],0);assert.equal(r.analysis.histogram[255],0);
 const rgba=new Uint8ClampedArray(64*4),empty=new PreparedImage({width:8,height:8,rgba}).render({feelInk:.5,feelTexture:1});
 assert.equal(empty.analysis.coverage,0);assert.ok(empty.rgba.every(v=>v===0));
});
test('warm ink amount changes reuse tone analysis and match fresh renders in every mode',()=>{
 const values=Array.from({length:4096},(_,i)=>i%256),p=image(values,64);
 for(const mode of ['threshold','dither','halftone','duotone']){const a=p.render({feelInk:.2,feelTexture:.6,mode},7),b=p.render({feelInk:.8,feelTexture:.6,mode},7);assert.equal(a.analysis.histogram,b.analysis.histogram);assert.deepEqual(b.rgba,image(values,64).render({feelInk:.8,feelTexture:.6,mode},7).rgba);}
 assert.deepEqual(p.render({feelInk:.7,feelTexture:.1,invert:true},2).rgba,image(values,64).render({feelInk:.7,feelTexture:.1,invert:true},2).rgba);
});
