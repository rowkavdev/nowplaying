import { createRelayHandlers } from "../lib/device-relay.js";
import { redisFromEnv } from "../lib/redis.js";

let relay = null;
export default function handler(req, res) {
  if (!relay) {
    let redis = null;
    relay = createRelayHandlers({
      getRedis: () => (redis ??= redisFromEnv()),
      relayKey: process.env.DEVICE_RELAY_KEY ?? "",
      baseUrl: "https://" + (req.headers["x-forwarded-host"] ?? req.headers.host),
    });
  }
  return relay.route(req, res);
}
