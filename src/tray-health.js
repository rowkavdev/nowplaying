const OUTPUT_STATUS = new Set(["disabled", "starting", "healthy", "failed"]);
const PROVIDER_STATUS = new Set(["starting", "connected", "unreachable", "authentication_failed", "invalid_configuration", "stopped"]);

export function createTrayHealth({ running = true, provider = "starting", card = "starting", discord = "starting", hosted = "disabled", lastSuccessfulPollAt = null, now = Date.now(), staleAfterMs = 120_000 } = {}) {
  if (typeof running !== "boolean") throw new TypeError("tray health running is invalid");
  if (!PROVIDER_STATUS.has(provider)) throw new TypeError("tray health provider is invalid");
  if (!OUTPUT_STATUS.has(card) || !OUTPUT_STATUS.has(discord) || !OUTPUT_STATUS.has(hosted)) throw new TypeError("tray health output is invalid");
  if (!Number.isFinite(now)) throw new TypeError("tray health now is invalid");
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) throw new TypeError("tray health staleAfterMs is invalid");
  const pollAt = lastSuccessfulPollAt === null ? null : numericTimestamp(lastSuccessfulPollAt);
  const ageMs = pollAt === null ? null : Math.max(0, Math.floor(now - pollAt));
  const stale = ageMs !== null && ageMs > staleAfterMs;
  const status = overallStatus({ running, provider, card, discord, hosted, stale });
  return Object.freeze({
    status,
    provider,
    outputs: Object.freeze({ card, discord, hosted }),
    lastSuccessfulPollAt: pollAt,
    lastSuccessfulPollAgeMs: ageMs,
    stale,
    action: recoveryAction({ provider, card, discord, hosted, stale }),
  });
}

function overallStatus({ running, provider, card, discord, hosted, stale }) {
  if (!running || provider === "stopped") return "stopped";
  if (provider !== "connected" && provider !== "starting" || stale || [card, discord, hosted].includes("failed")) return "degraded";
  if (provider === "starting" || [card, discord, hosted].includes("starting")) return "starting";
  return "healthy";
}

function recoveryAction({ provider, card, discord, hosted, stale }) {
  if (["unreachable", "authentication_failed", "invalid_configuration"].includes(provider)) return "test_provider_connection";
  if (card === "failed" || discord === "failed" || hosted === "failed" || stale) return "open_troubleshooting";
  return null;
}

function numericTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError("tray health lastSuccessfulPollAt is invalid");
  return Math.floor(timestamp);
}
