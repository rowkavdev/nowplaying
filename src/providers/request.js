// Every media-server request gets a deadline. Without one, a server that
// accepts the connection but never answers (stuck after a restart, a reverse
// proxy holding the socket) leaves getPresence pending forever, and the
// backoff wrapper shares that pending request with every later poll, so the
// card and Discord never recover until the app restarts.
export const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    const original = new URL(url);
    const signal = AbortSignal.timeout(timeoutMs);
    let target = original;
    for (let hops = 0; ; hops += 1) {
      // Never let fetch forward provider credentials to another origin on its
      // own. A different port on the same host is a different origin too.
      const response = await fetchImpl(target.toString(), { ...init, signal, redirect: "manual" });
      if (!REDIRECTS.has(response.status)) return response;
      if (hops >= MAX_REDIRECTS) throw new Error("Provider request redirected too many times");
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Provider request redirected without a location");
      const next = new URL(location, target);
      if (next.origin !== original.origin || next.username || next.password) throw new Error("Provider request redirected outside its origin");
      target = next;
    }
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw Object.assign(new Error(`request timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT", cause: error });
    }
    throw error;
  }
}

// Start best-effort disposal of a response that will not be read. Never let
// cleanup hold back the provider's original result or status diagnostic.
export function discardResponseBody(response) {
  try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
}
