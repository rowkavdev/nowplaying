import { resolveDiscordClientId } from "./discord-app.js";
import { createDiscordIpcClient } from "./discord-ipc.js";

// "Test Discord" on the setup wizard's Discord step (#141): checks the Discord
// desktop app is running and answers, shows a test status for a few seconds,
// then clears it. Separate from Test connection, so a Discord problem and a
// media server problem are never mixed up. Nothing about the user's media is
// sent; the test status is fixed text.
const PATH = "/api/setup/discord-test";
const TEST_ACTIVITY = Object.freeze({ type: "listening", details: "Testing NowPlaying setup", state: "This goes away in a few seconds" });

export function createSetupDiscordTestHandler({ clientId = defaultClientId(), createClient = () => createDiscordIpcClient(), showMs = 5000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let running = false;

  async function test() {
    if (!clientId) return result("no_app_id");
    const client = createClient();
    try {
      try { await client.login({ clientId }); }
      catch (error) { return result(/not running/i.test(String(error?.message)) ? "not_running" : /timed out/i.test(String(error?.message)) ? "no_answer" : "rejected"); }
      try { await client.setActivity(TEST_ACTIVITY); }
      catch { return result("rejected"); }
      await sleep(showMs);
      try { await client.clearActivity(); } catch { /* closing the connection clears it too */ }
      return result("connected");
    } finally {
      try { await client.destroy?.(); } catch { /* already closed */ }
    }
  }

  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== PATH) return null;
    if ((request.method || "GET") !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (url.search) return json(400, { error: "invalid_request" });
    if (running) return json(429, { ok: false, status: "test_running" }, { "Retry-After": "5" });
    running = true;
    try {
      return json(200, await test());
    } catch {
      return json(500, { error: "test_failed" });
    } finally {
      running = false;
    }
  };
}

function defaultClientId() {
  try { return resolveDiscordClientId(); } catch { return null; }
}

function result(status) {
  return Object.freeze({ ok: status === "connected", status });
}

function json(status, value, extra = {}) {
  return Object.freeze({ status, headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }), body: `${JSON.stringify(value)}\n` });
}
