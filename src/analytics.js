import { randomUUID } from "node:crypto";

export function withCardAnalytics(resolveCard, { store, installationId } = {}) {
  if (typeof resolveCard !== "function") throw new TypeError("resolveCard: expected a function");
  if (!store || typeof store.recordCard !== "function") throw new TypeError("store: expected an analytics store");
  if (typeof installationId !== "string") throw new TypeError("installationId: expected a string");
  return async function resolve(options) {
    const card = await resolveCard(options);
    await store.recordCard(installationId);
    return card;
  };
}

export function createDiscordAnalytics({ enabled = false, endpoint, installationId = randomUUID(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof enabled !== "boolean") throw new TypeError("enabled: expected a boolean");
  if (enabled && (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint))) throw new TypeError("endpoint: expected an HTTPS URL");
  if (typeof installationId !== "string" || installationId.length < 16 || installationId.length > 128) throw new TypeError("installationId: expected 16-128 characters");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  let sent = false;
  return Object.freeze({
    installationId,
    async ping() {
      if (!enabled || sent) return Object.freeze({ sent: false });
      const response = await fetchImpl(new URL("/analytics/discord", endpoint), { method: "POST", headers: { "X-Nowplaying-Installation": installationId } });
      if (!response.ok) throw new Error(`analytics ping failed (${response.status})`);
      sent = true;
      return Object.freeze({ sent: true });
    },
  });
}
