import { SHUTDOWN_PATH } from "./status-page-handler.js";

// The installer and `nowplaying stop` ask a running NowPlaying to quit over
// its loopback WebUI (#780). The bearer token is an independent per-install
// random secret (the shutdown-token file next to config.json, written 0600
// at first start), so asking the app to stop needs read access to the user's
// private data directory - the same privilege as quitting from the tray. It
// is never derived from the device ID: that value travels to media servers
// as device identity and is not a secret.
export const SHUTDOWN_SECRET_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

// `stop` exit codes the installer reads: 0 stopped, 3 not running (both let
// setup continue), 4 the running app did not accept the request (setup falls
// back to the files-in-use page), 2 a usage error.
export const STOP_EXIT = Object.freeze({ stopped: 0, notRunning: 3, unavailable: 4 });

export async function requestLocalShutdown({ port, token, fetchImpl = fetch, requestTimeoutMs = 5000, exitTimeoutMs = 10000, pollMs = 250, elapsedNow = () => performance.now() } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError("port must be an integer from 1024 to 65535");
  if (typeof token !== "string" || token.length === 0) throw new TypeError("token: expected a shutdown token");
  let reply;
  try {
    reply = await fetchImpl(`http://127.0.0.1:${port}${SHUTDOWN_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    // A timeout means something else answered (or nothing parsed); a refused
    // connection means the app is not running.
    return error?.name === "TimeoutError" || error?.name === "AbortError" ? "unavailable" : "not-running";
  }
  if (reply.status !== 202) return "unavailable";
  // The app quits after answering; wait for the port to stop responding.
  const deadline = elapsedNow() + exitTimeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    try {
      await fetchImpl(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return "stopped";
    }
    if (elapsedNow() >= deadline) return "unavailable";
  }
}
