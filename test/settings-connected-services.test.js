import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSettingsConnectedServices } from "../src/settings-connected-services.js";
import { createAppSettingsStore } from "../src/app-settings.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { createHostedDevicesClient } from "../src/hosted-devices.js";
import { createSettingsServers } from "../src/settings-servers.js";
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
  assert.deepEqual(writes, [{ ...b, baseUrl: "https://host-b.example" }]);
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


test("real concurrent hosted slow_down failure retains a committing owner (#808 review)", async () => {
  const file = await configFile();
  let clock = 0, releaseSave, enterSave, releasePoll, enterPoll, polls = 0;
  const saving = new Promise(resolve => { enterSave = resolve; });
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const polling = new Promise(resolve => { enterPoll = resolve; });
  const pollGate = new Promise(resolve => { releasePoll = resolve; });
  const svc = createSettingsConnectedServices({ file, elapsedNow: () => clock, credentialStore: { save: async () => {} },
    hostedCredentials: { load: async () => null, save: async () => { enterSave(); await saveGate; } },
    hostedSignIn: options => createHostedGitHubSignIn({ ...options, clientId: "fixture", now: () => clock }),
    fetchImpl: async url => {
      if (url.endsWith("/device/code")) return Response.json({ device_code: "fixture", user_code: "FIXTURE", verification_uri: "https://github.com/login/device", expires_in: 120, interval: 5 });
      if (url.endsWith("/access_token")) {
        if (++polls === 1) { enterPoll(); await pollGate; return Response.json({ error: "slow_down" }); }
        return Response.json({ access_token: "fixture" });
      }
      if (url.endsWith("/api/auth/github")) return Response.json({ login: "fixture", deviceId: "a".repeat(22), token: "a".repeat(24) });
      throw new Error(`unexpected fixture URL ${url}`);
    } });
  const req = body => svc.handler(post("/api/setup/hosted/signin", body));
  await req({ action: "start", url: "https://host-a.example" });
  clock = 5000; const old = req({ action: "poll" }); await polling;
  clock = 10000; const commit = req({ action: "poll" }); await saving;
  releasePoll(); await old;
  clock = 121000;
  assert.equal((await req({ action: "start", url: "https://host-b.example" })).status, 409);
  releaseSave();
  assert.equal(JSON.parse((await commit).body).status, "signed_in");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hosted, { enabled: true, url: "https://host-a.example" });
});


test("failed hosted durable save releases the owner for retry (#808 review)", async () => {
  const file = await configFile();
  const svc = createSettingsConnectedServices({ file, credentialStore: { save: async () => {} },
    hostedCredentials: { load: async () => null, save: async () => { throw new Error("fixture save failed"); } },
    hostedSignIn: ({ credentials }) => ({ start: async () => ({ status: "started", expiresIn: 120 }),
      poll: async () => { await credentials.save({ token: "fixture" }); return { status: "signed_in" }; } }) });
  const req = body => svc.handler(post("/api/setup/hosted/signin", body));
  await req({ action: "start", url: "https://host-a.example" });
  assert.equal((await req({ action: "poll" })).status, 500);
  assert.equal(JSON.parse((await req({ action: "start", url: "https://host-b.example" })).body).status, "started");
});

test('#817 disconnect removes staged first-run Spotify credential and reports failure honestly', async () => {
  for (const succeeds of [true, false]) {
    const file = await configFile(false); let finish; const removed = [];
    const svc = createSettingsConnectedServices({ file,
      credentialStore: { read: async () => null, save: async () => {}, remove: async ref => { removed.push(ref); return succeeds; } },
      spotifySignIn: ({ openUrl }) => new Promise(resolve => { finish = resolve; openUrl('https://accounts.spotify.com/authorize'); }) });
    const started = await svc.handler(post('/api/setup/spotify', { action: 'start', clientId: CID }));
    finish({ refreshToken: 'fixture', identity: { id: 'staged', displayName: 'Staged' } });
    await waitForSpotify(svc.handler, JSON.parse(started.body).flowId);
    const result = await svc.handler(post('/api/settings/services', { action: 'remove-spotify' }));
    assert.deepEqual(removed, [{ provider: 'spotify', identityId: 'staged' }]);
    assert.equal(JSON.parse(result.body).tokenRemoved, succeeds);
    assert.equal(JSON.parse((await svc.handler({ url: '/api/settings/services' })).body).spotify, null);
  }
});


