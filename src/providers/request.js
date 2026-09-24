// Every media-server request gets a deadline. Without one, a server that
// accepts the connection but never answers (stuck after a restart, a reverse
// proxy holding the socket) leaves getPresence pending forever, and the
// backoff wrapper shares that pending request with every later poll, so the
// card and Discord never recover until the app restarts.
export const REQUEST_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw Object.assign(new Error(`request timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT", cause: error });
    }
    throw error;
  }
}
