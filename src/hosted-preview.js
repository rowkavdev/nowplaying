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
export async function checkHostedEndpoint(url, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  let origin;
  try { origin = normalizeHostedUrl(url); } catch (error) { return { ok: false, reason: "invalid_url", message: error.message }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/healthz`, { method: "GET", headers: { accept: "text/plain" }, redirect: "error", signal: controller.signal });
    if (res.status !== 200) return { ok: false, reason: "bad_status", status: res.status };
    const body = String(await res.text()).trim();
    if (body !== "ok") return { ok: false, reason: "not_nowplaying" };
    return { ok: true, url: origin };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
