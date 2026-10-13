export type Mode='threshold'|'dither'|'halftone'|'duotone';
export interface Effects {
 mode:Mode;threshold:number;contrast:number;brightness:number;gamma:number;adaptive:number;
 grain:number;grainSize:number;grit:number;inkDensity:number;invert:boolean;
 ink:string;secondInk:string;dither:number;halftone:number;angle:number;
 blackPoint:number;whitePoint:number;denoise:number;sharpen:number;
 localRadius:number;localBias:number;localMethod:'mean'|'sauvola';
}
export interface Analysis {histogram:number[];coverage:number;autoThreshold:number;ms:number}
export interface Frame {width:number;height:number;rgba:Uint8ClampedArray}
export type Task =
 |{kind:'image';fx:Partial<Effects>;seed:number;analysisOnly?:boolean}
 |{kind:'paper';amount:number;seed:number}
 |{kind:'distress';amount:number;seed:number}
 |{kind:'stamp';color:string;polarity:'dark'|'light'};
export interface WorkRequest {id:number;sourceKey:string;width:number;height:number;bitmap?:ImageBitmap;task:Task}
export type WorkResponse={id:number;bitmap:ImageBitmap;analysis?:Analysis}|{id:number;error:string};
export interface Result {bitmap:ImageBitmap;analysis?:Analysis}
