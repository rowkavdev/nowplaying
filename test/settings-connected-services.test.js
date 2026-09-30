import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSettingsConnectedServices } from "../src/settings-connected-services.js";
import { createPresence } from "../src/presence.js";
import { createHostedGitHubSignIn } from "../src/hosted-signin.js";
import { createHostedUploader } from "../src/hosted-uploader.js";
import { serializeSetupConfig } from "../src/setup-config.js";
const CID = "0123456789abcdef0123456789abcdef";
const post = (url, body) => ({ url, method: "POST", body: JSON.stringify(body), headers: { "sec-fetch-site": "same-origin" } });
const configFile = async (installed = true) => { const file = join(await mkdtemp(join(tmpdir(), "np-services-")), "config.json"); if (installed) await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true })); return file; };
async function waitForSpotify(svc, flowId) {
  const deadline = Date.now() + 5000;
  while (true) {
    const response = await svc(post("/api/setup/spotify", { action: "poll", flowId }));
    const result = JSON.parse(response.body);
    if (result.status !== "pending") { assert.equal(result.status, "signed_in"); return result; }
    if (Date.now() >= deadline) assert.fail("Spotify sign-in did not complete within 5 seconds");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}


test("Spotify WebUI flow saves identity not token, and disconnects/revokes", async () => {
  const file = await configFile(); const saved = []; const removed = []; let finish;
  const h = createSettingsConnectedServices({ file, credentialStore: { read: async () => null, save: async (...x) => saved.push(x), remove: async (ref) => removed.push(ref) },
    spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }) }).handler;
  const started = await h(post("/api/setup/spotify", { action: "start", clientId: CID }));
  assert.equal(started.status, 200);
  const flowId = JSON.parse(started.body).flowId;
  finish({ refreshToken: "super-secret", identity: { id: "rowan", displayName: "Rowan" } });
  await waitForSpotify(h, flowId);
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
  const svc = createSettingsConnectedServices({ file, credentialStore: { read: async () => null, remove: async () => {}, save: async (...x)=>saved.push(x) }, spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }) });
  const started = await svc.handler(post("/api/setup/spotify", { action: "start", clientId: CID }));
  finish({ refreshToken: "secret", identity: { id: "rowan", displayName: "Rowan" } });
  await waitForSpotify(svc.handler, JSON.parse(started.body).flowId);
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

test("abandoned hosted sign-in expires and allows a new start without restarting", async () => {
  const file = await configFile(); let clock = 1000, starts = 0;
  const svc = createSettingsConnectedServices({ file, elapsedNow: () => clock, credentialStore: { save: async () => {} }, hostedCredentials: { load: async () => null, save: async () => {} },
    hostedSignIn: () => ({ start: async () => { starts++; return { status: "started", expiresIn: 120, interval: 5 }; }, poll: async () => ({ status: "pending" }) }),
  });
  const start = () => svc.handler(post("/api/setup/hosted/signin", { action: "start", url: "https://cards.example" }));
  assert.equal((await start()).status, 200);
  clock += 119_000;
  assert.equal((await start()).status, 409, "active flow must remain guarded");
  assert.equal((await svc.handler(post("/api/setup/hosted/signin", { action: "poll" }))).status, 200);
  clock += 1000;
  assert.equal(JSON.parse((await start()).body).status, "started", "expired flow can be replaced without a poll");
  assert.equal(starts, 2);
  assert.equal((await start()).status, 409, "replacement flow is guarded again");
});

test("hosted preview/check are available on first run and reflect privacy", async () => {
  const file=await configFile(false);const seen=[];
  const svc=createSettingsConnectedServices({file,credentialStore:{save:async()=>{}},hostedCredentials:{load:async()=>null,save:async()=>{}},fetchImpl:async(url,opts)=>{seen.push({url,opts});return{status:200,headers:{get:(n)=>n==="content-length"?"2":null},text:async()=>"ok"};}});
  const preview=await svc.handler({url:"/api/setup/hosted/preview"});
  assert.equal(preview.status,200);
  assert.ok(JSON.parse(preview.body).sent.length);
  const check=await svc.handler(post("/api/setup/hosted/check",{url:"https://cards.example"}));
  assert.equal(JSON.parse(check.body).ok,true);
  assert.deepEqual(seen.map(x=>x.url),["https://cards.example/healthz"]);
  assert.equal(seen[0].opts.redirect,"error");
  assert.equal((await svc.handler({url:"/api/settings/services",headers:{"sec-fetch-site":"cross-site"}})).status,403);
});


