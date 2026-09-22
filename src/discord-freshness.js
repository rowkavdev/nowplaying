import { expireStalePresence } from "./presence-policy.js";
import { formatDiscordActivity } from "./discord.js";

export function formatFreshDiscordActivity(presence, settings = {}, freshness = {}) {
  const current = expireStalePresence(presence, freshness);
  if (current !== presence && settings.idleBehavior !== "show") return null;
  return formatDiscordActivity(current, settings);
}
