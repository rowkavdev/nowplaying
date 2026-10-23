import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const shutdown of [false, true]) test(shutdown
  ? "shutdown drains accepted settings saves before closing Discord"
  : "overlapping settings saves cannot restore a stopped Discord loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-settings-runtime-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "User" }, credentialStored: true }));
  const closing = deferred();
  const releaseClose = deferred();
  let handler;
  let closeCalls = 0;
  const transports = [];
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "fixture" }, fetchImpl: async () => Response.json([]),
    createServer: options => {
      handler = options.handler;
      return { listen: async () => ({ address: "127.0.0.1", family: "IPv4", port: 47832 }), close: async () => {} };
    },
    discord: { env: {}, builtInClientId: "123456789012345678", intervalMs: 3_600_000,
      createTransport: () => {
        const initial = transports.length === 0;
        const transport = { closed: false, connect: async () => {}, setActivity: async () => {}, clearActivity: async () => {},
          close: async () => {
            if (initial && ++closeCalls === 1) { closing.resolve(); await releaseClose.promise; }
            transport.closed = true;
          } };
        transports.push(transport);
        return transport;
      },
    },
  });
  const save = discord => handler({ url: "/api/settings", method: "PUT", body: JSON.stringify({ discord }), headers: {} });
  try {
    const older = save({ timestamps: "none" });
    await closing.promise;
    const newer = shutdown ? app.close() : save({ enabled: false });
    // Give the newer save time to enter while the old loop's close is pending.
    // The old implementation finishes it and then restores an enabled loop.
    await Promise.race([newer, new Promise(resolve => setTimeout(resolve, 100))]);
    releaseClose.resolve();
    assert.equal((await older).status, 200);
    if (shutdown) {
      await newer;
    } else {
      assert.equal((await newer).status, 200);
      assert.equal(app.discord, "off", "the final saved disabled state must remain applied");
    }
    assert.equal(transports.filter(transport => !transport.closed).length, 0, "no prior save may leave an orphan presence loop");
    if (shutdown) assert.equal((await save({ enabled: true })).status, 500, "closed apps reject further settings writes");
  } finally {
    releaseClose.resolve();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
