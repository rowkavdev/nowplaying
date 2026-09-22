import test from "node:test";
import assert from "node:assert/strict";
import { createCredentialStore } from "../src/credential-store.js";

function fakeAdapter() {
  const values = new Map();
  return {
    calls: [],
    async setPassword(service, account, secret) {
      this.calls.push(["set", service, account, secret]);
      values.set(`${service}:${account}`, secret);
    },
    async getPassword(service, account) {
      this.calls.push(["get", service, account]);
      return values.get(`${service}:${account}`) ?? null;
    },
    async deletePassword(service, account) {
      this.calls.push(["delete", service, account]);
      return values.delete(`${service}:${account}`);
    },
  };
}

test("stores credentials under a provider and stable identity target", async () => {
  const adapter = fakeAdapter();
  const store = createCredentialStore({ adapter });

  const result = await store.save({ provider: "plex", identityId: " user-42 " }, "secret-token");

  assert.deepEqual(result, { provider: "plex", identityId: "user-42", stored: true });
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
  assert.deepEqual(adapter.calls[0], ["set", "nowplaying", "plex:user-42", "secret-token"]);
  assert.equal(await store.read({ provider: "plex", identityId: "user-42" }), "secret-token");
});

test("keeps providers and users in separate OS credential targets", async () => {
  const adapter = fakeAdapter();
  const store = createCredentialStore({ adapter });
  await store.save({ provider: "jellyfin", identityId: "user-1" }, "first");
  await store.save({ provider: "emby", identityId: "user-1" }, "second");

  assert.equal(await store.read({ provider: "jellyfin", identityId: "user-1" }), "first");
  assert.equal(await store.read({ provider: "emby", identityId: "user-1" }), "second");
  assert.equal(await store.remove({ provider: "jellyfin", identityId: "user-1" }), true);
  assert.equal(await store.read({ provider: "jellyfin", identityId: "user-1" }), null);
});

test("requires an OS-backed adapter contract", () => {
  assert.throws(() => createCredentialStore(), /adapter.setPassword is required/);
  assert.throws(() => createCredentialStore({ adapter: { setPassword() {} } }), /adapter.getPassword is required/);
});

test("rejects unsupported targets and empty secrets", async () => {
  const store = createCredentialStore({ adapter: fakeAdapter() });
  await assert.rejects(store.save({ provider: "other", identityId: "user" }, "secret"), /provider is invalid/);
  await assert.rejects(store.save({ provider: "plex", identityId: "" }, "secret"), /identityId is required/);
  await assert.rejects(store.save({ provider: "plex", identityId: "user" }, ""), /secret is required/);
});
