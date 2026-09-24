// GhostDeps device-code relay. Automation lanes mint GitHub CLI device-flow
// codes and push them here; Rowan's Tampermonkey script polls, auto-fills the
// device page, verifies the OAuth app is "GitHub CLI", and approves. The
// bearer key lives in the vault and in the DEVICE_RELAY_KEY env var only.

import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { RELAY_USERSCRIPT } from "./device-relay-userscript.js";
import { RELAY_PUSH_PAGE } from "./device-relay-page.js";
import { bearerToken, readJsonBody, sendJson } from "./http.js";

const REDIS_KEY = "ghostdeps:device-relay:v1:pending";
const ENTRY_TTL_MS = 15 * 60 * 1000;
const KEY_TTL_S = 20 * 60;
const MAX_PENDING = 10;
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function keyMatches(presented, expected) {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(String(presented)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function send(res, status, body, headers = {}) {
  sendJson(res, status, body, headers);
}

export function createRelayHandlers({ getRedis, relayKey, baseUrl, now = () => Date.now() }) {
  const configured = typeof relayKey === "string" && relayKey.length >= 16;

  async function readPending(redis) {
    const raw = await redis.command(["GET", REDIS_KEY]);
    if (!raw) return [];
    let entries;
    try { entries = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(entries)) return [];
    return entries.filter((e) => e && typeof e.id === "string" && now() - e.createdAt < ENTRY_TTL_MS);
  }

  async function writePending(redis, entries) {
    await redis.command(["SET", REDIS_KEY, JSON.stringify(entries.slice(0, MAX_PENDING)), "EX", String(KEY_TTL_S)]);
  }

  function authed(req) {
    return configured && keyMatches(bearerToken(req), relayKey);
  }

  return {
    async route(req, res) {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("script") === "1") return this.script(req, res);
      if (url.searchParams.get("push") === "1") return this.pushPage(req, res);
      if (url.searchParams.get("pending") === "1") return this.pending(req, res);
      if (url.searchParams.get("consume") === "1") return this.consume(req, res);
      if (req.method === "POST") return this.push(req, res);
      send(res, 404, { ok: false, error: "not_found" });
    },

    // Public: the userscript source. Contains no secrets; the relay key is
    // stored in Tampermonkey by Rowan at first run.
    script(req, res) {
      const source = RELAY_USERSCRIPT.replaceAll("__RELAY_BASE__", baseUrl).replaceAll("__RELAY_HOST__", new URL(baseUrl).host);
      res.statusCode = 200;
      res.setHeader("content-type", "text/javascript; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(source);
    },

    // Public page, useless without the key. Lanes open it in the cloud
    // browser and vault-fill the key.
    pushPage(req, res) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(RELAY_PUSH_PAGE.replaceAll("__CONFIGURED__", configured ? "" : " (SERVER NOT CONFIGURED: set DEVICE_RELAY_KEY)"));
    },

    async push(req, res) {
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });
      if (!configured) return send(res, 503, { ok: false, error: "relay_not_configured" });
      if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
      let body;
      try { body = await readJsonBody(req); } catch { return send(res, 400, { ok: false, error: "bad_json" }); }
      const code = String(body.code ?? "").toUpperCase().trim();
      if (!CODE_RE.test(code)) return send(res, 422, { ok: false, error: "bad_code_format", expected: "XXXX-XXXX" });
      const redis = getRedis();
      const entries = await readPending(redis);
      if (entries.length >= MAX_PENDING) return send(res, 409, { ok: false, error: "queue_full" });
      const entry = {
        id: randomBytes(8).toString("hex"),
        code,
        lane: String(body.lane ?? "unknown").slice(0, 80),
        scopes: String(body.scopes ?? "").slice(0, 200),
        repo: String(body.repo ?? "").slice(0, 200),
        createdAt: now(),
      };
      entries.push(entry);
      await writePending(redis, entries);
      send(res, 201, { ok: true, id: entry.id, expiresInSeconds: ENTRY_TTL_MS / 1000 });
    },

    async pending(req, res) {
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "method_not_allowed" });
      if (!configured) return send(res, 503, { ok: false, error: "relay_not_configured" });
      if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
      const entries = await readPending(getRedis());
      send(res, 200, { ok: true, pending: entries });
    },

    async consume(req, res) {
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });
      if (!configured) return send(res, 503, { ok: false, error: "relay_not_configured" });
      if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
      let body;
      try { body = await readJsonBody(req); } catch { return send(res, 400, { ok: false, error: "bad_json" }); }
      const id = String(body.id ?? "");
      const redis = getRedis();
      const entries = await readPending(redis);
      const kept = entries.filter((e) => e.id !== id);
      const consumed = kept.length !== entries.length;
      if (consumed) await writePending(redis, kept);
      send(res, 200, { ok: true, consumed });
    },
  };
}
