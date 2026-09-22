import { expireStalePresence } from "./presence-policy.js";
import { formatDiscordActivity } from "./discord.js";

export function formatFreshDiscordActivity(presence, settings = {}, freshness = {}) {
  return formatDiscordActivity(expireStalePresence(presence, freshness), settings);
}
