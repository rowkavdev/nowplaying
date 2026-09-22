import { formatDiscordActivity } from "./discord.js";

export function createDiscordController({ client, settings = {} } = {}) {
  if (!client || typeof client.publish !== "function") {
    throw new TypeError("discord client.publish is required");
  }

  function preview(presence) {
    return formatDiscordActivity(presence, settings);
  }

  async function publish(presence) {
    const activity = preview(presence);
    const published = await client.publish(activity);
    return Object.freeze({ activity, published: Boolean(published) });
  }

  async function clear() {
    return Boolean(await client.publish(null));
  }

  return Object.freeze({ preview, publish, clear });
}
