import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSettingsConnectedServices } from "../src/settings-connected-services.js";
import { serializeSetupConfig } from "../src/setup-config.js";
const CID = "0123456789abcdef0123456789abcdef";
const post = (url, body) => ({ url, method: "POST", body: JSON.stringify(body), headers: { "sec-fetch-site": "same-origin" } });
const configFile = async (installed = true) => { const file = join(await mkdtemp(join(tmpdir(), "np-services-")), "config.json"); if (installed) await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true })); return file; };

test("Spotify WebUI flow saves identity not token, and disconnects/revokes", async () => {
  const file = await configFile(); const saved = []; const removed = []; let finish;
  const h = createSettingsConnectedServices({ file, credentialStore: { save: async (...x) => saved.push(x), remove: async (ref) => removed.push(ref) },
    spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }) }).handler;
  const started = await h(post("/api/setup/spotify", { action: "start", clientId: CID }));
  assert.equal(started.status, 200);
  const flowId = JSON.parse(started.body).flowId;
  finish({ refreshToken: "super-secret", identity: { id: "rowan", displayName: "Rowan" } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(JSON.parse((await h(post("/api/setup/spotify", { action: "poll", flowId }))).body).status, "signed_in");
  const data = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(data.spotify.identity, { id: "rowan", displayName: "Rowan" });
  assert.doesNotMatch(JSON.stringify(data), /super-secret/);
  assert.equal(saved[0][1], "super-secret");
  assert.equal((await h(post("/api/settings/services", { action: "remove-spotify" }))).status, 200);
  assert.deepEqual(removed[0], { provider: "spotify", identityId: "rowan" });
  assert.equal(JSON.parse(await readFile(file, "utf8")).spotify, undefined);
});

test("first-run optional accounts stage until media server config exists", async () => {
  const file = await configFile(false); let finish; const saved=[];
  const svc = createSettingsConnectedServices({ file, credentialStore: { save: async (...x)=>saved.push(x) }, spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }) });
  const started = await svc.handler(post("/api/setup/spotify", { action: "start", clientId: CID }));
  finish({ refreshToken: "secret", identity: { id: "rowan", displayName: "Rowan" } }); await new Promise((r)=>setTimeout(r, 30));
  assert.equal(JSON.parse((await svc.handler(post("/api/setup/spotify", { action: "poll", flowId: JSON.parse(started.body).flowId }))).body).status, "signed_in");
  assert.equal(JSON.parse((await svc.handler({ url: "/api/settings/services" })).body).spotify.name, "Rowan");
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true }));
  await svc.afterFirstServer();
  assert.equal(JSON.parse(await readFile(file,"utf8")).spotify.identity.id, "rowan");
});

test("hosted device sign-in retains selected URL and enables upload", async () => {
  const file=await configFile();const key={login:"rowan",deviceId:"a".repeat(22),token:"b".repeat(24)};let signed;
  const creds={load:async()=>signed??null,save:async (v)=>{signed=v;}};
  const svc=createSettingsConnectedServices({file,credentialStore:{save:async()=>{}},hostedCredentials:creds,hostedSignIn:({baseUrl,credentials})=>({
    start:async()=>({status:"started",userCode:"ABCD-EFGH",verificationUri:"https://github.com/login/device",interval:5}),
    poll:async()=>{await credentials.save(key);return{status:"signed_in",login:key.login,cardUrl:`${baseUrl}/u/rowan.svg`};},
  })});
  const started=await svc.handler(post("/api/setup/hosted/signin",{action:"start",url:"https://cards.example"}));
  assert.equal(JSON.parse(started.body).status,"started");
  const done=await svc.handler(post("/api/setup/hosted/signin",{action:"poll"}));
  assert.equal(JSON.parse(done.body).status,"signed_in");
  const config=JSON.parse(await readFile(file,"utf8"));
  assert.deepEqual(config.hosted,{enabled:true,url:"https://cards.example"});
  assert.doesNotMatch(JSON.stringify(config),/b{24}/);
  assert.equal(JSON.parse((await svc.handler({url:"/api/settings/services"})).body).hosted.login,"rowan");
});

test("hosted preview/check are available on first run and reflect privacy", async () => {
  const file=await configFile(false);const seen=[];
  const svc=createSettingsConnectedServices({file,credentialStore:{save:async()=>{}},hostedCredentials:{load:async()=>null,save:async()=>{}},fetchImpl:async(url,opts)=>{seen.push({url,opts});return{status:200,text:async()=>"ok"};}});
  const preview=await svc.handler({url:"/api/setup/hosted/preview"});
  assert.equal(preview.status,200);
  assert.ok(JSON.parse(preview.body).sent.length);
  const check=await svc.handler(post("/api/setup/hosted/check",{url:"https://cards.example"}));
  assert.equal(JSON.parse(check.body).ok,true);
  assert.deepEqual(seen.map(x=>x.url),["https://cards.example/healthz"]);
  assert.equal(seen[0].opts.redirect,"error");
  assert.equal((await svc.handler({url:"/api/settings/services",headers:{"sec-fetch-site":"cross-site"}})).status,403);
});
