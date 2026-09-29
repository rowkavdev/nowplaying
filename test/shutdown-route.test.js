import test from "node:test";
import assert from "node:assert/strict";
import { createStatusPageHandler, SHUTDOWN_PATH } from "../src/status-page-handler.js";

const status = { snapshot: () => ({}), refresh: async () => {} };
const fallback = async () => undefined;

const post = (token) => ({
  method: "POST",
  url: SHUTDOWN_PATH,
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

test("a correct token is accepted and the quit fires after the reply (#780)", async () => {
  let requested = 0;
  const handle = createStatusPageHandler({ status, fallback, shutdown: { token: "t".repeat(64), request: async () => { requested += 1; } } });
  const result = await handle(post("t".repeat(64)));
  assert.equal(result.status, 202);
  assert.equal(requested, 0, "the reply goes out before the app quits");
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(requested, 1);
});

test("a wrong or missing token is refused and nothing quits", async () => {
  let requested = 0;
  const handle = createStatusPageHandler({ status, fallback, shutdown: { token: "t".repeat(64), request: async () => { requested += 1; } } });
  assert.equal((await handle(post("x".repeat(64)))).status, 401);
  assert.equal((await handle(post())).status, 401);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(requested, 0);
});

test("only POST is accepted on the shutdown path", async () => {
  const handle = createStatusPageHandler({ status, fallback, shutdown: { token: "t".repeat(64), request: async () => {} } });
  const result = await handle({ method: "GET", url: SHUTDOWN_PATH, headers: { authorization: `Bearer ${"t".repeat(64)}` } });
  assert.equal(result.status, 405);
});

test("without a shutdown configuration the path falls through like any unknown route", async () => {
  let fellThrough = 0;
  const handle = createStatusPageHandler({ status, fallback: async () => { fellThrough += 1; return undefined; } });
  const result = await handle(post("t".repeat(64)));
  assert.equal(result, undefined);
  assert.equal(fellThrough, 1);
});
