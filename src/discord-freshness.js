import { expireStalePresence } from "./presence-policy.js";
import { discordDefaults, formatDiscordActivity } from "./discord.js";

export function formatFreshDiscordActivity(presence, settings = {}, freshness = {}) {
  const current = expireStalePresence(presence, freshness);
  if (current !== presence) {
    if (settings.idleBehavior !== "show") return null;
    return Object.freeze({ type: "listening", largeImage: settings.largeImage ?? discordDefaults.largeImage, largeText: "Offline" });
  }
  return formatDiscordActivity(current, settings);
}
