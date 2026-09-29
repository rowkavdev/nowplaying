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
        case "EVAL": {
          if (typeof key === "string" && key.includes("redis.call('TTL', KEYS[1]) == -1") && Number(rest[0]) === 1) {
            const [bucket, ttl] = rest.slice(1);
            if (!live(bucket)) data.set(bucket, { value: "0", expiresAt: now() + Number(ttl) * 1000 });
            const entry = live(bucket);
            if (entry.expiresAt === null) entry.expiresAt = now() + Number(ttl) * 1000;
            entry.value = String(Number(entry.value) + 1);
            return Number(entry.value);
          }
          if (typeof key === "string" && key.includes("np-device-lifecycle-v1") && Number(rest[0]) === 1) {
            const [listKey, userId, action, authHash, targetId, nameValue, newId, newHash, stamp, previousHash, maxDevices] = rest.slice(1);
            const tok = (hash) => `np:tok:${hash}`;
            const drop = (device) => {
              if (device.tokenHash) data.delete(tok(device.tokenHash));
              for (const prefix of ["np:dstate:", "np:seq:", "np:dseen:"]) data.delete(`${prefix}${device.deviceId}`);
            };
            if (action !== "sign-in") {
              const auth = live(tok(authHash))?.value;
              if (!auth || String(JSON.parse(auth).userId) !== userId) return [-1, 0];
            }
            const devices = JSON.parse(live(listKey)?.value ?? "[]");
            const save = () => {
              if (devices.length) data.set(listKey, { value: JSON.stringify(devices), expiresAt: null });
              else data.delete(listKey);
            };
            if (action === "sign-in") {
              if (previousHash) {
                const priorRaw = live(tok(previousHash))?.value;
                if (!priorRaw) return [-2, 0];
                const prior = JSON.parse(priorRaw);
                if (String(prior.userId) !== userId) return [-3, 0];
                const i = devices.findIndex((d) => d.deviceId === prior.deviceId && d.tokenHash === previousHash);
                if (i < 0) return [-4, 0];
                drop(devices[i]); devices.splice(i, 1);
              }
              while (devices.length >= Number(maxDevices)) {
                const seen = devices.map((d) => Number(live(`np:dseen:${d.deviceId}`)?.value ?? d.createdAt ?? 0));
                const i = seen.indexOf(Math.min(...seen));
                drop(devices[i]); devices.splice(i, 1);
              }
              data.set(tok(newHash), { value: JSON.stringify({userId, deviceId: newId}), expiresAt: null });
              devices.push({deviceId: newId, name: nameValue, createdAt: Number(stamp), tokenHash: newHash});
              save(); return [1, devices.length];
            }
            if (action === "sign-out") {
              const count = devices.length;
              devices.forEach(drop); data.delete(listKey); return [1, count];
            }
            const index = devices.findIndex((d) => d.deviceId === targetId);
            if (index < 0 && action === "revoke") {
              data.delete(tok(authHash)); drop({deviceId: targetId}); return [1, 0];
            }
            if (index < 0) return [-5, 0];
            if (action === "rename") devices[index].name = nameValue;
            else { drop(devices[index]); devices.splice(index, 1); }
            save(); return [1, 1];
          }
          // Emulates the hosted ingest script as one synchronous Redis action.
          // No await may split its comparison from the card-state write.
          if (typeof key !== "string" || !key.includes("local previous = tonumber(redis.call('GET', KEYS[1])") || Number(rest[0]) !== 4) throw new Error("unsupported script");
          const [seqKey, stateKey, seenKey, tokenKey, seqText, seqTtl, userFlag, recordText, receivedAt, stateTtl] = rest.slice(1);
          if (!live(tokenKey)) return [-1, -1];
          const previous = Number(live(seqKey)?.value ?? -1);
          const incoming = Number(seqText);
          if (incoming <= previous) return [0, previous];
          const record = JSON.parse(recordText);
          if (record.state === "idle") data.delete(stateKey);
          else {
            if (userFlag === "1") {
              const prior = live(stateKey)?.value;
              const old = prior ? JSON.parse(prior) : null;
              record.startedAt = record.state === "playing" ? (old?.state === "playing" && old.startedAt ? old.startedAt : Number(receivedAt)) : null;
            }
            data.set(stateKey, { value: JSON.stringify(record), expiresAt: now() + Number(stateTtl) * 1000 });
          }
          if (userFlag === "1") data.set(seenKey, { value: String(receivedAt), expiresAt: now() + Number(seqTtl) * 1000 });
          data.set(seqKey, { value: String(seqText), expiresAt: now() + Number(seqTtl) * 1000 });
          return [1, previous];
        }
        case "GET": return live(key)?.value ?? null;
        case "MGET": return [key, ...rest].map((k) => live(k)?.value ?? null);
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
