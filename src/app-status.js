import { classifyFailure } from "./resilient-card.js";
import { createDiagnosticRecord } from "./diagnostics.js";
import { createBuildProvenance } from "./build-provenance.js";

const PROVIDER_LABELS = Object.freeze({ jellyfin: "Jellyfin", emby: "Emby", plex: "Plex", navidrome: "Navidrome" });
const STATE_BY_FAILURE = Object.freeze({ unauthorized: "authentication_failed", unreachable: "unreachable", timeout: "unreachable", error: "error" });

// Tracks what the local status page shows. It only keeps the latest poll
// outcome and the current track; never secrets, tokens or raw error text.
export function createAppStatus({ config, version = null, now = () => Date.now(), refreshAfterMs = 15_000, platform = process.platform, packageType = null, build = null } = {}) {
  if (!config || typeof config.provider !== "string") throw new TypeError("config: expected an app config");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  const startedAt = now();
  let provider = null;
  let discord = () => ({ enabled: false, state: "off" });
  let lastPollAt = null;
  let lastOkAt = null;
  let failure = null;
  let playing = null;
  let inflight = null;

  function record(promise) {
    return promise.then((presence) => {
      lastPollAt = lastOkAt = now();
      failure = null;
      playing = presence && presence.state !== "idle" ? { state: presence.state, title: text(presence.title), subtitle: text(presence.subtitle) } : null;
      return presence;
    }, (error) => {
      lastPollAt = now();
      failure = classifyFailure(error);
      throw error;
    });
  }

  function wrapProvider(inner) {
    if (!inner || typeof inner.getPresence !== "function") throw new TypeError("provider: expected a provider");
    provider = inner;
    return Object.freeze({ ...inner, getPresence: (...args) => record(Promise.resolve().then(() => inner.getPresence(...args))) });
  }

  function setDiscord(read) {
    if (typeof read !== "function") throw new TypeError("discord: expected a function");
    discord = read;
  }

  // Polls the server once when nothing else has recently (for example when
  // the card isn't embedded anywhere and Discord is off).
  async function refresh() {
    if (!provider || (lastPollAt !== null && now() - lastPollAt < refreshAfterMs)) return;
    inflight ??= record(Promise.resolve().then(() => provider.getPresence())).catch(() => {}).finally(() => { inflight = null; });
    await inflight;
  }

  function snapshot() {
    let discordState;
    try { discordState = discord(); } catch { discordState = { enabled: true, state: "unknown" }; }
    return Object.freeze({
      version: typeof version === "string" ? version : null,
      build: buildLabel(build),
      uptimeMs: Math.max(0, now() - startedAt),
      server: Object.freeze({
        type: PROVIDER_LABELS[config.provider] ?? config.provider,
        address: serverOrigin(config.serverUrl),
        user: text(config.identity?.displayName),
        state: failure ? STATE_BY_FAILURE[failure] : lastOkAt === null ? "starting" : "connected",
        lastPollAt: iso(lastPollAt),
        lastOkAt: iso(lastOkAt),
      }),
      playing: failure ? null : playing,
      discord: Object.freeze({ enabled: Boolean(discordState?.enabled), state: word(discordState?.state), lastPublishedAt: iso(discordState?.lastPublishedAt ?? null), error: code(discordState?.lastError) }),
    });
  }

  // Support bundle for bug reports (#115): allow-listed labels only. The
  // address, user name and current track are passed as sensitive values so
  // they are scrubbed even if they turn up inside an error string.
  function diagnostics() {
    const s = snapshot();
    const outputs = ["card", ...(s.discord.enabled ? ["discord"] : [])];
    const health = s.server.state === "connected" && (!s.discord.enabled || s.discord.state === "ready") ? "healthy" : s.server.state === "starting" ? "starting" : "degraded";
    const sensitiveValues = [config.serverUrl, s.server.address, s.server.user, playing?.title, playing?.subtitle].filter((value) => typeof value === "string");
    return createDiagnosticRecord({
      version: s.version ?? undefined,
      platform,
      packageType: packageType ?? undefined,
      enabledOutputs: outputs,
      provider: { type: config.provider, status: s.server.state },
      health,
      errors: [failure, s.discord.error].filter((value) => typeof value === "string"),
      sensitiveValues,
      build: build ?? undefined,
    });
  }

  return Object.freeze({ wrapProvider, setDiscord, refresh, snapshot, diagnostics });
}

function buildLabel(value) {
  if (!value) return null;
  try {
    const b = createBuildProvenance(value);
    return Object.freeze({ commit: b.commitSha.slice(0, 7), builtAt: b.buildTime, channel: b.channel, signed: b.signed });
  } catch { return null; }
}

function serverOrigin(value) {
  try { const url = new URL(value); return url.origin; } catch { return null; }
}
function text(value) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null; }
function word(value) { return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "unknown"; }
function code(value) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,47}$/.test(value) ? value : null; }
function iso(value) {
  const time = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
