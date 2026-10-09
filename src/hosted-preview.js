import { createPresence } from "./presence.js";
import { projectHostedState } from "./hosted-projection.js";
import { normalizeHostedUrl } from "./hosted-uploader.js";

// What the setup wizard and settings show before hosting is switched on
// (#140, #141): the exact fields that would leave the PC with the current
// privacy and card settings. It runs the same projection the uploader uses on
// sample playback, so the preview can't drift from what is really sent.

const SAMPLES = Object.freeze([
  createPresence({ state: "playing", kind: "track", title: "Sample song", subtitle: "Sample artist", positionMs: 61_000, durationMs: 215_000, updatedAt: "2026-01-01T00:00:00.000Z" }),
  createPresence({ state: "playing", kind: "episode", title: "Sample episode", subtitle: "Sample show", positionMs: 600_000, durationMs: 2_700_000, updatedAt: "2026-01-01T00:00:00.000Z" }),
]);

// Plain-language names, in the order they're shown. Protocol fields (v, seq,
// observedAt) are listed separately as "always sent".
const FIELD_LABELS = Object.freeze({
  state: "Whether something is playing or paused",
  kind: "Media type (song, episode, film or show)",
  title: "Title",
  subtitle: "Artist or show name",
  durationMs: "Length",
  positionMs: "Position in the track",
});

export const ALWAYS_SENT = Object.freeze(["A format version", "An update counter", "The time of the update"]);
export const NEVER_SENT = Object.freeze([
  "Artwork or artwork links",
  "Your media server address, username or server name",
  "Provider names, IDs or credentials",
  "Your Discord details",
  "Listening history (the service keeps only the latest state, for minutes)",
]);

const PROTOCOL = new Set(["v", "seq", "observedAt"]);

export function hostedUploadPreview(settings = {}) {
  const payloads = SAMPLES.map((presence) => projectHostedState(presence, settings, { seq: 1, now: Date.parse("2026-01-01T00:00:01.000Z") }));
  const keys = new Set(payloads.flatMap((p) => Object.keys(p)).filter((k) => !PROTOCOL.has(k)));
  const sent = Object.keys(FIELD_LABELS).filter((k) => keys.has(k)).map((key) => ({ key, label: FIELD_LABELS[key] }));
  const unknown = [...keys].filter((k) => !(k in FIELD_LABELS));
  // A new projection field must get a label here before it can ship.
  if (unknown.length) throw new Error(`hosted preview has no label for: ${unknown.join(", ")}`);
  const withheld = Object.keys(FIELD_LABELS).filter((k) => !keys.has(k)).map((key) => ({ key, label: FIELD_LABELS[key] }));
  return { sent, withheld, alwaysSent: ALWAYS_SENT, neverSent: NEVER_SENT, sample: payloads[0] };
}

// Self-hosted endpoint check: GET <url>/healthz, nothing else. Sends no
// token, no card data and no provider details, and doesn't follow redirects.
// The health body is two bytes, so anything beyond a tiny cap is not a valid
// health response: stream with a running byte cap and cancel the excess
// instead of buffering the whole body (#751). A non-streaming adapter only
// buffers when the peer declared a size at or under the cap (see #747).
const MAX_HEALTH_BYTES = 1024;

export async function checkHostedEndpoint(url, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  let origin;
  try { origin = normalizeHostedUrl(url); } catch (error) { return { ok: false, reason: "invalid_url", message: error.message }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/healthz`, { method: "GET", headers: { accept: "text/plain" }, redirect: "error", signal: controller.signal });
    if (res.status !== 200) { cancelHealthBody(res.body); return { ok: false, reason: "bad_status", status: res.status }; }
    const body = await readHealthBody(res);
    if (body === null || body.trim() !== "ok") return { ok: false, reason: "not_nowplaying" };
    return { ok: true, url: origin };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function cancelHealthBody(target) {
  try { Promise.resolve(target?.cancel?.()).catch(() => {}); } catch {}
}

// Returns the health body text, or null when it is over the byte cap.
async function readHealthBody(res) {
  const declaredHeader = res.headers?.get?.("content-length");
  const declared = typeof declaredHeader === "string" && declaredHeader.trim() !== "" ? Number(declaredHeader) : NaN;
  if (Number.isFinite(declared) && declared > MAX_HEALTH_BYTES) { cancelHealthBody(res.body); return null; }
  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    let oversize = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength ?? 0;
        if (total > MAX_HEALTH_BYTES) { oversize = true; cancelHealthBody(reader); break; }
        chunks.push(value);
      }
    } catch (error) {
      cancelHealthBody(reader);
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    if (oversize) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  // No stream to cap: text() cannot be interrupted, so only buffer when the
  // peer declared a size at or under the cap; otherwise refuse without
  // calling text(). A peer lying about its declared size is caught after.
  if (!Number.isFinite(declared) || typeof res.text !== "function") return null;
  const text = String(await res.text());
  return new TextEncoder().encode(text).byteLength > MAX_HEALTH_BYTES ? null : text;
}
