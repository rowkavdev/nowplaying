import test from "node:test";
import assert from "node:assert/strict";
import { discoverLanServers } from "../src/setup-lan-discovery.js";

for (const stage of ["bind", "send"]) {
  test(`LAN discovery times out when ${stage} never calls back`, async () => {
    const sockets = [];
    const socketFactory = () => {
      const socket = {
        closed: false,
        on() {},
        bind(_port, callback) { if (stage !== "bind") callback(); },
        setBroadcast() {},
        send() {},
        close() { this.closed = true; },
      };
      sockets.push(socket);
      return socket;
    };
    let timer;
    try {
      const result = await Promise.race([
        discoverLanServers({ timeoutMs: 20, socketFactory }),
        new Promise((resolve) => { timer = setTimeout(() => resolve("hung"), 200); }),
      ]);
      assert.deepEqual(result, []);
      assert.equal(sockets.length, 2);
      assert.ok(sockets.every((socket) => socket.closed));
    } finally { clearTimeout(timer); }
  });
}
