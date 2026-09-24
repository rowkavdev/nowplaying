export function createDiscordRpcTransport({ clientId, createClient } = {}) {
  if (typeof clientId !== "string" || !/^\d{17,20}$/.test(clientId)) throw new TypeError("clientId: expected a Discord application ID");
  if (typeof createClient !== "function") throw new TypeError("createClient: expected an RPC client factory");
  let client;
  let connecting;

  // An RPC client whose socket Discord closed (Discord quit or restarted) is
  // dropped so the next connect logs in again.
  function dead() { return Boolean(client) && client.connected === false; }

  // Two publishes at once (a Refresh artwork tick during a scheduled tick)
  // share one login. Without this each opened its own Discord connection and
  // the extra one was never closed, so its status could outlive a clear/stop.
  function connect() {
    connecting ??= open().finally(() => { connecting = undefined; });
    return connecting;
  }

  async function open() {
    if (dead()) await close().catch(() => {});
    if (client) return;
    const next = await createClient();
    if (!next || typeof next.login !== "function" || typeof next.setActivity !== "function" || typeof next.clearActivity !== "function") {
      throw new TypeError("RPC client: expected login, setActivity and clearActivity functions");
    }
    await next.login({ clientId });
    client = next;
  }

  async function setActivity(activity) {
    if (!client) throw new Error("Discord RPC transport is not connected");
    await client.setActivity(toRpcActivity(activity));
  }

  async function clearActivity() {
    if (!client) throw new Error("Discord RPC transport is not connected");
    await client.clearActivity();
  }

  async function close() {
    const current = client;
    client = undefined;
    if (current && typeof current.destroy === "function") await current.destroy();
  }

  return Object.freeze({ connect, setActivity, clearActivity, close, get connected() { return Boolean(client) && !dead(); } });
}

export function toRpcActivity(activity) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) throw new TypeError("activity: expected a formatted Discord activity");
  const mapped = {
    type: activity.type,
    details: activity.details,
    state: activity.state,
    largeImageKey: activity.largeImage,
    largeImageText: activity.largeText,
    smallImageKey: activity.smallImage,
    startTimestamp: activity.startTimestamp,
    endTimestamp: activity.endTimestamp,
  };
  return Object.freeze(Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined && value !== "")));
}
