import { classifyFailure } from "./resilient-card.js";
import { createDiagnosticRecord } from "./diagnostics.js";
import { createBuildProvenance } from "./build-provenance.js";
import { createTrayHealth } from "./tray-health.js";

const PROVIDER_LABELS = Object.freeze({ jellyfin: "Jellyfin", emby: "Emby", plex: "Plex", navidrome: "Navidrome" });
const STATE_BY_FAILURE = Object.freeze({ unauthorized: "authentication_failed", unreachable: "unreachable", timeout: "unreachable", error: "error" });

// Tracks what the local status page shows. It only keeps the latest poll
// outcome and the current track; never secrets, tokens or raw error text.
export function createAppStatus({ config, version = null, now = () => Date.now(), refreshAfterMs = 15_000, platform = process.platform, packageType = null, build = null, safeMode = false } = {}) {
  if (!config || typeof config.provider !== "string") throw new TypeError("config: expected an app config");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  const startedAt = now();
  let provider = null;
  let discord = () => ({ enabled: false, state: "off" });
  let hosted = () => ({ enabled: false, state: "off" });
  // Per-server rows when several servers are signed in (#252).
  let servers = () => [];
  let lastPollAt = null;
  let lastOkAt = null;
  let failure = null;
  let playing = null;
  let inflight = null;
  let latestPoll = 0;

  function record(promise) {
    const poll = ++latestPoll;
    return promise.then((presence) => {
      if (poll !== latestPoll) return presence;
      lastPollAt = lastOkAt = now();
      failure = null;
      playing = presence && presence.state !== "idle" ? { state: presence.state, title: text(presence.title), subtitle: text(presence.subtitle) } : null;
      return presence;
    }, (error) => {
      if (poll === latestPoll) {
        lastPollAt = now();
        failure = classifyFailure(error);
      }
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

  function setServers(read) {
    if (typeof read !== "function") throw new TypeError("servers: expected a function");
    servers = read;
  }

  function serverRows() {
    let rows;
    try { rows = servers(); } catch { rows = []; }
    if (!Array.isArray(rows)) return Object.freeze([]);
    return Object.freeze(rows.map((row, index) => Object.freeze({
      type: PROVIDER_LABELS[row?.provider] ?? word(row?.provider),
      address: serverOrigin(config.servers?.[index]?.serverUrl),
      user: text(row?.displayName),
      state: word(row?.state),
      reason: typeof row?.reason === "string" ? word(row.reason.toLowerCase()) : null,
      lastPollAt: iso(row?.checkedAt ?? null),
    })));
  }

  function setHosted(read) {
    if (typeof read !== "function") throw new TypeError("hosted: expected a function");
    hosted = read;
  }

  // Polls the server once when nothing else has recently (for example when
  // the card isn't embedded anywhere and Discord is off).
  async function refresh() {
    if (safeMode || !provider || (lastPollAt !== null && now() - lastPollAt < refreshAfterMs)) return;
    inflight ??= record(Promise.resolve().then(() => provider.getPresence())).catch(() => {}).finally(() => { inflight = null; });
    await inflight;
  }

  function snapshot() {
    let discordState;
    try { discordState = discord(); } catch { discordState = { enabled: true, state: "unknown" }; }
    let hostedState;
    try { hostedState = hosted(); } catch { hostedState = { enabled: true, state: "unknown" }; }
    return Object.freeze({
      version: typeof version === "string" ? version : null,
      build: buildLabel(build),
      uptimeMs: Math.max(0, now() - startedAt),
      server: Object.freeze({
        type: PROVIDER_LABELS[config.provider] ?? config.provider,
        address: serverOrigin(config.serverUrl),
        user: text(config.identity?.displayName),
        state: safeMode ? "safe_mode" : failure ? STATE_BY_FAILURE[failure] : lastOkAt === null ? "starting" : "connected",
        lastPollAt: iso(lastPollAt),
        lastOkAt: iso(lastOkAt),
      }),
      playing: failure ? null : playing,
      servers: serverRows(),
      discord: Object.freeze({ enabled: Boolean(discordState?.enabled), state: word(discordState?.state), lastPublishedAt: iso(discordState?.lastPublishedAt ?? null), error: code(discordState?.lastError), ...artworkStatus(discordState?.artwork) }),
      hosted: Object.freeze({ enabled: Boolean(hostedState?.enabled), state: safeHostedState(hostedState?.state), lastSuccessAt: iso(hostedState?.lastSuccessAt ?? null), error: hostedError(hostedState?.lastError) }),
    });
  }

  // Support bundle for bug reports (#115): allow-listed labels only. The
  // address, user name and current track are passed as sensitive values so
  // they are scrubbed even if they turn up inside an error string.
  function diagnostics() {
    const s = snapshot();
    const problem = serverProblem(s.servers);
    const outputs = ["card", ...(s.discord.enabled ? ["discord"] : []), ...(s.hosted.enabled ? ["hosted"] : [])];
    const serverHealthy = s.server.state === "connected" && !problem;
    const discordHealthy = !s.discord.enabled || s.discord.state === "ready";
    const discordFailed = s.discord.enabled && ["degraded", "failed", "closed"].includes(s.discord.state);
    const hosting = hostedOutput(s.hosted);
    const health = serverHealthy && discordHealthy && ["healthy", "disabled"].includes(hosting) ? "healthy"
      : (s.server.state === "starting" && hosting !== "failed" && !problem && !discordFailed) || (serverHealthy && discordHealthy && hosting === "starting") ? "starting" : "degraded";
    const sensitiveValues = [config.serverUrl, s.server.address, s.server.user, playing?.title, playing?.subtitle].filter((value) => typeof value === "string");
    return createDiagnosticRecord({
      version: s.version ?? undefined,
      platform,
      packageType: packageType ?? undefined,
      enabledOutputs: outputs,
      provider: { type: config.provider, status: s.server.state },
      health,
      errors: [failure, problem?.reason, s.discord.error, s.hosted.enabled && hosting === "failed" ? `hosted_${s.hosted.error ?? "upload_failed"}` : null].filter((value) => typeof value === "string"),
      sensitiveValues,
      build: build ?? undefined,
    });
  }

  // Short, privacy-safe line for the tray tooltip and menu (#121): no track,
  // user name or address. Windows caps tooltips at 63 characters.
  function tray() {
    const s = snapshot();
    // Safe mode (#122): server checks, Discord and uploads are off on purpose.
    if (safeMode) return Object.freeze({ status: "degraded", action: "open_troubleshooting", text: "NowPlaying: safe mode - run setup again" });
    const problem = serverProblem(s.servers);
    const provider = problem ? problem.reason === "unauthorized" ? "authentication_failed" : "unreachable" : s.server.state === "error" ? "unreachable" : s.server.state;
    const discordOutput = !s.discord.enabled ? "disabled" : DISCORD_OUTPUT[s.discord.state] ?? "starting";
    const health = createTrayHealth({ provider, card: "healthy", discord: discordOutput, hosted: hostedOutput(s.hosted), lastSuccessfulPollAt: lastOkAt, now: now() });
    return Object.freeze({ status: health.status, action: health.action, text: trayText(health, { ...s, server: { ...s.server, state: provider } }) });
  }

  return Object.freeze({ wrapProvider, setDiscord, setHosted, setServers, refresh, snapshot, diagnostics, tray });
}

// A successful playback source does not make another signed-in server healthy.
// Rows are already allow-listed by serverRows(), so no raw error enters outputs.
function serverProblem(rows) {
  return rows.find((row) => row.state === "error" && row.reason === "unauthorized")
    ?? rows.find((row) => row.state === "error" || row.state === "unavailable")
    ?? null;
}

const HOSTED_ERRORS = new Set(["network_error", "upload_failed", "unauthorized", "invalid_registration", "clock_recovery_unavailable", "sequence_recovery_unavailable", "http_error", "clock_skew", "stale_sequence"]);
const HOSTED_STATES = new Set(["off", "idle", "starting", "connected", "retrying", "unauthorized", "no_credentials", "disconnect_pending"]);
function safeHostedState(value) { return HOSTED_STATES.has(value) ? value : "unknown"; }
function hostedError(value) { return HOSTED_ERRORS.has(value) ? value : null; }
function hostedOutput(hosted) {
  if (!hosted.enabled) return "disabled";
  if (hosted.state === "connected") return "healthy";
  if (hosted.state === "idle" || hosted.state === "starting") return "starting";
  return "failed";
}

const DISCORD_OUTPUT = Object.freeze({ ready: "healthy", disconnected: "disabled", off: "disabled", no_app_id: "disabled", degraded: "failed", failed: "failed", closed: "failed" });

function trayText(health, s) {
  if (health.status === "healthy") return "NowPlaying: working";
  if (health.status === "starting") return "NowPlaying: starting...";
  if (health.status === "stopped") return "NowPlaying: stopped";
  if (s.server.state === "authentication_failed") return "NowPlaying: sign-in rejected, run setup";
  if (s.server.state === "unreachable" || s.server.state === "error") return "NowPlaying: can't reach your server";
  if (health.stale) return "NowPlaying: no update from the server lately";
  if (s.hosted.enabled && hostedOutput(s.hosted) === "failed") return "NowPlaying: hosted card needs attention";
  return "NowPlaying: Discord needs attention";
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
// Artwork diagnostics (#154): the source Discord got (provider, proxy, lookup,
// fallback or none) and a short fallback reason. Anything else is dropped.
function artworkStatus(value) {
  if (!value || typeof value !== "object") return {};
  return { artwork: Object.freeze({ source: word(value.strategy), reason: value.failure == null ? null : word(value.failure) }) };
}

function word(value) { return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "unknown"; }
function code(value) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,47}$/.test(value) ? value : null; }
function iso(value) {
  const time = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
