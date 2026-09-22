import { createPresence } from "./presence.js";
import { presenceFreshness } from "./presence-freshness.js";

export function expireStalePresence(presence, { now = Date.now(), staleAfterMs } = {}) {
  const freshness = presenceFreshness(presence, { now, ...(staleAfterMs === undefined ? {} : { staleAfterMs }) });
  if (freshness.fresh) return presence;
  return createPresence({ state: "offline", kind: presence?.kind, updatedAt: new Date(now) });
}
