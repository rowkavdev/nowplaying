import test from "node:test";
import assert from "node:assert/strict";
import { sendCard, sendJson } from "../hosted/lib/http.js";

function fakeRes() {
  const headers = {};
  return { headers, statusCode: 0, setHeader(k, v) { headers[k.toLowerCase()] = v; }, end() {} };
}

test("hosted card and JSON responses tell browsers not to sniff the content type", () => {
  const card = fakeRes();
  sendCard({ method: "GET", headers: {} }, card, { state: "idle" }, { theme: "midnight-blue", width: 440, show: {} });
  assert.equal(card.headers["x-content-type-options"], "nosniff");
  const json = fakeRes();
  sendJson(json, 200, { ok: true });
  assert.equal(json.headers["x-content-type-options"], "nosniff");
});
