import { normalizeHostedUrl } from "./hosted-uploader.js";

// Keeps the hosted card device registration in
// the OS credential store (Windows Credential Manager in the app), next to the
// media-server sign-in. Never written to config.json.

const SERVICE = "nowplaying";
const ACCOUNT = "hosted:device";
const ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// Either an anonymous per-PC card ({ cardId, deviceId, token }) or a PC
// signed in with GitHub ({ login, deviceId, token }, #140).
function valid(value) {
  if (!value || typeof value !== "object" || !ID.test(value.deviceId) || !TOKEN.test(value.token)) return false;
  if (value.baseUrl !== undefined) { try { normalizeHostedUrl(value.baseUrl); } catch { return false; } }
  return LOGIN.test(value.login ?? "") || ID.test(value.cardId ?? "");
}
function pick(value) {
  const identity = LOGIN.test(value.login ?? "") ? { login: value.login } : { cardId: value.cardId };
  return { ...identity, deviceId: value.deviceId, token: value.token, ...(value.baseUrl !== undefined ? { baseUrl: normalizeHostedUrl(value.baseUrl) } : {}) };
}

// Serialize read/compare/delete with saves sharing an adapter in this process.
const adapterQueues = new WeakMap();
function serialize(adapter, operation) {
  const previous = adapterQueues.get(adapter) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  adapterQueues.set(adapter, result.catch(() => {}));
  return result;
}

export function createHostedCredentials({ adapter } = {}) {
  for (const method of ["setPassword", "getPassword", "deletePassword"]) {
    if (typeof adapter?.[method] !== "function") throw new TypeError(`credential adapter.${method} is required`);
  }
  async function load() {
    const raw = await adapter.getPassword(SERVICE, ACCOUNT);
    if (typeof raw !== "string" || !raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }
    return valid(parsed) ? Object.freeze(pick(parsed)) : null;
  }
  return Object.freeze({
    load: () => serialize(adapter, load),
    save(value) {
      if (!valid(value)) return Promise.reject(new TypeError("hosted registration is invalid"));
      const raw = JSON.stringify(pick(value));
      return serialize(adapter, () => adapter.setPassword(SERVICE, ACCOUNT, raw));
    },
    clear: () => serialize(adapter, () => adapter.deletePassword(SERVICE, ACCOUNT)),
    clearIfToken(token) {
      return serialize(adapter, async () => {
        const stored = await load();
        if (!stored || stored.token !== token) return false;
        await adapter.deletePassword(SERVICE, ACCOUNT);
        return true;
      });
    },
  });
}
