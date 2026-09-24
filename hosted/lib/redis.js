// Minimal Redis clients: Upstash REST for production, in-memory for tests.
// Only the commands the hosted service needs are supported.

export function createUpstashRedis({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new TypeError("Upstash REST URL must be an https URL");
  if (typeof token !== "string" || token.length === 0) throw new TypeError("Upstash REST token is required");
  const endpoint = url.replace(/\/+$/, "");
  return {
    async command(args) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`redis_http_${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error("redis_error");
      return body.result;
    },
  };
}

export function redisFromEnv(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return createUpstashRedis({ url, token });
}

export function createMemoryRedis({ now = () => Date.now() } = {}) {
  const data = new Map();
  const live = (key) => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) { data.delete(key); return null; }
    return entry;
  };
  return {
    data,
    async command([name, key, ...rest]) {
      switch (String(name).toUpperCase()) {
        case "GET": return live(key)?.value ?? null;
        case "SET": {
          let expiresAt = null; let nx = false;
          for (let i = 1; i < rest.length; i += 1) {
            const flag = String(rest[i]).toUpperCase();
            if (flag === "EX") { expiresAt = now() + Number(rest[i + 1]) * 1000; i += 1; }
            else if (flag === "NX") nx = true;
          }
          if (nx && live(key)) return null;
          data.set(key, { value: String(rest[0]), expiresAt });
          return "OK";
        }
        case "INCR": {
          const entry = live(key);
          const value = Number(entry?.value ?? 0) + 1;
          data.set(key, { value: String(value), expiresAt: entry?.expiresAt ?? null });
          return value;
        }
        case "EXPIRE": { const entry = live(key); if (!entry) return 0; entry.expiresAt = now() + Number(rest[0]) * 1000; return 1; }
        case "DEL": return data.delete(key) ? 1 : 0;
        case "PFADD": {
          const entry = live(key) ?? { value: new Set(), expiresAt: null };
          const before = entry.value.size;
          for (const item of rest) entry.value.add(String(item));
          data.set(key, entry);
          return entry.value.size > before ? 1 : 0;
        }
        case "PFCOUNT": return live(key)?.value.size ?? 0;
        default: throw new Error(`unsupported command ${name}`);
      }
    },
  };
}