test("Spotify completes without restarting before the browser receives success", async () => {
  const file = await configFile(); let finish; let restartCount = 0;
  const svc = createSettingsConnectedServices({ file, credentialStore: { read: async () => null, remove: async () => {}, save: async () => {} }, onConfigured: async () => { restartCount++; },
    spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }) });
  const started = await svc.handler(post("/api/setup/spotify", { action: "start", clientId: CID }));
  const flowId = JSON.parse(started.body).flowId;
  finish({ refreshToken: "secret", identity: { id: "rowan", displayName: "Rowan" } });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(restartCount, 0, "must stay alive past the old 500ms restart window");
  assert.equal(JSON.parse((await svc.handler(post("/api/setup/spotify", { action: "poll", flowId }))).body).status, "signed_in");
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(restartCount, 1, "restart only once the result was delivered");
});


test("Spotify disconnect reports OS keychain removal failure without keeping config reference", async () => {
  const file=await configFile();
  const svc=createSettingsConnectedServices({file,credentialStore:{save:async()=>{},remove:async()=>{throw new Error("keychain unavailable");}},spotifySignIn:()=>Promise.resolve(null)});
  await writeFile(file, serializeSetupConfig({provider:"jellyfin",serverUrl:"http://127.0.0.1:8096",identity:{id:"u1",displayName:"R"},credentialStored:true,spotify:{clientId:CID,identity:{id:"rowan",displayName:"Rowan"}}}));
  const result=await svc.handler(post("/api/settings/services",{action:"remove-spotify"}));
  assert.deepEqual(JSON.parse(result.body),{removed:true,tokenRemoved:false});
  assert.equal(JSON.parse(await readFile(file,"utf8")).spotify,undefined);
});

test("Spotify Disconnect invalidates a pending sign-in before it can reconnect", async () => {
  const file = await configFile();
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true,
    spotify: { clientId: CID, identity: { id: "rowan", displayName: "Rowan" } } }));
  let finish;
  const writes = [];
  const svc = createSettingsConnectedServices({ file,
    credentialStore: { read: async () => null, save: async (...args) => { writes.push(["save", ...args]); }, remove: async (...args) => { writes.push(["remove", ...args]); return true; } },
    spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }),
  });
  const started = await svc.handler(post("/api/setup/spotify", { action: "start", clientId: CID }));
  const flowId = JSON.parse(started.body).flowId;
  const disconnected = await svc.handler(post("/api/settings/services", { action: "remove-spotify" }));
  assert.equal(disconnected.status, 200);
  finish({ refreshToken: "new-secret", identity: { id: "rowan", displayName: "Rowan" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await svc.handler(post("/api/setup/spotify", { action: "poll", flowId }))).status, 410);
  assert.equal(JSON.parse(await readFile(file, "utf8")).spotify, undefined);
  assert.deepEqual(writes.map(([action]) => action), ["remove"]);
});

test("Spotify Disconnect waits for a draft write already in flight", async () => {
  const file = await configFile();
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true,
    spotify: { clientId: CID, identity: { id: "rowan", displayName: "Rowan" } } }));
  let finish, releaseUpdate, updateStarted;
  const startedUpdate = new Promise((resolve) => { updateStarted = resolve; });
  const writes = [];
  const settingsStore = { updateSpotify: async (account) => {
    if (account) { updateStarted(); await new Promise((resolve) => { releaseUpdate = resolve; }); }
    const config = JSON.parse(await readFile(file, "utf8"));
    if (account) config.spotify = account; else delete config.spotify;
    await writeFile(file, JSON.stringify(config));
  } };
  const svc = createSettingsConnectedServices({ file, settingsStore,
    credentialStore: { read: async () => null, save: async (...args) => { writes.push(["save", ...args]); }, remove: async (...args) => { writes.push(["remove", ...args]); return true; } },
    spotifySignIn: ({ openUrl }) => new Promise((resolve) => { finish = resolve; openUrl("https://accounts.spotify.com/authorize"); }),
  });
  await svc.handler(post("/api/setup/spotify", { action: "start", clientId: CID }));
  finish({ refreshToken: "new-secret", identity: { id: "rowan", displayName: "Rowan" } });
  await startedUpdate;
  let disconnected = false;
  const pending = svc.handler(post("/api/settings/services", { action: "remove-spotify" })).then(() => { disconnected = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disconnected, false);
  releaseUpdate();
  await pending;
  assert.equal(JSON.parse(await readFile(file, "utf8")).spotify, undefined);
  assert.deepEqual(writes.map(([action]) => action), ["save", "remove"]);
});

