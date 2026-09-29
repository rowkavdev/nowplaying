// Read an HTTP response body with a hard byte cap, so a hostile or broken
// server can't make the updater buffer an unbounded amount of memory.
export async function readBoundedBytes(response, limit, label = "response") {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("limit: expected a positive integer");
  const rawLength = response?.headers?.get?.("content-length");
  const declared = typeof rawLength === "string" && rawLength.trim() !== "" ? Number(rawLength) : NaN;
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
  if (typeof response?.arrayBuffer !== "function" && typeof response?.text !== "function") {
    throw new TypeError(`${label} has no readable body`);
  }
  // Non-streaming adapters hand over the whole body before its size can be
  // measured, so they are only read when the server declared a sane length
  // within the cap. Residual: a dishonest declared length can still make
  // such an adapter buffer too much; only the streamed path above enforces
  // the cap as bytes arrive.
  if (!Number.isSafeInteger(declared) || declared < 0) throw new Error(`${label} is too large`);
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
}

export function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}
