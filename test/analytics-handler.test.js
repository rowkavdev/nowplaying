import test from "node:test";
import assert from "node:assert/strict";
import { createAnalyticsHandler } from "../src/analytics-handler.js";

const token = "a-private-stats-token-123456";

test("keeps aggregate stats behind constant-time bearer auth", async () => {
  const store = { stats: async () => ({ users: 2, cardsGenerated: 7 }), recordDiscord: async () => {} };
  const handler = createAnalyticsHandler({ store, statsToken: token });
  assert.equal((await handler({ url: "/stats" })).status, 401);
  const response = await handler({ url: "/stats", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(response.body), { users: 2, cardsGenerated: 7 });
});

test("accepts only bounded anonymous Discord installation pings", async () => {
  const seen = [];
  const handler = createAnalyticsHandler({ store: { stats: async () => ({}), recordDiscord: async (id) => { if (id.length < 16) throw new Error(); seen.push(id); } }, statsToken: token });
  assert.equal((await handler({ method: "POST", url: "/analytics/discord", headers: { "X-Nowplaying-Installation": "anonymous-install-01" } })).status, 204);
  assert.deepEqual(seen, ["anonymous-install-01"]);
  assert.equal((await handler({ method: "POST", url: "/analytics/discord", headers: { "X-Nowplaying-Installation": "short" } })).status, 400);
  assert.equal(await handler({ url: "/other" }), null);
});
