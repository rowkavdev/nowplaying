// Read an HTTP response body with a hard byte cap, so a hostile or broken
// server can't make the updater buffer an unbounded amount of memory.
export async function readBoundedBytes(response, limit, label = "response") {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("limit: expected a positive integer");
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`${label} is too large`);
  const body = response?.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) throw new Error(`${label} is too large`);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  if (typeof response?.arrayBuffer === "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(`${label} is too large`);
    return bytes;
  }
  if (typeof response?.text === "function") {
    const bytes = new TextEncoder().encode(await response.text());
    if (bytes.byteLength > limit) throw new Error(`${label} is too large`);
    return bytes;
  }
  throw new TypeError(`${label} has no readable body`);
}

export function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}
