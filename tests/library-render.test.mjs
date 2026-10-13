import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {renderTexture} from '../library/render.js';
const require=createRequire(import.meta.url);
const {createCanvas}=require(process.env.INKNOISE_CANVAS_MODULE||'@napi-rs/canvas');
globalThis.document={createElement:()=>createCanvas(1,1)};
function source(){const c=createCanvas(3,1),ctx=c.getContext('2d');const a=ctx.createImageData(3,1);a.data.set([0,0,0,255,255,255,255,255,128,128,128,255]);ctx.putImageData(a,0,0);return c;}
const pixels=c=>[...c.getContext('2d').getImageData(0,0,3,1).data];
test('original overlay preserves source tones and alpha',()=>{
  assert.deepEqual(pixels(renderTexture(source(),3,1,{mode:'original'})),pixels(source()));
});
test('light stamp removes black, keeps white and tints continuous grain',()=>{
  const a=pixels(renderTexture(source(),3,1,{mode:'stamp',color:'#ff0000',polarity:'light'}));
  assert.equal(a[3],0);assert.deepEqual(a.slice(4,8),[255,0,0,255]);assert.deepEqual(a.slice(8,12),[255,0,0,128]);
});
test('dark stamp removes white and retains dark marks',()=>{
  const a=pixels(renderTexture(source(),3,1,{mode:'stamp',color:'#00ff00',polarity:'dark'}));
  assert.deepEqual(a.slice(0,4),[0,255,0,255]);assert.equal(a[7],0);assert.equal(a[11],127);
});
