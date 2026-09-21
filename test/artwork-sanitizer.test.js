import test from "node:test";
import assert from "node:assert/strict";
import { createSharpArtworkSanitizer } from "../src/artwork-sanitizer.js";

test("rotates, bounds and re-encodes one frame without preserving metadata", async () => {
  const calls=[]; const output=Uint8Array.from([1,2,3]);
  const chain={rotate(){calls.push("rotate");return this;},resize(v){calls.push(["resize",v]);return this;},png(v){calls.push(["png",v]);return this;},async toBuffer(v){calls.push(["toBuffer",v]);return {data:output,info:{width:128,height:128}};}};
  let inputOptions;
  const sanitizer=createSharpArtworkSanitizer({sharpFactory:(bytes,options)=>{inputOptions={bytes,options};return chain;}});
  const result=await sanitizer({contentType:"image/jpeg",bytes:Uint8Array.from([9]),width:500,height:500},{width:128,height:128});
  assert.deepEqual(inputOptions.options,{animated:false,failOn:"warning",limitInputPixels:16000000});
  assert.deepEqual(calls,["rotate",["resize",{width:128,height:128,fit:"cover",withoutEnlargement:true}],["png",{compressionLevel:9,quality:85,force:true}],["toBuffer",{resolveWithObject:true}]]);
  assert.deepEqual(result,{contentType:"image/png",bytes:output,width:128,height:128});
  assert.equal(Object.isFrozen(result),true);
});

test("validates rendition bounds and sharp output", async () => {
  const sanitizer=createSharpArtworkSanitizer({sharpFactory:()=>({rotate(){return this;},resize(){return this;},png(){return this;},async toBuffer(){return {data:Buffer.alloc(0),info:{}};}})});
  await assert.rejects(()=>sanitizer({bytes:Uint8Array.of(1)},{width:0,height:1}),/width/);
  await assert.rejects(()=>sanitizer({bytes:Uint8Array.of(1)},{width:1,height:1}),/output dimensions/);
});
