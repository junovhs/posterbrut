import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {layoutText,drawTextLayout} from '../library/text-render.js';
const require=createRequire(import.meta.url);
const {createCanvas,GlobalFonts}=require(process.env.INKNOISE_CANVAS_MODULE||'@napi-rs/canvas');
if(process.env.INKNOISE_TEXT_FONT)GlobalFonts.registerFromPath(process.env.INKNOISE_TEXT_FONT,'TestFont');
const family=process.env.INKNOISE_TEXT_FONT?'TestFont':'serif';
for(const [name,extras] of [
  ['headline',{text:'OF MESSALINA'}],
  ['ascenders, accents and descenders',{text:'ÁÉÅ gypj\nOF MESSALINA',tracking:-2,lineHeight:90}],
  ['centered outline and stretch',{text:'Áj\nMESSALINA',outline:8,stretch:145,align:'center'}],
  ['right aligned narrow text',{text:'jÅ\nOF MESSALINA',outline:6,stretch:60,align:'right',tracking:4}],
]){
 test(name+' preserves all glyph pixels at 1x, 2x and 3x',()=>{
  const layer={text:'OF MESSALINA',fontSize:75,tracking:-1.5,stretch:108,lineHeight:100,align:'left',outline:0,color:'#191817',...extras};
  const font=`75px "${family}"`;const probe=createCanvas(1,1).getContext('2d');probe.font=font;
  const width=Math.max(...layer.text.split('\n').map(line=>[...line].reduce((w,c)=>w+probe.measureText(c).width+layer.tracking,0)))*layer.stretch/100;
  const height=layer.text.split('\n').length*layer.fontSize*layer.lineHeight/100;
  const layout=layoutText(probe,layer,width,height);
  for(const scale of [1,2,3]){
   const pad=150;const ref=createCanvas(Math.ceil((width+pad*2)*scale),Math.ceil((height+pad*2)*scale));const rc=ref.getContext('2d');rc.scale(scale,scale);rc.translate(pad,pad);rc.font=font;drawTextLayout(rc,layer,layout);
   const cropped=createCanvas(Math.ceil(layout.w*scale),Math.ceil(layout.h*scale));const cc=cropped.getContext('2d');cc.scale(scale,scale);cc.translate(-layout.x,-layout.y);cc.font=font;drawTextLayout(cc,layer,layout);
   const rebuilt=createCanvas(ref.width,ref.height);const bc=rebuilt.getContext('2d');bc.drawImage(cropped,(pad+layout.x)*scale,(pad+layout.y)*scale);
   const actual=bc.getImageData(0,0,ref.width,ref.height).data,expected=rc.getImageData(0,0,ref.width,ref.height).data;
   const x0=(pad+layout.x)*scale,y0=(pad+layout.y)*scale,x1=x0+cropped.width,y1=y0+cropped.height;
   let maxAlphaDelta=0,totalAlphaDelta=0,ink=0;
   for(let y=0;y<ref.height;y++)for(let x=0;x<ref.width;x++){
    const i=(y*ref.width+x)*4+3;
    if(x<x0||x>=x1||y<y0||y>=y1)assert.equal(expected[i],0,'Reference ink falls outside the raster bounds');
    const delta=Math.abs(actual[i]-expected[i]);maxAlphaDelta=Math.max(maxAlphaDelta,delta);totalAlphaDelta+=delta;ink+=expected[i];
   }
   // Equivalent stroke transforms can differ slightly in edge antialiasing.
   assert.ok(maxAlphaDelta<=8,`Maximum alpha delta ${maxAlphaDelta} at ${scale}x`);
   assert.ok(totalAlphaDelta/Math.max(1,ink)<.001,'Raster lost visible ink compared with oversized reference');
   if(!layer.outline)assert.deepEqual(actual,expected);
  }
 });
}
