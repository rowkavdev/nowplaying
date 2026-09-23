import { formatDiscordActivity } from "./discord.js";

export function createDiscordController({ client, settings = {}, artwork } = {}) {
  if (!client || typeof client.publish !== "function") {
    throw new TypeError("discord client.publish is required");
  }
  if (artwork !== undefined && (!artwork || typeof artwork.resolve !== "function")) {
    throw new TypeError("discord artwork.resolve is required");
  }

  function preview(presence) {
    return formatDiscordActivity(presence, settings);
  }

  async function withArtwork(activity, presence) {
    if (!artwork || !activity) return { activity, status: undefined };
    let resolved;
    try {
      resolved = await artwork.resolve(presence);
    } catch {
      return { activity, status: Object.freeze({ strategy: "fallback", failure: "resolver_error" }) };
    }
    const status = Object.freeze({ strategy: resolved.strategy, failure: resolved.failure ?? null });
    if (resolved.strategy === "fallback" || typeof resolved.image !== "string" || !resolved.image) return { activity, status };
    return { activity: Object.freeze({ ...activity, largeImage: resolved.image }), status };
  }

  async function publish(presence) {
    const { activity, status } = await withArtwork(preview(presence), presence);
    const published = await client.publish(activity);
    const result = { activity, published: Boolean(published) };
    if (status) result.artwork = status;
    return Object.freeze(result);
  }

  async function clear() {
    return Boolean(await client.publish(null));
  }

  return Object.freeze({ preview, publish, clear });
}