test("abandoned hosted sign-in can restart after its real lifetime across a wall-clock correction (#741)", async () => {
  const file = await configFile();
  let wall = 1_800_000_000_000, elapsed = 1_800_000_000_000, starts = 0;
  const svc = createSettingsConnectedServices({
    file, elapsedNow: () => elapsed,
    credentialStore: { save: async () => {} },
    hostedCredentials: { load: async () => null },
    hostedSignIn: () => ({ start: async () => { starts += 1; return { status: "started", expiresIn: 120, interval: 5 }; }, poll: async () => ({ status: "pending" }) }),
  });
  const startReq = { method: "POST", url: "/api/setup/hosted/signin", headers: {}, body: JSON.stringify({ action: "start", url: "https://cards.example" }) };
  assert.equal((await svc.handler(startReq)).status, 200);
  wall -= 3_600_000; elapsed += 180_000; // wall clock jumps back an hour; three elapsed minutes pass (> 120s code lifetime)
  assert.equal((await svc.handler(startReq)).status, 200);
  assert.equal(starts, 2);
});


test("superseded hosted auth cannot save A credentials, enable B or clear B guard (#808)", async () => {
  const file = await configFile();
  let clock = 0, saved = null, releaseA, enteredA;
  const reachedA = new Promise(resolve => { enteredA = resolve; });
  const heldA = new Promise(resolve => { releaseA = resolve; });
  const a = { login: "host-a", deviceId: "a".repeat(22), token: "a".repeat(24) };
  const b = { login: "host-b", deviceId: "b".repeat(22), token: "b".repeat(24) };
  const writes = [], uploads = [];
  const credentials = { load: async () => saved, save: async value => { writes.push(value); saved = value; }, clear: async () => { saved = null; } };
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/device/code")) return Response.json({ device_code: "fixture", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 120, interval: 5 });
    if (url.endsWith("/access_token")) return Response.json({ access_token: "fixture-github-token" });
    if (url === "https://host-a.example/api/auth/github") { enteredA(); await heldA; return Response.json(a); }
    if (url === "https://host-b.example/api/auth/github") return Response.json(b);
    if (url.endsWith("/api/ingest")) { uploads.push({ url, token: init.headers.authorization }); return Response.json({}); }
    throw new Error(`unexpected fixture request ${url}`);
  };
  const svc = createSettingsConnectedServices({ file, credentialStore: { save: async () => {} }, hostedCredentials: credentials,
    elapsedNow: () => clock, fetchImpl, hostedSignIn: options => createHostedGitHubSignIn({ ...options, clientId: "fixture", now: () => clock }) });
  const start = url => svc.handler(post("/api/setup/hosted/signin", { action: "start", url }));
  const poll = () => svc.handler(post("/api/setup/hosted/signin", { action: "poll" }));
  await start("https://host-a.example");
  clock = 119_000;
  const old = poll();
  await reachedA;
  clock = 121_000;
  assert.equal(JSON.parse((await start("https://host-b.example")).body).status, "started");
  releaseA(); await old;
  assert.deepEqual(writes, [], "superseded auth must not persist credentials");
  assert.equal(JSON.parse(await readFile(file, "utf8")).hosted?.enabled === true, false, "old completion must not enable B");
  assert.equal((await start("https://host-c.example")).status, 409, "old completion must not clear B guard");
  clock += 5000;
  assert.equal(JSON.parse((await poll()).body).status, "signed_in");
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(config.hosted, { enabled: true, url: "https://host-b.example" });
  assert.deepEqual(writes, [b]);
  const uploader = createHostedUploader({ baseUrl: config.hosted.url, credentials, fetchImpl });
  await uploader.push(createPresence({ state: "playing", kind: "track", title: "Fixture" }));
  assert.deepEqual(uploads, [{ url: "https://host-b.example/api/ingest", token: `Bearer ${b.token}` }]);
});


test("hosted credential commit keeps its destination owner through code expiry (#808)", async () => {
  const file = await configFile();
  let clock = 0, enter, release;
  const saving = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const svc = createSettingsConnectedServices({ file, elapsedNow: () => clock, credentialStore: { save: async () => {} },
    hostedCredentials: { load: async () => null, save: async () => { enter(); await gate; } },
    hostedSignIn: ({ credentials }) => ({ start: async () => ({ status: "started", expiresIn: 120 }),
      poll: async () => { await credentials.save({ token: "fixture" }); return { status: "signed_in" }; } }) });
  const start = url => svc.handler(post("/api/setup/hosted/signin", { action: "start", url }));
  const poll = () => svc.handler(post("/api/setup/hosted/signin", { action: "poll" }));
  await start("https://host-a.example");
  const finishing = poll(); await saving;
  clock = 121_000;
  assert.equal(JSON.parse((await poll()).body).status, "pending", "a second poll cannot release the commit owner");
  assert.equal((await start("https://host-b.example")).status, 409);
  release(); await finishing;
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hosted, { enabled: true, url: "https://host-a.example" });
});
