import test from "node:test";
import assert from "node:assert/strict";

import { parseAppConfig, startHostedFromConfig } from "../src/app-config.js";
import { createAppStatus } from "../src/app-status.js";
import { createSetupConfig, serializeSetupConfig } from "../src/setup-config.js";

const JELLYFIN = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };

test("hosted upload is absent from configs unless set, and off by default", () => {
  assert.equal("hosted" in createSetupConfig(JELLYFIN), false);
  assert.deepEqual({ ...createSetupConfig({ ...JELLYFIN, hostedEnabled: false }).hosted }, { enabled: false });
});

test("hosted settings round-trip through config.json", () => {
  const text = serializeSetupConfig({ ...JELLYFIN, hostedEnabled: true, hostedUrl: "https://cards.example.test/" });
  assert.deepEqual({ ...parseAppConfig(text).hosted }, { enabled: true, url: "https://cards.example.test" });
});

test("bad hosted settings make the config invalid", () => {
  const good = JSON.parse(serializeSetupConfig(JELLYFIN));
  for (const hosted of [{ enabled: "yes" }, { enabled: true, url: "http://cards.example.test" }, { enabled: true, token: "x" }, [], null]) {
    assert.throws(() => parseAppConfig(JSON.stringify({ ...good, hosted })), { startupCode: "CONFIG_INVALID" }, JSON.stringify(hosted));
  }
  assert.throws(() => createSetupConfig({ ...JELLYFIN, hostedEnabled: 1 }), TypeError);
});

test("hosted upload stays off when the config doesn't enable it", async () => {
  const hosted = startHostedFromConfig(createSetupConfig(JELLYFIN), { getPresence: async () => null });
  assert.equal(hosted.status, "off");
  assert.equal(await hosted.cardUrl(), null);
});

test("hosted upload needs a credential store", () => {
  const hosted = startHostedFromConfig(createSetupConfig({ ...JELLYFIN, hostedEnabled: true }), { getPresence: async () => null });
  assert.equal(hosted.status, "no_credentials");
});

test("hosted upload starts an uploader against the configured URL", async () => {
  let options;
  const pushed = [];
  const config = createSetupConfig({ ...JELLYFIN, hostedEnabled: true, hostedUrl: "https://cards.example.test" });
  const hosted = startHostedFromConfig(config, { getPresence: async () => ({ state: "playing" }) }, {
    credentials: { load: async () => null, save: async () => {}, clear: async () => {} },
    createUploader: (opts) => { options = opts; return { push: async (p) => { pushed.push(p); return { sent: true }; }, cardUrl: async () => "https://cards.example.test/card/x.svg", status: () => ({ state: "connected" }) }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await hosted.stop();
  assert.equal(hosted.status, "on");
  assert.equal(options.baseUrl, "https://cards.example.test");
  assert.equal(pushed.length, 1);
  assert.equal(await hosted.cardUrl(), "https://cards.example.test/card/x.svg");
  assert.deepEqual(hosted.connection(), { state: "connected" });
});

test("status page reports hosted upload state without secrets", () => {
  const status = createAppStatus({ config: createSetupConfig(JELLYFIN) });
  assert.deepEqual({ ...status.snapshot().hosted }, { enabled: false, state: "off", lastSuccessAt: null, error: null });
  status.setHosted(() => ({ enabled: true, state: "retrying", lastSuccessAt: 1_800_000_000_000, lastError: "network_error", token: "secret" }));
  const hosted = status.snapshot().hosted;
  assert.deepEqual({ ...hosted }, { enabled: true, state: "retrying", lastSuccessAt: new Date(1_800_000_000_000).toISOString(), error: "network_error" });
  assert.equal(JSON.stringify(status.snapshot()).includes("secret"), false);
});
