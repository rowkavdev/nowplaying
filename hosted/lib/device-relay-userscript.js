// The Tampermonkey userscript served by the device relay. Placeholders are
// replaced server-side at serve time. No secrets in this file: Rowan stores
// the relay key via the Tampermonkey menu on first run.
export const RELAY_USERSCRIPT = `// ==UserScript==
// @name         GhostDeps device relay
// @namespace    https://github.com/rowkavdev/ghostdeps
// @version      0.1.0
// @description  Auto-approves GitHub CLI device-flow codes pushed by Rowan's automation lanes. Only ever approves the "GitHub CLI" OAuth app.
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      __RELAY_HOST__
// @updateURL    __RELAY_BASE__/ghostdeps-device-relay.user.js
// @downloadURL  __RELAY_BASE__/ghostdeps-device-relay.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const BASE = "__RELAY_BASE__";
  const POLL_VISIBLE_MS = 10000;
  const POLL_HIDDEN_MS = 45000;
  const JOB_MAX_AGE_MS = 15 * 60 * 1000;

  const log = (...a) => console.log("[ghostdeps-relay]", ...a);
  const getKey = () => GM_getValue("relayKey", "");
  const getJob = () => GM_getValue("activeJob", null);
  const setJob = (j) => GM_setValue("activeJob", j);

  GM_registerMenuCommand("Set GhostDeps relay key", () => {
    const k = prompt("Paste the GhostDeps relay key (from your vault):", getKey());
    if (k !== null) { GM_setValue("relayKey", k.trim()); GM_setValue("keyRejected", false); log("key saved"); }
  });

  function xhr(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url: BASE + path,
        headers: { authorization: "Bearer " + getKey(), "content-type": "application/json" },
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => resolve({ status: r.status, json: safeJson(r.responseText) }),
        onerror: reject, ontimeout: reject,
      });
    });
  }
  const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

  function banner(text, color) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px 16px;font:14px ui-monospace,monospace;text-align:center;color:#fff;background:" + color;
    document.body.appendChild(el);
  }

  function abortJob(job, reason) {
    GM_setValue("skip:" + job.id, true);
    setJob(null);
    const msg = "GhostDeps relay ABORTED code " + job.code + " (" + job.lane + "): " + reason + ". Not approved, no action taken.";
    banner(msg, "#b62324");
    GM_notification({ title: "GhostDeps relay aborted", text: msg, timeout: 0 });
    log("abort:", reason);
  }

  async function consume(job) {
    setJob(null);
    const r = await xhr("POST", "/api/device-relay?consume=1", { id: job.id });
    log("consume", job.id, r.status);
    banner("GhostDeps relay: approved GitHub CLI device code " + job.code + " for " + job.lane, "#238636");
    GM_notification({ title: "GhostDeps relay", text: "Approved GitHub CLI device code " + job.code + " (" + job.lane + ")", timeout: 8000 });
  }

  const norm = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  function handleDevicePages(job) {
    const path = location.pathname;
    if (!path.startsWith("/login/device")) return false;

    // Stage 1: code entry form
    const codeInput = document.querySelector('input[name="user_code"]') ||
      document.querySelector('form input[type="text"]:not([name="otp"])');
    if (codeInput && !path.includes("success")) {
      if (norm(codeInput.value) !== norm(job.code)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(codeInput, job.code);
        codeInput.dispatchEvent(new Event("input", { bubbles: true }));
        codeInput.dispatchEvent(new Event("change", { bubbles: true }));
        log("filled code", job.code);
      }
      const form = codeInput.closest("form");
      const btn = form && (form.querySelector('button[type="submit"]') || form.querySelector('input[type="submit"]'));
      if (btn) { log("submitting code form"); btn.click(); } else if (form) form.requestSubmit();
      return true;
    }

    // Stage 2: authorize page
    const authBtn = document.querySelector('button[name="authorize"], form[action*="authorize"] button[type="submit"]');
    if (authBtn) {
      const text = document.body.innerText;
      if (!text.includes("GitHub CLI")) return abortJob(job, "OAuth app on the authorize page is not GitHub CLI"), true;
      const shown = text.match(/\\b([BCDFGHJKMPQRSTVWXZ0-9]{4}-[BCDFGHJKMPQRSTVWXZ0-9]{4})\\b/);
      if (shown && norm(shown[1]) !== norm(job.code)) return abortJob(job, "code on page " + shown[1] + " does not match relayed code " + job.code), true;
      log("authorizing GitHub CLI for", job.lane);
      authBtn.click();
      return true;
    }

    // Stage 3: done
    if (/congratulations|authorized|all set/i.test(document.body.innerText)) { consume(job); return true; }
    return true; // still on a device page; wait for next tick
  }

  async function poll() {
    const key = getKey();
    if (!key) return;
    let job = getJob();
    if (job && Date.now() - job.startedAt > JOB_MAX_AGE_MS) { log("job expired", job.id); setJob(null); job = null; }
    if (job && location.pathname.startsWith("/login/device")) { handleDevicePages(job); return; }
    if (job && !location.pathname.startsWith("/login/device")) {
      location.assign("https://github.com/login/device");
      return;
    }
    const r = await xhr("GET", "/api/device-relay?pending=1");
    if (r.status === 401) {
      if (!GM_getValue("keyRejected", false)) {
        GM_setValue("keyRejected", true);
        GM_notification({ title: "GhostDeps relay", text: "Relay key rejected (401). Re-set it from the Tampermonkey menu.", timeout: 0 });
      }
      return;
    }
    const next = (r.json && r.json.pending || []).find((e) => !GM_getValue("skip:" + e.id, false));
    if (!next) return;
    setJob({ id: next.id, code: next.code, lane: next.lane, scopes: next.scopes, startedAt: Date.now() });
    log("picked up code", next.code, "from", next.lane);
    location.assign("https://github.com/login/device");
  }

  setInterval(() => { poll().catch((e) => log("poll error", e)); }, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
  document.addEventListener("visibilitychange", () => poll().catch(() => {}));
  poll().catch((e) => log("poll error", e));
})();
`;