test('#831 disconnect cannot race a staged snapshot in the first-server transaction', async () => {
  const file = await configFile(false);
  const values = new Map();
  const key = ref => `${ref.provider}:${ref.identityId}`;
  const credentialStore = { read: async ref => values.get(key(ref)) ?? null,
    save: async (ref, secret) => values.set(key(ref), secret), remove: async ref => values.delete(key(ref)) };
  let finish, release, captured;
  const gate = new Promise(resolve => { release = resolve; });
  const snapshot = new Promise(resolve => { captured = resolve; });
  const svc = createSettingsConnectedServices({ file, credentialStore,
    spotifySignIn: ({ openUrl }) => new Promise(resolve => { finish = resolve; openUrl('https://accounts.spotify.com/authorize'); }) });
  const started = await svc.handler(post('/api/setup/spotify', { action: 'start', clientId: CID }));
  finish({ refreshToken: 'spotify-token', identity: { id: 'spotify', displayName: 'Spotify' } });
  await waitForSpotify(svc.handler, JSON.parse(started.body).flowId);
  const mgmt = createSettingsServers({ file, credentialStore, deviceId: 'first-server-fixture', fileQueue: svc.serial,
    prepareConfig: async existing => { const prepared = svc.prepareFirstServer(existing); captured(); await gate; return prepared; },
    signIn: { signInNavidrome: async () => ({ provider: 'navidrome', identity: { id: 'server', displayName: 'Server' }, secret: 'server-token' }) } });
  const commit = mgmt.handler(post('/api/setup/signin', { action: 'password', provider: 'navidrome', baseUrl: 'http://127.0.0.1:4533', username: 'server', password: 'pw' }));
  await snapshot;
  let disconnected = false;
  const removal = svc.handler(post('/api/settings/services', { action: 'remove-spotify' })).then(response => { disconnected = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  // Always release the held commit even when the pre-fix assertion fails.
  const early = disconnected;
  release();
  const [signedIn, removed] = await Promise.all([commit, removal]);
  assert.equal(early, false, 'disconnect must wait for the first-server commit');
  assert.equal(signedIn.status, 200);
  assert.deepEqual(JSON.parse(removed.body), { removed: true, tokenRemoved: true });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).spotify, undefined);
  assert.equal(values.has('spotify:spotify'), false);
  assert.equal(values.get('navidrome:server'), 'server-token');
});


test('#834 failed destination rename keeps B credentials off A and permits config-only retry', async () => {
  const file = await configFile();
  const a = 'https://host-a.example', b = 'https://host-b.example';
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.hosted = { enabled: true, url: a };
  await writeFile(file, JSON.stringify(config));
  let raw = null, failRename = true, clock = 0;
  const credentials = createHostedCredentials({ adapter: { getPassword: async () => raw,
    setPassword: async (_service, _account, value) => { raw = value; }, deletePassword: async () => { raw = null; } } });
  await credentials.save({ login: 'host-a', deviceId: 'a'.repeat(22), token: 'a'.repeat(24), baseUrl: a });
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/device/code')) return Response.json({ device_code: 'dc', user_code: 'CODE', verification_uri: 'https://github.com/login/device', expires_in: 120, interval: 5 });
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'fixture-github-token' });
    if (url === b + '/api/auth/github') return Response.json({ login: 'host-b', deviceId: 'b'.repeat(22), token: 'b'.repeat(24) });
    if (url.endsWith('/api/ingest')) return Response.json({});
    throw new Error('unexpected fixture request');
  };
  const settingsStore = createAppSettingsStore({ file, renameRetryDelaysMs: [], renameFile: async (...args) => {
    if (failRename) throw Object.assign(new Error('fixture rename failure'), { code: 'EACCES' });
    const { rename } = await import('node:fs/promises'); return rename(...args);
  } });
  const svc = createSettingsConnectedServices({ file, settingsStore, credentialStore: { save: async () => {} }, hostedCredentials: credentials,
    fetchImpl, elapsedNow: () => clock, hostedSignIn: options => createHostedGitHubSignIn({ ...options, clientId: 'fixture', now: () => clock }) });
  await svc.handler(post('/api/setup/hosted/signin', { action: 'start', url: b }));
  clock = 5000;
  assert.equal((await svc.handler(post('/api/setup/hosted/signin', { action: 'poll' }))).status, 500);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).hosted.url, a);
  const up = createHostedUploader({ baseUrl: a, credentials, fetchImpl });
  const result = await up.push(createPresence({ state: 'playing', kind: 'track', title: 'Fixture' }));
  assert.equal(result.sent, false);
  assert.equal(requests.filter(r => r.url === a + '/api/ingest').length, 0);
  assert.equal((await credentials.load()).baseUrl, b);
  assert.equal((await createHostedDevicesClient({ baseUrl: a, credentials, fetchImpl }).run()).signedIn, false);
  const registrationRequest = requests.find(r => r.url === b + '/api/auth/github');
  assert.equal(registrationRequest.body.previousToken, undefined, 'A token must not be handed to B for replacement');
  failRename = false;
  const retried = await svc.handler(post('/api/setup/hosted/signin', { action: 'poll' }));
  assert.equal(JSON.parse(retried.body).status, 'signed_in');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).hosted.url, b);
  assert.equal(requests.filter(r => r.url === b + '/api/auth/github').length, 1);
  assert.equal((await createHostedUploader({ baseUrl: b, credentials, fetchImpl }).push(createPresence({ state: 'playing', kind: 'track', title: 'Fixture' }))).sent, true);
  assert.deepEqual(requests.filter(r => r.auth), [{ url: b + '/api/ingest', auth: 'Bearer ' + 'b'.repeat(24), body: requests.find(r => r.url === b + '/api/ingest').body }]);
});

test("a hosted sign-in body of null is a 400, not an exception", async () => {
  const file = await configFile();
  const h = createSettingsConnectedServices({ file, credentialStore: { read: async () => null, save: async () => {}, remove: async () => {} }, hostedSignIn: async () => ({}), spotifySignIn: async () => ({}) }).handler;
  for (const body of ["null", "7", '"x"', "[]", "{"]) {
    const response = await h({ url: "/api/setup/hosted/signin", method: "POST", body, headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(response.status, 400, body);
    assert.equal(JSON.parse(response.body).error, "invalid_request", body);
  }
});
