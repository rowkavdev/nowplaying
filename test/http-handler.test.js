import test from "node:test";
import assert from "node:assert/strict";
import { createCardHandler } from "../src/http-handler.js";
const svg='<svg xmlns="http://www.w3.org/2000/svg"></svg>';

test("serves GET and HEAD card responses with safe headers", async()=>{const h=createCardHandler({resolveCard:async()=>svg});const get=await h({method:"GET",url:"/card.svg"});assert.equal(get.status,200);assert.equal(get.body,svg);assert.equal(get.headers["Content-Type"],"image/svg+xml; charset=utf-8");assert.equal(get.headers["Cache-Control"],"no-store");assert.equal((await h({method:"HEAD",url:"/card.svg"})).body,"");});
test("serves health and rejects routes or methods",async()=>{const h=createCardHandler({resolveCard:async()=>svg});assert.deepEqual(await h({url:"/healthz"}),{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"},body:"ok\n"});assert.equal((await h({url:"/missing"})).status,404);const post=await h({method:"POST",url:"/card.svg"});assert.equal(post.status,405);assert.equal(post.headers.Allow,"GET, HEAD");});
test("sanitizes resolver failures and malformed output",async()=>{for(const resolveCard of [async()=>{throw new Error("token=secret")},async()=>"not svg"]){const r=await createCardHandler({resolveCard})({url:"/card.svg"});assert.deepEqual(r,{status:503,headers:{},body:"Card unavailable"});}});
