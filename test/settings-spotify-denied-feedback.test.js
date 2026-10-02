import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('Spotify OAuth denial explains that sign-in can be retried',async()=>{
 let feedback='',cleared=false,loaded=false;
 const context={spotifyFlow:'fixture-flow',spotifyGeneration:1,clearSpotifyLink(){cleared=true},say(id,text){assert.equal(id,'spotify-service-result');feedback=text},api:async()=>({status:'failed',error:'denied'}),async load(){loaded=true}};
 const start=SERVICE_SCRIPT.indexOf('async function pollSpotify('),end=SERVICE_SCRIPT.indexOf("$('spotify-remove').addEventListener",start);
 runInNewContext(SERVICE_SCRIPT.slice(start,end),context);await context.pollSpotify(1);
 assert.equal(feedback,'Spotify sign-in failed: Sign-in was not approved. Click Sign in with Spotify to try again.');
 assert.equal(context.spotifyFlow,null);assert.equal(cleared,true);assert.equal(loaded,false);
});
